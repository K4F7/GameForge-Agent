import { mkdir, open, readFile, unlink } from "node:fs/promises";
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
    const lock = await open(lockFile, "wx", 0o600).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "EEXIST") throw new Error(`OpenCode evidence already has an active writer: ${this.#outputFile}`);
      throw error;
    });
    try {
      await this.#restoreCursor();
      const stream = await this.#source(signal); const file = await open(this.#outputFile, "a", 0o600);
      try {
      for await (const frame of stream) {
        if (signal.aborted) break;
        if (frame.sseId !== undefined && this.#seenSseIds.has(frame.sseId)) continue;
        const event: ObservedOpenCodeEvent = { evidenceVersion: "1.0", source: "opencode-sdk-global-event", observerSessionId: this.#sessionId,
          ...(this.#runId === undefined ? {} : { runId: this.#runId }), sequence: ++this.#sequence, observedAt: this.#now(),
          sseId: frame.sseId ?? null, directory: frame.data.directory, type: frame.data.payload.type,
          properties: frame.data.payload.properties, raw: frame.data };
        await file.appendFile(`${JSON.stringify(event)}\n`, "utf8");
        if (frame.sseId !== undefined) this.#seenSseIds.add(frame.sseId);
      }
      } finally { await file.close(); }
    } finally { await lock.close(); await unlink(lockFile).catch(() => undefined); }
  }
  async replay(after = 0): Promise<ObservedOpenCodeEvent[]> {
    if (!Number.isSafeInteger(after) || after < 0) throw new Error("after must be a non-negative safe integer");
    const text = await readFile(this.#outputFile, "utf8").catch((error: NodeJS.ErrnoException) => { if (error.code === "ENOENT") return ""; throw error; });
    return text.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line) as ObservedOpenCodeEvent).filter((event) => event.sequence > after);
  }
  async #restoreCursor(): Promise<void> {
    const events = await this.replay(0); let expected = 1;
    for (const event of events) {
      if (event.sequence !== expected++) throw new Error("OpenCode evidence sequence is not contiguous");
      if (event.observerSessionId !== this.#sessionId) throw new Error("OpenCode evidence belongs to another observer session");
      if (event.runId !== this.#runId) throw new Error("OpenCode evidence belongs to another run");
      if (event.sseId !== null) this.#seenSseIds.add(event.sseId);
    }
    this.#sequence = events.length;
  }
}

export function createSdkEventSource(options: { baseUrl: string; directory: string }): OpenCodeEventSource {
  const baseUrl = safeLoopbackUrl(options.baseUrl);
  return async (signal) => {
    const ids = new WeakMap<object, string>();
    const client = createOpencodeClient({ baseUrl, directory: path.resolve(options.directory), signal });
    const result = await client.global.event({
      onSseEvent: (frame: { data: unknown; id?: string }) => { if (frame.id !== undefined && typeof frame.data === "object" && frame.data !== null) ids.set(frame.data, frame.id); },
    });
    async function* frames(): AsyncGenerator<OpenCodeEventFrame> { for await (const data of result.stream) { const sseId = ids.get(data); yield { data, ...(sseId === undefined ? {} : { sseId }) }; } }
    return frames();
  };
}

function safeLoopbackUrl(input: string): string {
  const url = new URL(input);
  if (url.protocol !== "http:" || !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) || url.username || url.password || url.search || url.hash)
    throw new Error("OpenCode Observer URL must be credential-free loopback HTTP");
  return url.href.replace(/\/$/, "");
}
