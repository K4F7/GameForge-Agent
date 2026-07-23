import { appendFile, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  ActivitySample, AuthoritySnapshot, EvidenceSink, GuiSnapshot, HarnessPhase, HarnessResult,
  HarnessSession, TuiObserverSnapshot, TuiOutputFrame, TuiSnapshot,
} from "../contracts.js";

const MAX_VT_BYTES = 16 * 1024 * 1024;
const MAX_NDJSON_BYTES = 8 * 1024 * 1024;

export class FileEvidenceSink implements EvidenceSink {
  #vtBytes = 0;
  #truncated = new Set<string>();
  constructor(readonly sessionRoot: string) {}

  async recordSession(session: HarnessSession): Promise<void> {
    await mkdir(path.join(this.sessionRoot, "gui"), { recursive: true });
    await writeJson(path.join(this.sessionRoot, "metadata.json"), { ...session, evidenceVersion: 1 });
  }
  async recordLifecycle(event: { sessionId: string; phase: HarnessPhase; at: string; detail?: string }): Promise<void> {
    await this.#append("lifecycle.ndjson", event);
  }
  async recordActivity(sample: ActivitySample): Promise<void> { await this.#append("activity.ndjson", sample); }
  async recordTuiInput(input: { kind: "text" | "key"; value: string; at: string }): Promise<void> {
    await this.#append("input.ndjson", { ...input, value: input.kind === "text" ? "<redacted-task-input>" : input.value });
  }
  async recordTuiOutput(frame: TuiOutputFrame): Promise<void> {
    const bytes = Buffer.byteLength(frame.data);
    if (this.#vtBytes + bytes > MAX_VT_BYTES) { await this.#recordTruncation("output.vtlog", MAX_VT_BYTES); return; }
    this.#vtBytes += bytes;
    await appendFile(path.join(this.sessionRoot, "output.vtlog"), frame.data, "utf8");
  }
  async recordTuiSnapshot(snapshot: TuiSnapshot): Promise<void> {
    await this.#append("screen-frames.ndjson", { ...snapshot, screen: redact(snapshot.screen) });
    await writeFile(path.join(this.sessionRoot, "final-screen.txt"), `${redact(snapshot.screen)}\n`, "utf8");
  }
  async recordTuiObserverSnapshot(snapshot: TuiObserverSnapshot): Promise<void> { await this.#append("observer.ndjson", snapshot); }
  async recordGuiSnapshot(label: string, snapshot: GuiSnapshot): Promise<void> {
    await this.#append(path.join("gui", "browser-report.ndjson"), { label, ...snapshot });
  }
  async recordAuthoritySnapshot(snapshot: AuthoritySnapshot): Promise<void> {
    await this.#append("authority.ndjson", snapshot);
    await writeJson(path.join(this.sessionRoot, "run-events.json"), snapshot);
  }
  async finalize(result: HarnessResult): Promise<void> {
    await writeJson(path.join(this.sessionRoot, "result.json"), result);
    await this.#consolidateMcpAudit();
  }

  async #append(relative: string, value: unknown): Promise<void> {
    const target = path.join(this.sessionRoot, relative);
    await mkdir(path.dirname(target), { recursive: true });
    const line = `${JSON.stringify(value)}\n`;
    const size = await readFile(target).then((data) => data.byteLength, () => 0);
    if (size + Buffer.byteLength(line) > MAX_NDJSON_BYTES) { await this.#recordTruncation(relative, MAX_NDJSON_BYTES); return; }
    await appendFile(target, line, "utf8");
  }

  async #recordTruncation(file: string, limitBytes: number): Promise<void> {
    if (this.#truncated.has(file)) return;
    this.#truncated.add(file);
    await appendFile(path.join(this.sessionRoot, "lifecycle.ndjson"), `${JSON.stringify({ phase: "running", at: new Date().toISOString(), detail: `evidence-truncated:${file}:${limitBytes}` })}\n`, "utf8");
  }

  async #consolidateMcpAudit(): Promise<void> {
    const directory = path.join(this.sessionRoot, "mcp-audit");
    const names = await readdir(directory).catch(() => []);
    const records = [];
    for (const name of names.sort()) {
      const content = await readFile(path.join(directory, name), "utf8").catch(() => undefined);
      if (content !== undefined) records.push({ file: name, content: redact(content) });
    }
    await writeJson(path.join(this.sessionRoot, "mcp-audit.json"), records);
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
