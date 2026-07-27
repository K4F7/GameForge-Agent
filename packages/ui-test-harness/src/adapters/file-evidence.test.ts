import { spawn } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, rm, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import type { HarnessResult, HarnessSession } from "../contracts.js";
import { FileEvidenceSink } from "./file-evidence.js";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

describe("FileEvidenceSink", () => {
  it("requires a bound non-truncated read-only MCP audit before accepting completion", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "gameforge-evidence-")); roots.push(root);
    const sink = new FileEvidenceSink(root);
    const session: HarnessSession = { sessionId: "acceptance-evidence", taskId: "task-00000000-0000-0000-0000-000000000000", runId: "run-evidence", startedAt: "2026-07-23T00:00:00.000Z", mode: "headed/watch", tier: "acceptance" };
    await sink.recordSession(session);
    await mkdir(path.join(root, "mcp-audit"));
    await writeFile(path.join(root, "mcp-audit", "session.json"), JSON.stringify({
      schemaVersion: 1, sessionId: "00000000-0000-4000-8000-000000000000", startedAt: session.startedAt, truncated: false,
      context: { taskId: session.taskId, runId: session.runId, boundAt: session.startedAt },
      calls: ["bind_mcp_audit_context", "get_game_task", "complete_game_run"].map((tool, index) => ({ sequence: index + 1, tool, startedAt: session.startedAt, durationMs: 1, outcome: "success" })),
    }), "utf8");
    const result: HarnessResult = { status: "completed", scenario: "acceptance", startedAt: session.startedAt, finishedAt: "2026-07-23T00:01:00.000Z" };

    await expect(sink.finalize(result)).resolves.toBeUndefined();
  });

  it.each([
    { name: "missing", audit: undefined, message: "bound MCP audit" },
    { name: "truncated", audit: { truncated: true, taskId: "task-00000000-0000-0000-0000-000000000000", runId: "run-evidence", tool: "get_game_task" }, message: "truncated" },
    { name: "wrong context", audit: { truncated: false, taskId: "task-11111111-1111-1111-1111-111111111111", runId: "run-evidence", tool: "get_game_task" }, message: "bound MCP audit" },
    { name: "no read-only call", audit: { truncated: false, taskId: "task-00000000-0000-0000-0000-000000000000", runId: "run-evidence", tool: "complete_game_run" }, message: "read-only MCP call" },
    { name: "wrong call order", audit: { truncated: false, taskId: "task-00000000-0000-0000-0000-000000000000", runId: "run-evidence", tool: "get_game_task", wrongOrder: true }, message: "call sequence" },
    { name: "stale", audit: { truncated: false, taskId: "task-00000000-0000-0000-0000-000000000000", runId: "run-evidence", tool: "get_game_task", stale: true }, message: "call sequence" },
  ])("rejects $name audit evidence for a completed acceptance", async ({ audit, message }) => {
    const root = await mkdtemp(path.join(os.tmpdir(), "gameforge-evidence-")); roots.push(root);
    const sink = new FileEvidenceSink(root);
    const session: HarnessSession = { sessionId: `acceptance-${audit?.tool ?? "missing"}`, taskId: "task-00000000-0000-0000-0000-000000000000", runId: "run-evidence", startedAt: "2026-07-23T00:00:00.000Z", mode: "headed/watch", tier: "acceptance" };
    await sink.recordSession(session);
    await mkdir(path.join(root, "mcp-audit"));
    if (audit !== undefined) await writeFile(path.join(root, "mcp-audit", "session.json"), JSON.stringify({
      schemaVersion: 1, sessionId: "00000000-0000-4000-8000-000000000000", startedAt: audit.stale === true ? "2026-07-22T00:00:00.000Z" : session.startedAt, truncated: audit.truncated,
      context: { taskId: audit.taskId, runId: audit.runId, boundAt: audit.stale === true ? "2026-07-22T00:00:00.000Z" : session.startedAt },
      calls: (audit.wrongOrder === true
        ? ["complete_game_run", audit.tool, "bind_mcp_audit_context"]
        : ["bind_mcp_audit_context", audit.tool, "complete_game_run"])
        .map((tool, index) => ({ sequence: index + 1, tool, startedAt: audit.stale === true ? "2026-07-22T00:00:00.000Z" : session.startedAt, durationMs: 1, outcome: "success" })),
    }), "utf8");
    const result: HarnessResult = { status: "completed", scenario: "acceptance", startedAt: session.startedAt, finishedAt: session.startedAt };

    await expect(sink.finalize(result)).resolves.toBeUndefined();
    expect(JSON.parse(await readFile(path.join(root, "result.json"), "utf8"))).toMatchObject({ status: "failed", failure: expect.stringContaining(message) });
  });

  it("accepts a retry whose immutable context is old but whose bind call is fresh", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "gameforge-evidence-")); roots.push(root);
    const sink = new FileEvidenceSink(root);
    const session: HarnessSession = { sessionId: "acceptance-retry", taskId: "task-00000000-0000-0000-0000-000000000000", runId: "run-evidence", startedAt: "2026-07-23T00:00:00.000Z", mode: "headed/watch", tier: "acceptance" };
    await sink.recordSession(session); await mkdir(path.join(root, "mcp-audit"));
    await writeFile(path.join(root, "mcp-audit", "session.json"), JSON.stringify({
      schemaVersion: 1, sessionId: "00000000-0000-4000-8000-000000000000", startedAt: "2026-07-22T00:00:00.000Z", truncated: false,
      context: { taskId: session.taskId, runId: session.runId, boundAt: "2026-07-22T00:00:00.000Z" },
      calls: ["bind_mcp_audit_context", "get_game_task", "complete_game_run"].map((tool, index) => ({ sequence: index + 1, tool, startedAt: session.startedAt, durationMs: 1, outcome: "success" })),
    }), "utf8");

    await expect(sink.finalize({ status: "completed", scenario: "retry", startedAt: session.startedAt, finishedAt: session.startedAt })).resolves.toBeUndefined();
    expect(JSON.parse(await readFile(path.join(root, "result.json"), "utf8"))).toMatchObject({ status: "completed" });
  });

  it("waits for the external producer to persist complete_game_run", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "gameforge-evidence-")); roots.push(root);
    const sink = new FileEvidenceSink(root);
    const session: HarnessSession = { sessionId: "audit-settle", taskId: "task-00000000-0000-0000-0000-000000000000", runId: "run-evidence", startedAt: new Date().toISOString(), mode: "headed/watch", tier: "acceptance" };
    await sink.recordSession(session); await mkdir(path.join(root, "mcp-audit"));
    const auditPath = path.join(root, "mcp-audit", "session.json");
    const writeAudit = (tools: string[]) => writeFile(auditPath, JSON.stringify({ schemaVersion: 1, sessionId: "00000000-0000-4000-8000-000000000000", startedAt: session.startedAt, truncated: false, context: { taskId: session.taskId, runId: session.runId, boundAt: session.startedAt }, calls: tools.map((tool, index) => ({ sequence: index + 1, tool, startedAt: session.startedAt, durationMs: 1, outcome: "success" })) }), "utf8");
    await writeAudit(["bind_mcp_audit_context", "get_game_task"]);
    setTimeout(() => { void writeAudit(["bind_mcp_audit_context", "get_game_task", "complete_game_run"]); }, 100);

    await expect(sink.finalize({ status: "completed", scenario: "acceptance", startedAt: session.startedAt, finishedAt: session.startedAt })).resolves.toBeUndefined();
  });

  it("redacts credentials from consolidated MCP audit evidence", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "gameforge-evidence-")); roots.push(root);
    const sink = new FileEvidenceSink(root);
    const session: HarnessSession = { sessionId: "session-evidence", runId: "run-evidence", startedAt: "2026-07-23T00:00:00.000Z", mode: "headless" };
    await sink.recordSession(session);
    await mkdir(path.join(root, "mcp-audit"));
    await writeFile(path.join(root, "mcp-audit", "call.json"), JSON.stringify({
      apiKey: "api-key-sensitive-value",
      token: "token-sensitive-value",
      authorization: "Bearer authorization-sensitive-value",
      result: "kept",
    }), "utf8");
    const result: HarnessResult = { status: "completed", scenario: "evidence", startedAt: session.startedAt, finishedAt: "2026-07-23T00:01:00.000Z" };
    await sink.finalize(result);

    const evidence = await readFile(path.join(root, "mcp-audit.json"), "utf8");
    expect(evidence).toContain("kept");
    expect(evidence).not.toContain("api-key-sensitive-value");
    expect(evidence).not.toContain("token-sensitive-value");
    expect(evidence).not.toContain("authorization-sensitive-value");
  });

  it("does not consolidate an uncommitted temporary MCP audit file", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "gameforge-evidence-")); roots.push(root);
    const sink = new FileEvidenceSink(root);
    const session: HarnessSession = { sessionId: "temporary-audit", startedAt: "2026-07-23T00:00:00.000Z", mode: "headless" };
    await sink.recordSession(session);
    await mkdir(path.join(root, "mcp-audit"));
    await writeFile(path.join(root, "mcp-audit", "committed.json"), JSON.stringify({ result: "committed" }), "utf8");
    await writeFile(path.join(root, "mcp-audit", "committed.json.temporary.tmp"), JSON.stringify({ result: "uncommitted" }), "utf8");

    await sink.finalize({ status: "completed", scenario: "evidence", startedAt: session.startedAt, finishedAt: session.startedAt });

    const evidence = await readFile(path.join(root, "mcp-audit.json"), "utf8");
    expect(evidence).toContain("committed");
    expect(evidence).not.toContain("uncommitted");
  });

  it("does not publish a completed result before MCP audit consolidation succeeds", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "gameforge-evidence-")); roots.push(root);
    const sink = new FileEvidenceSink(root);
    const session: HarnessSession = { sessionId: "session-finalize-failure", startedAt: "2026-07-23T00:00:00.000Z", mode: "headless" };
    await sink.recordSession(session);
    await mkdir(path.join(root, "mcp-audit.json"));
    const result: HarnessResult = { status: "completed", scenario: "finalize-failure", startedAt: session.startedAt, finishedAt: "2026-07-23T00:01:00.000Z" };

    await expect(sink.finalize(result)).rejects.toThrow();

    await expect(readFile(path.join(root, "result.json"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    await rm(path.join(root, "mcp-audit.json"), { recursive: true });
    const retry = new FileEvidenceSink(root);
    await retry.recordSession(session);
    await retry.finalize(result);
  });

  it("keeps concurrent activity appends within the NDJSON size limit", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "gameforge-evidence-")); roots.push(root);
    const sample = {
      sampledAt: "2026-07-23T00:00:00.000Z",
      tuiOutputSequence: 1,
      authorityEventSequence: 1,
      projectFingerprint: "x".repeat(5 * 1024 * 1024),
    };
    const sink = new FileEvidenceSink(root);
    await Promise.all([sink.recordActivity(sample), sink.recordActivity(sample)]);
    await sink.finalize({ status: "completed", scenario: "concurrent-activity", startedAt: sample.sampledAt, finishedAt: sample.sampledAt });

    const size = (await readFile(path.join(root, "activity.ndjson"))).byteLength;
    expect(size).toBeLessThanOrEqual(8 * 1024 * 1024);
  });

  it("shares concurrent finalization of the same evidence session", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "gameforge-evidence-")); roots.push(root);
    const sink = new FileEvidenceSink(root);
    const session: HarnessSession = { sessionId: "session-concurrent-finalize", startedAt: "2026-07-24T00:00:00.000Z", mode: "headless" };
    const result: HarnessResult = { status: "completed", scenario: "concurrent-finalize", startedAt: session.startedAt, finishedAt: "2026-07-24T00:01:00.000Z" };
    await sink.recordSession(session);

    await Promise.all([sink.finalize(result), sink.finalize(result)]);

    expect(JSON.parse(await readFile(path.join(root, "result.json"), "utf8"))).toEqual(result);
    const retry = new FileEvidenceSink(root);
    await retry.recordSession(session);
    await retry.finalize(result);
  });

  it("rejects new evidence records once finalization has started", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "gameforge-evidence-")); roots.push(root);
    const sink = new FileEvidenceSink(root);
    const session: HarnessSession = { sessionId: "session-finalize-barrier", startedAt: "2026-07-24T00:00:00.000Z", mode: "headless" };
    const result: HarnessResult = { status: "completed", scenario: "finalize-barrier", startedAt: session.startedAt, finishedAt: "2026-07-24T00:01:00.000Z" };
    await sink.recordSession(session);

    const finalizing = sink.finalize(result);
    await expect(sink.recordActivity({ sampledAt: session.startedAt, tuiOutputSequence: 1, authorityEventSequence: 1 }))
      .rejects.toThrow("Evidence session finalization has already started");
    await finalizing;
  });

  it("waits for an accepted evidence record before publishing the final result", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "gameforge-evidence-")); roots.push(root);
    const sink = new FileEvidenceSink(root);
    const session: HarnessSession = { sessionId: "session-finalize-drain", startedAt: "2026-07-24T00:00:00.000Z", mode: "headless" };
    const result: HarnessResult = { status: "completed", scenario: "finalize-drain", startedAt: session.startedAt, finishedAt: "2026-07-24T00:01:00.000Z" };
    await sink.recordSession(session);
    let recordSettled = false;
    const recording = sink.recordTuiSnapshot({
      sessionId: session.sessionId,
      status: "running",
      columns: 80,
      rows: 24,
      outputSequence: 1,
      lastChangedAt: session.startedAt,
      screen: "x".repeat(12 * 1024 * 1024),
    }).then(() => { recordSettled = true; });

    await sink.finalize(result);

    expect(recordSettled).toBe(true);
    await recording;
  });

  it("rejects a second process while another process owns the evidence session", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "gameforge-evidence-")); roots.push(root);
    const child = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "file-evidence-lock-child.ts");
    const holder = spawn("bun", [child, root, "holder"], { stdio: ["ignore", "pipe", "pipe"] });
    try {
      await waitForFile(path.join(root, "holder-ready"));
      const contender = spawn("bun", [child, root, "contender"], { stdio: ["ignore", "pipe", "pipe"] });
      const [contenderExit, contenderError] = await Promise.all([waitForExit(contender), readStream(contender.stderr)]);

      expect(contenderExit).not.toBe(0);
      expect(contenderError).toContain("Evidence session is locked by an active writer");
    } finally {
      await writeFile(path.join(root, "release-holder"), "release\n", "utf8");
      await waitForExit(holder);
    }
  }, 20_000);

  it("recovers an old incomplete lock left by a crashed writer", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "gameforge-evidence-")); roots.push(root);
    const lock = path.join(root, ".evidence.lock");
    await writeFile(lock, "", "utf8");
    const old = new Date(Date.now() - 11 * 60 * 1000);
    await utimes(lock, old, old);
    const sink = new FileEvidenceSink(root);
    const session: HarnessSession = { sessionId: "stale-incomplete-lock", startedAt: "2026-07-24T00:00:00.000Z", mode: "headless" };
    await sink.recordSession(session);
    await sink.finalize({ status: "completed", scenario: "stale-incomplete-lock", startedAt: session.startedAt, finishedAt: session.startedAt });
  });
});

async function waitForFile(file: string): Promise<void> {
  const deadline = Date.now() + 15_000;
  while (!await access(file).then(() => true, () => false)) {
    if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${file}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

async function waitForExit(child: ReturnType<typeof spawn>): Promise<number | null> {
  if (child.exitCode !== null) return child.exitCode;
  return await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", resolve);
  });
}

async function readStream(stream: NodeJS.ReadableStream | null): Promise<string> {
  if (stream === null) return "";
  let output = "";
  stream.setEncoding("utf8");
  for await (const chunk of stream) output += chunk;
  return output;
}
