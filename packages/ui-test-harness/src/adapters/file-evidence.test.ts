import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { HarnessResult, HarnessSession } from "../contracts.js";
import { FileEvidenceSink } from "./file-evidence.js";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

describe("FileEvidenceSink", () => {
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
});
