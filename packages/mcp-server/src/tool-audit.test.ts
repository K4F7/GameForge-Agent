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
    const bound = await recorder.bindContext(taskId, "run-audit");
    await expect(recorder.bindContext(taskId, "run-audit")).resolves.toEqual(bound);
    await expect(recorder.bindContext(taskId, "another-run")).rejects.toThrow("already bound");

    const audit = mcpToolAuditSchema.parse(JSON.parse(await readFile(auditPath, "utf8")) as unknown);
    expect(audit.context).toMatchObject({ taskId, runId: "run-audit" });
    expect(audit.calls).toMatchObject([
      { sequence: 1, tool: "validate_game_spec", outcome: "success" },
      { sequence: 2, tool: "submit_voice_job", outcome: "error" },
    ]);
    expect(JSON.stringify(audit)).not.toContain("prompt");
    expect(JSON.stringify(audit)).not.toContain("jobHandle");
    if (process.platform !== "win32") expect((await stat(auditPath)).mode & 0o777).toBe(0o600);
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
