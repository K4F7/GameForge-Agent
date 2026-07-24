import { randomUUID } from "node:crypto";
import { appendFile, lstat, mkdir, open, readdir, readFile, unlink, writeFile } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { hostname } from "node:os";
import path from "node:path";
import type {
  ActivitySample, AuthoritySnapshot, EvidenceSink, GuiSnapshot, HarnessPhase, HarnessResult,
  HarnessSession, TuiObserverSnapshot, TuiOutputFrame, TuiSnapshot,
} from "../contracts.js";

const MAX_VT_BYTES = 16 * 1024 * 1024;
const MAX_NDJSON_BYTES = 8 * 1024 * 1024;
const MAX_MCP_AUDIT_FILES = 256;
const MAX_MCP_AUDIT_FILE_BYTES = 256 * 1024;
const MAX_MCP_AUDIT_TOTAL_BYTES = 8 * 1024 * 1024;
const LOCK_STALE_AFTER_MS = 10 * 60 * 1000;
const LOCK_METADATA_MAX_BYTES = 4 * 1024;
const appendQueues = new Map<string, Promise<void>>();

type EvidenceLockMetadata = {
  version: 1;
  token: string;
  pid: number;
  hostname: string;
  createdAtMs: number;
};
type OwnedEvidenceLock = { handle: FileHandle; token: string };

export class FileEvidenceSink implements EvidenceSink {
  #vtBytes = 0;
  #truncated = new Set<string>();
  #lockPromise: Promise<OwnedEvidenceLock> | undefined;
  #finalizePromise: Promise<void> | undefined;
  #activeRecords = 0;
  readonly #recordDrainWaiters = new Set<() => void>();
  constructor(readonly sessionRoot: string) {}

  async recordSession(session: HarnessSession): Promise<void> {
    await this.#record(async () => {
      await this.#ensureLock();
      await mkdir(path.join(this.sessionRoot, "gui"), { recursive: true });
      await writeJson(path.join(this.sessionRoot, "metadata.json"), { ...session, evidenceVersion: 1 });
    });
  }
  async recordLifecycle(event: { sessionId: string; phase: HarnessPhase; at: string; detail?: string }): Promise<void> {
    await this.#record(async () => { await this.#ensureLock(); await this.#append("lifecycle.ndjson", event); });
  }
  async recordActivity(sample: ActivitySample): Promise<void> {
    await this.#record(async () => { await this.#ensureLock(); await this.#append("activity.ndjson", sample); });
  }
  async recordTuiInput(input: { kind: "text" | "key"; value: string; at: string }): Promise<void> {
    await this.#record(async () => {
      await this.#ensureLock();
      await this.#append("input.ndjson", { ...input, value: input.kind === "text" ? "<redacted-task-input>" : input.value });
    });
  }
  async recordTuiOutput(frame: TuiOutputFrame): Promise<void> {
    await this.#record(async () => {
      await this.#ensureLock();
      const bytes = Buffer.byteLength(frame.data);
      if (this.#vtBytes + bytes > MAX_VT_BYTES) { await this.#recordTruncation("output.vtlog", MAX_VT_BYTES); return; }
      this.#vtBytes += bytes;
      await appendFile(path.join(this.sessionRoot, "output.vtlog"), frame.data, "utf8");
    });
  }
  async recordTuiSnapshot(snapshot: TuiSnapshot): Promise<void> {
    await this.#record(async () => {
      await this.#ensureLock();
      await this.#append("screen-frames.ndjson", { ...snapshot, screen: redact(snapshot.screen) });
      await writeFile(path.join(this.sessionRoot, "final-screen.txt"), `${redact(snapshot.screen)}\n`, "utf8");
    });
  }
  async recordTuiObserverSnapshot(snapshot: TuiObserverSnapshot): Promise<void> {
    await this.#record(async () => { await this.#ensureLock(); await this.#append("observer.ndjson", snapshot); });
  }
  async recordGuiSnapshot(label: string, snapshot: GuiSnapshot): Promise<void> {
    await this.#record(async () => {
      await this.#ensureLock();
      await this.#append(path.join("gui", "browser-report.ndjson"), { label, ...snapshot });
    });
  }
  async recordAuthoritySnapshot(snapshot: AuthoritySnapshot): Promise<void> {
    await this.#record(async () => {
      await this.#ensureLock();
      await this.#append("authority.ndjson", snapshot);
      await writeJson(path.join(this.sessionRoot, "run-events.json"), snapshot);
    });
  }
  finalize(result: HarnessResult): Promise<void> {
    this.#finalizePromise ??= this.#finalizeOnce(result);
    return this.#finalizePromise;
  }

  async #finalizeOnce(result: HarnessResult): Promise<void> {
    await this.#waitForRecords();
    const lock = await this.#ensureLock();
    try {
      await this.#consolidateMcpAudit();
      await writeJson(path.join(this.sessionRoot, "result.json"), result);
    } finally {
      this.#lockPromise = undefined;
      await releaseEvidenceLock(this.#lockPath(), lock);
    }
  }

  async #ensureLock(): Promise<OwnedEvidenceLock> {
    this.#lockPromise ??= acquireEvidenceLock(this.#lockPath(), `${this.#lockPath()}.recovery`);
    return await this.#lockPromise;
  }

  #lockPath(): string { return path.join(this.sessionRoot, ".evidence.lock"); }

  #assertRecordable(): void {
    if (this.#finalizePromise !== undefined) throw new Error("Evidence session finalization has already started");
  }

  async #record(operation: () => Promise<void>): Promise<void> {
    this.#assertRecordable();
    this.#activeRecords += 1;
    try {
      await operation();
    } finally {
      this.#activeRecords -= 1;
      if (this.#activeRecords === 0) {
        for (const resolve of this.#recordDrainWaiters) resolve();
        this.#recordDrainWaiters.clear();
      }
    }
  }

  async #waitForRecords(): Promise<void> {
    if (this.#activeRecords === 0) return;
    await new Promise<void>((resolve) => this.#recordDrainWaiters.add(resolve));
  }

  async #append(relative: string, value: unknown): Promise<void> {
    const target = path.join(this.sessionRoot, relative);
    const line = `${JSON.stringify(value)}\n`;
    await serializeAppend(target, async () => {
      await mkdir(path.dirname(target), { recursive: true });
      const size = await readFile(target).then((data) => data.byteLength, () => 0);
      if (size + Buffer.byteLength(line) > MAX_NDJSON_BYTES) { await this.#recordTruncation(relative, MAX_NDJSON_BYTES); return; }
      await appendFile(target, line, "utf8");
    });
  }

  async #recordTruncation(file: string, limitBytes: number): Promise<void> {
    if (this.#truncated.has(file)) return;
    this.#truncated.add(file);
    await appendFile(path.join(this.sessionRoot, "lifecycle.ndjson"), `${JSON.stringify({ phase: "running", at: new Date().toISOString(), detail: `evidence-truncated:${file}:${limitBytes}` })}\n`, "utf8");
  }

  async #consolidateMcpAudit(): Promise<void> {
    const directory = path.join(this.sessionRoot, "mcp-audit");
    const names = await readdir(directory).catch(() => []);
    const records = []; let totalBytes = 0;
    for (const name of names.sort().slice(0, MAX_MCP_AUDIT_FILES)) {
      const data = await readFile(path.join(directory, name)).catch(() => undefined);
      if (data === undefined) continue;
      const remaining = MAX_MCP_AUDIT_TOTAL_BYTES - totalBytes;
      if (remaining <= 0) { await this.#recordTruncation("mcp-audit.json", MAX_MCP_AUDIT_TOTAL_BYTES); break; }
      const limit = Math.min(MAX_MCP_AUDIT_FILE_BYTES, remaining);
      const truncated = data.byteLength > limit;
      const content = data.subarray(0, limit).toString("utf8"); totalBytes += Buffer.byteLength(content);
      records.push({ file: name, content: redact(content), ...(truncated ? { truncated: true } : {}) });
      if (truncated) await this.#recordTruncation(`mcp-audit/${name}`, limit);
    }
    if (names.length > MAX_MCP_AUDIT_FILES) await this.#recordTruncation("mcp-audit.json:file-count", MAX_MCP_AUDIT_FILES);
    await writeJson(path.join(this.sessionRoot, "mcp-audit.json"), records);
  }
}

async function acquireEvidenceLock(lockPath: string, recoveryPath: string): Promise<OwnedEvidenceLock> {
  await mkdir(path.dirname(lockPath), { recursive: true });
  try {
    return await createEvidenceLock(lockPath);
  } catch (error) {
    if (!isNodeError(error, "EEXIST")) throw error;
  }

  const recovery = await acquireRecoveryGuard(recoveryPath);
  try {
    const candidate = await readEvidenceLock(lockPath);
    if (candidate.kind === "missing") return await createEvidenceLock(lockPath);
    if (candidate.kind === "invalid") {
      if (Date.now() - candidate.mtimeMs < LOCK_STALE_AFTER_MS) throw new Error("Evidence session lock has unknown metadata; refusing automatic recovery");
      const current = await readEvidenceLock(lockPath);
      if (current.kind !== "invalid" || !sameInvalidLock(candidate, current)) {
        throw new Error("Evidence session lock changed during recovery; refusing to remove it");
      }
      await unlink(lockPath);
      return await createEvidenceLock(lockPath);
    }
    if (candidate.metadata.hostname !== hostname()) throw new Error("Evidence session lock belongs to another host; refusing automatic recovery");
    const age = Date.now() - candidate.metadata.createdAtMs;
    if (!Number.isSafeInteger(age) || age < LOCK_STALE_AFTER_MS) {
      if (processIsAlive(candidate.metadata.pid)) throw new Error("Evidence session is locked by an active writer");
      throw new Error("Evidence session lock is too recent for crash recovery");
    }
    if (processIsAlive(candidate.metadata.pid)) throw new Error("Evidence session is locked by an active writer");
    const current = await readEvidenceLock(lockPath);
    if (current.kind !== "valid" || current.metadata.token !== candidate.metadata.token) {
      throw new Error("Evidence session lock changed during recovery; refusing to remove it");
    }
    await unlink(lockPath);
    try {
      return await createEvidenceLock(lockPath);
    } catch (error) {
      if (isNodeError(error, "EEXIST")) throw new Error("Evidence session lock was acquired by another writer during recovery");
      throw error;
    }
  } finally {
    await releaseEvidenceLock(recoveryPath, recovery);
  }
}

async function acquireRecoveryGuard(recoveryPath: string): Promise<OwnedEvidenceLock> {
  try {
    return await createEvidenceLock(recoveryPath);
  } catch (error) {
    if (!isNodeError(error, "EEXIST")) throw error;
  }
  const candidate = await readEvidenceLock(recoveryPath);
  if (candidate.kind === "invalid" && Date.now() - candidate.mtimeMs >= LOCK_STALE_AFTER_MS) {
    const current = await readEvidenceLock(recoveryPath);
    if (current.kind !== "invalid" || !sameInvalidLock(candidate, current)) throw new Error("Evidence session recovery guard changed; refusing to remove it");
    await unlink(recoveryPath);
    return await createEvidenceLock(recoveryPath);
  }
  if (candidate.kind !== "valid" || candidate.metadata.hostname !== hostname()) {
    throw new Error("Evidence session lock recovery is already in progress");
  }
  const age = Date.now() - candidate.metadata.createdAtMs;
  if (!Number.isSafeInteger(age) || age < LOCK_STALE_AFTER_MS || processIsAlive(candidate.metadata.pid)) {
    throw new Error("Evidence session lock recovery is already in progress");
  }
  const current = await readEvidenceLock(recoveryPath);
  if (current.kind !== "valid" || current.metadata.token !== candidate.metadata.token) {
    throw new Error("Evidence session recovery guard changed; refusing to remove it");
  }
  await unlink(recoveryPath);
  try {
    return await createEvidenceLock(recoveryPath);
  } catch (error) {
    if (isNodeError(error, "EEXIST")) throw new Error("Evidence session lock recovery was claimed by another writer");
    throw error;
  }
}

async function createEvidenceLock(lockPath: string): Promise<OwnedEvidenceLock> {
  const handle = await open(lockPath, "wx", 0o600);
  try {
    const metadata: EvidenceLockMetadata = {
      version: 1,
      token: randomUUID(),
      pid: process.pid,
      hostname: hostname(),
      createdAtMs: Date.now(),
    };
    await handle.writeFile(`${JSON.stringify(metadata)}\n`, "utf8");
    await handle.sync();
    return { handle, token: metadata.token };
  } catch (error) {
    await handle.close().catch(() => undefined);
    await unlink(lockPath).catch(() => undefined);
    throw error;
  }
}

async function releaseEvidenceLock(lockPath: string, lock: OwnedEvidenceLock): Promise<void> {
  try {
    const handleInfo = await lock.handle.stat({ bigint: true });
    const pathInfo = await lstat(lockPath, { bigint: true }).catch(() => undefined);
    const candidate = await readEvidenceLock(lockPath);
    const owned = pathInfo !== undefined && pathInfo.isFile() && !pathInfo.isSymbolicLink() &&
      pathInfo.dev === handleInfo.dev && pathInfo.ino === handleInfo.ino &&
      candidate.kind === "valid" && candidate.metadata.token === lock.token;
    if (owned) await unlink(lockPath).catch((error: unknown) => { if (!isNodeError(error, "ENOENT")) throw error; });
  } finally {
    await lock.handle.close();
  }
}

type EvidenceLockRead = { kind: "missing" } | { kind: "invalid"; dev: bigint; ino: bigint; size: bigint; mtimeMs: number } | { kind: "valid"; metadata: EvidenceLockMetadata };

async function readEvidenceLock(lockPath: string): Promise<EvidenceLockRead> {
  const info = await lstat(lockPath, { bigint: true }).catch((error: unknown) => {
    if (isNodeError(error, "ENOENT")) return undefined;
    throw error;
  });
  if (info === undefined) return { kind: "missing" };
  const mtimeMs = Number(info.mtimeMs);
  const invalid = (): EvidenceLockRead => ({ kind: "invalid", dev: info.dev, ino: info.ino, size: info.size, mtimeMs });
  if (!info.isFile() || info.isSymbolicLink() || info.size < 1n || info.size > BigInt(LOCK_METADATA_MAX_BYTES) || !Number.isFinite(mtimeMs)) return invalid();
  try {
    const value = JSON.parse(await readFile(lockPath, "utf8")) as Partial<EvidenceLockMetadata>;
    const valid = value.version === 1 && typeof value.token === "string" && value.token.length > 0 &&
      Number.isSafeInteger(value.pid) && (value.pid ?? 0) > 0 && typeof value.hostname === "string" && value.hostname.length > 0 &&
      Number.isSafeInteger(value.createdAtMs) && (value.createdAtMs ?? 0) > 0;
    return valid ? { kind: "valid", metadata: value as EvidenceLockMetadata } : invalid();
  } catch {
    return invalid();
  }
}

function sameInvalidLock(left: Extract<EvidenceLockRead, { kind: "invalid" }>, right: Extract<EvidenceLockRead, { kind: "invalid" }>): boolean {
  return left.dev === right.dev && left.ino === right.ino && left.size === right.size && left.mtimeMs === right.mtimeMs;
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return !isNodeError(error, "ESRCH");
  }
}

function isNodeError(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === code;
}

async function serializeAppend(target: string, operation: () => Promise<void>): Promise<void> {
  const resolved = path.resolve(target);
  const key = process.platform === "win32" ? resolved.toLowerCase() : resolved;
  const previous = appendQueues.get(key) ?? Promise.resolve();
  let release = (): void => undefined;
  const current = new Promise<void>((resolve) => { release = resolve; });
  appendQueues.set(key, current);
  await previous;
  try {
    await operation();
  } finally {
    release();
    if (appendQueues.get(key) === current) appendQueues.delete(key);
  }
}

async function writeJson(file: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function redact(value: string): string {
  return value
    .replace(/(^|[^A-Za-z0-9])sk-[A-Za-z0-9_-]{12,}/g, "$1<redacted-api-key>")
    .replace(/("(?:api[_-]?key|token|secret|password|authorization)"\s*:\s*")[^"]*/gi, "$1<redacted>")
    .replace(/(authorization\s*[:=]\s*bearer\s+)[^\s"']+/gi, "$1<redacted>")
    .replace(/((?:api[_-]?key|token|secret|password)\s*[:=]\s*)[^\s,"']+/gi, "$1<redacted>");
}
