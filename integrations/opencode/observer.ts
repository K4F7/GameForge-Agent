import { mkdir, open, readFile, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import path from "node:path";
import { createOpencodeClient, type GlobalEvent } from "@opencode-ai/sdk";

export type ObservedOpenCodeEvent = { evidenceVersion: "1.0"; source: "opencode-sdk-global-event"; observerSessionId: string; runId?: string; sequence: number; observedAt: string; sseId: string | null; directory: string; type: string; properties: unknown; raw: GlobalEvent };
export type OpenCodeEventFrame = { data: GlobalEvent; sseId?: string };
export type OpenCodeEventSource = (signal: AbortSignal) => Promise<AsyncIterable<OpenCodeEventFrame>>;

export class OpenCodeObserver {
  readonly #outputFile: string; readonly #source: OpenCodeEventSource; readonly #sessionId: string;
  readonly #runId: string | undefined; readonly #now: () => string; #sequence = 0; #seenSseIds = new Set<string>();
  constructor(options: { outputFile: string; observerSessionId: string; runId?: string; source: OpenCodeEventSource; now?: () => string }) {
    this.#outputFile = path.resolve(options.outputFile); this.#sessionId = options.observerSessionId;
    this.#runId = options.runId; this.#source = options.source; this.#now = options.now ?? (() => new Date().toISOString());
  }
  async observe(signal: AbortSignal): Promise<void> {
    await mkdir(path.dirname(this.#outputFile), { recursive: true, mode: 0o700 });
    const lockFile = `${this.#outputFile}.lock`;
    const lock = await acquireEvidenceLock(lockFile, this.#outputFile);
    try {
      await repairInterruptedTail(this.#outputFile);
      await this.#restoreCursor();
      const stream = await this.#source(signal); const file = await open(this.#outputFile, "a", 0o600);
      try {
      for await (const frame of stream) {
        const sseId = frame.sseId === "" ? undefined : frame.sseId;
        if (sseId !== undefined && this.#seenSseIds.has(sseId)) continue;
        const event: ObservedOpenCodeEvent = { evidenceVersion: "1.0", source: "opencode-sdk-global-event", observerSessionId: this.#sessionId,
          ...(this.#runId === undefined ? {} : { runId: this.#runId }), sequence: ++this.#sequence, observedAt: this.#now(),
          sseId: sseId ?? null, directory: frame.data.directory, type: frame.data.payload.type,
          properties: frame.data.payload.properties, raw: frame.data };
        await file.appendFile(`${JSON.stringify(event)}\n`, "utf8");
        if (sseId !== undefined) this.#seenSseIds.add(sseId);
      }
      } finally { await file.close(); }
    } finally { await releaseEvidenceLock(lockFile, lock); }
  }
  async replay(after = 0): Promise<ObservedOpenCodeEvent[]> {
    if (!Number.isSafeInteger(after) || after < 0) throw new Error("after must be a non-negative safe integer");
    const text = await readFile(this.#outputFile, "utf8").catch((error: NodeJS.ErrnoException) => { if (error.code === "ENOENT") return ""; throw error; });
    return parseEvidence(text).filter((event) => event.sequence > after);
  }
  async #restoreCursor(): Promise<void> {
    const events = await this.replay(0); let expected = 1;
    for (const event of events) {
      if (event.sequence !== expected++) throw new Error("OpenCode evidence sequence is not contiguous");
      if (event.observerSessionId !== this.#sessionId) throw new Error("OpenCode evidence belongs to another observer session");
      if (event.runId !== this.#runId) throw new Error("OpenCode evidence belongs to another run");
      if (event.sseId !== null && event.sseId !== "") this.#seenSseIds.add(event.sseId);
    }
    this.#sequence = events.length;
  }
}

function parseEvidence(text: string): ObservedOpenCodeEvent[] {
  const lines = text.split(/\r?\n/);
  if (!text.endsWith("\n")) {
    const tail = lines.at(-1);
    if (tail !== undefined && tail.length > 0) {
      try { JSON.parse(tail); } catch { lines.pop(); }
    }
  }
  return lines.filter(Boolean).map((line) => JSON.parse(line) as ObservedOpenCodeEvent);
}

async function repairInterruptedTail(outputFile: string): Promise<void> {
  const file = await open(outputFile, "r+").catch((error: NodeJS.ErrnoException) => { if (error.code === "ENOENT") return undefined; throw error; });
  if (file === undefined) return;
  try {
    const data = await file.readFile();
    if (data.length === 0 || data.at(-1) === 0x0a) return;
    const prefixLength = data.lastIndexOf(0x0a) + 1;
    const tail = data.subarray(prefixLength);
    try {
      JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(tail));
      await file.appendFile("\n", "utf8");
    } catch {
      await file.truncate(prefixLength);
    }
  } finally {
    await file.close();
  }
}

type EvidenceLock = { file: Awaited<ReturnType<typeof open>>; token: string };

async function acquireEvidenceLock(lockFile: string, outputFile: string): Promise<EvidenceLock> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const lock = await open(lockFile, "wx", 0o600);
      const token = randomUUID();
      try {
        await lock.writeFile(`${JSON.stringify({ pid: process.pid, hostname: hostname(), createdAt: new Date().toISOString(), token })}\n`, "utf8");
        return { file: lock, token };
      } catch (error) {
        await lock.close().catch(() => undefined);
        await unlink(lockFile).catch(() => undefined);
        throw error;
      }
    } catch (error) {
      const filesystemError = error as NodeJS.ErrnoException;
      if (filesystemError.code !== "EEXIST") throw error;
      if (attempt === 0 && await removeDeadWriterLock(lockFile)) continue;
      throw new Error(`OpenCode evidence already has an active writer: ${outputFile}`);
    }
  }
  throw new Error(`OpenCode evidence already has an active writer: ${outputFile}`);
}

async function releaseEvidenceLock(lockFile: string, lock: EvidenceLock): Promise<void> {
  await lock.file.close();
  const raw = await readFile(lockFile, "utf8").catch((error: NodeJS.ErrnoException) => { if (error.code === "ENOENT") return undefined; throw error; });
  if (raw === undefined) return;
  let owner: { token?: unknown };
  try { owner = JSON.parse(raw) as { token?: unknown }; } catch { return; }
  if (owner.token !== lock.token) return;
  await unlink(lockFile).catch((error: NodeJS.ErrnoException) => { if (error.code !== "ENOENT") throw error; });
}

async function removeDeadWriterLock(lockFile: string): Promise<boolean> {
  const raw = await readFile(lockFile, "utf8").catch(() => undefined);
  if (raw === undefined) return true;
  let owner: { pid?: unknown; hostname?: unknown };
  try { owner = JSON.parse(raw) as { pid?: unknown; hostname?: unknown }; } catch { return false; }
  if (typeof owner.hostname === "string" && owner.hostname.toLowerCase() !== hostname().toLowerCase()) return false;
  if (!Number.isSafeInteger(owner.pid) || (owner.pid as number) <= 0) return false;
  try {
    process.kill(owner.pid as number, 0);
    return false;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ESRCH") return false;
  }
  return unlink(lockFile).then(() => true, (error: NodeJS.ErrnoException) => error.code === "ENOENT");
}

export function createSdkEventSource(options: { baseUrl: string; directory: string }): OpenCodeEventSource {
  const baseUrl = safeLoopbackUrl(options.baseUrl);
  return async (signal) => {
    const client = createOpencodeClient({ baseUrl, directory: path.resolve(options.directory), signal });
    let lastEventId: string | undefined;
    let retryDelay = 3_000;
    async function* frames(): AsyncGenerator<OpenCodeEventFrame> {
      while (!signal.aborted) {
        const ids = new WeakMap<object, string>();
        const result = await client.global.event({
          ...(lastEventId === undefined ? {} : { headers: { "Last-Event-ID": lastEventId } }),
          onSseEvent: (frame: { data: unknown; id?: string; retry?: number }) => {
            if (frame.id !== undefined) lastEventId = frame.id === "" ? undefined : frame.id;
            if (frame.retry !== undefined) retryDelay = Math.min(Math.max(frame.retry, 0), 30_000);
            if (frame.id !== undefined && frame.id !== "" && typeof frame.data === "object" && frame.data !== null) ids.set(frame.data, frame.id);
          },
        });
        for await (const data of result.stream) {
          const sseId = ids.get(data);
          yield { data, ...(sseId === undefined ? {} : { sseId }) };
        }
        if (!signal.aborted) await abortableDelay(retryDelay, signal);
      }
    }
    return frames();
  };
}

function abortableDelay(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) { resolve(); return; }
    const timer = setTimeout(done, milliseconds);
    signal.addEventListener("abort", done, { once: true });
    function done(): void { clearTimeout(timer); signal.removeEventListener("abort", done); resolve(); }
  });
}

function safeLoopbackUrl(input: string): string {
  const url = new URL(input);
  if (url.protocol !== "http:" || !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) || url.username || url.password || url.search || url.hash)
    throw new Error("OpenCode Observer URL must be credential-free loopback HTTP");
  return url.href.replace(/\/$/, "");
}
