import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { mcpToolAuditSchema } from "@gameforge/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { McpToolAuditRecorder } from "./tool-audit.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("MCP tool audit recorder", () => {
  it("atomically records concurrent calls in invocation order without payloads", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "gameforge-mcp-audit-"));
    roots.push(root);
    const auditPath = path.join(root, "session.json");
    const recorder = await McpToolAuditRecorder.create(auditPath);
    const first = recorder.begin("validate_game_spec");
    const second = recorder.begin("submit_voice_job");
    await recorder.finish(second, "error");
    await recorder.finish(first, "success");
    const taskId = "task-00000000-0000-0000-0000-000000000000";
    const attemptId = "attempt-00000000-0000-4000-8000-000000000065";
    const bound = await recorder.bindContext(taskId, "run-audit", attemptId);
    await expect(recorder.bindContext(taskId, "run-audit", attemptId)).resolves.toEqual(bound);
    await expect(recorder.bindContext(taskId, "another-run", attemptId)).rejects.toThrow("already bound");

    const audit = mcpToolAuditSchema.parse(JSON.parse(await readFile(auditPath, "utf8")) as unknown);
    expect(audit.context).toMatchObject({ taskId, runId: "run-audit" });
    expect(audit.calls).toMatchObject([
      { sequence: 1, tool: "validate_game_spec", outcome: "success" },
      { sequence: 2, tool: "submit_voice_job", outcome: "error" },
    ]);
    expect(JSON.stringify(audit)).not.toContain("prompt");
    expect(JSON.stringify(audit)).not.toContain("jobHandle");
    const summary = await recorder.getSummary();
    expect(summary).toMatchObject({
      runId: "run-audit",
      attemptId,
      truncated: false,
      totalCalls: 2,
      calls: [
        { sequence: 1, tool: "validate_game_spec", durationMs: expect.any(Number), outcome: "success" },
        { sequence: 2, tool: "submit_voice_job", durationMs: expect.any(Number), outcome: "error" },
      ],
    });
    expect(summary.audit).toEqual(audit);
    expect(summary.auditDigest).toMatch(/^[a-f0-9]{64}$/);
    if (process.platform !== "win32") expect((await stat(auditPath)).mode & 0o777).toBe(0o600);
  });

  it("refuses to project an audit before it is bound to a Task and Run", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "gameforge-mcp-audit-"));
    roots.push(root);
    const recorder = await McpToolAuditRecorder.create(path.join(root, "session.json"));
    await expect(recorder.getSummary()).rejects.toThrow("not bound");
  });

  it("keeps every bounded audit call in the authoritative summary", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "gameforge-mcp-audit-"));
    roots.push(root);
    const recorder = await McpToolAuditRecorder.create(path.join(root, "session.json"));
    for (let index = 0; index < 201; index += 1) {
      const token = recorder.begin("validate_game_spec");
      await recorder.finish(token, "success");
    }
    await recorder.bindContext("task-00000000-0000-0000-0000-000000000000", "run-audit", "attempt-00000000-0000-4000-8000-000000000065");

    await expect(recorder.getSummary()).resolves.toMatchObject({
      truncated: false,
      totalCalls: 201,
      calls: expect.arrayContaining([
        expect.objectContaining({ sequence: 1 }),
        expect.objectContaining({ sequence: 201 }),
      ]),
    });
  }, 15_000);

  it("finalizes the persisted audit before the summary and evidence-finalization calls", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "gameforge-mcp-audit-"));
    roots.push(root);
    const auditPath = path.join(root, "session.json");
    const recorder = await McpToolAuditRecorder.create(auditPath);
    await recorder.bindContext(
      "task-00000000-0000-0000-0000-000000000000",
      "run-audit-finalized",
      "attempt-00000000-0000-4000-8000-000000000065",
    );
    const work = recorder.begin("verify_game_project");
    await recorder.finish(work, "success");
    const summaryCall = recorder.begin("get_mcp_audit_summary");

    const summary = await recorder.getSummary();
    await recorder.finish(summaryCall, "success");
    const publication = recorder.begin("publish_run_events");
    await recorder.finish(publication, "success");
    const persisted = mcpToolAuditSchema.parse(JSON.parse(await readFile(auditPath, "utf8")) as unknown);

    expect(summary).toMatchObject({
      truncated: false,
      totalCalls: 1,
      calls: [{ sequence: 1, tool: "verify_game_project", outcome: "success" }],
    });
    expect(persisted.calls.map(({ sequence, tool, durationMs, outcome }) => ({
      sequence,
      tool,
      durationMs,
      outcome,
    }))).toEqual(summary.calls);
  });

  it("rotates a finalized audit epoch for a retry in the same Task", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "gameforge-mcp-audit-"));
    roots.push(root);
    const auditPath = path.join(root, "session.json");
    const recorder = await McpToolAuditRecorder.create(auditPath);
    const taskId = "task-00000000-0000-0000-0000-000000000000";
    const firstAttemptId = "attempt-00000000-0000-4000-8000-000000000065";
    const retryAttemptId = "attempt-00000000-0000-4000-8000-000000000066";
    await recorder.bindContext(taskId, "run-audit-first", firstAttemptId);
    const firstCall = recorder.begin("verify_game_project");
    await recorder.finish(firstCall, "success");
    await expect(recorder.getSummary()).resolves.toMatchObject({
      runId: "run-audit-first",
      attemptId: firstAttemptId,
      totalCalls: 1,
    });
    const lateFirstEpochCall = recorder.begin("publish_run_events");

    await expect(recorder.bindContext(taskId, "run-audit-retry", retryAttemptId)).resolves.toMatchObject({
      taskId,
      runId: "run-audit-retry",
      attemptId: retryAttemptId,
    });
    const retryCall = recorder.begin("get_game_task");
    await recorder.finish(lateFirstEpochCall, "success");
    await recorder.finish(retryCall, "success");
    await expect(recorder.getSummary()).resolves.toMatchObject({
      runId: "run-audit-retry",
      attemptId: retryAttemptId,
      truncated: false,
      totalCalls: 1,
      calls: [{ sequence: 1, tool: "get_game_task", durationMs: expect.any(Number), outcome: "success" }],
    });
    await expect(recorder.bindContext(
      "task-11111111-1111-4111-8111-111111111111",
      "run-other-task",
      "attempt-11111111-1111-4111-8111-111111111111",
    )).rejects.toThrow("already bound");
  });

  it("requires an unused absolute JSON path", async () => {
    await expect(McpToolAuditRecorder.create("relative.json")).rejects.toThrow("absolute JSON");
    const root = await mkdtemp(path.join(tmpdir(), "gameforge-mcp-audit-"));
    roots.push(root);
    const auditPath = path.join(root, "session.json");
    await McpToolAuditRecorder.create(auditPath);
    await expect(McpToolAuditRecorder.create(auditPath)).rejects.toThrow();
    const directoryRecorder = await McpToolAuditRecorder.createInDirectory(path.join(root, "sessions"));
    const token = directoryRecorder.begin("validate_game_spec");
    await directoryRecorder.finish(token, "success");
    await expect(readdir(path.join(root, "sessions"))).resolves.toHaveLength(1);
  });
});
