import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { prepareHarnessSession } from "./session-bootstrap.js";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

describe("prepareHarnessSession", () => {
  it("records a finalized failure when Authority correlation fails before the scenario starts", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "gameforge-bootstrap-")); roots.push(root);
    const sessionRoot = path.join(root, "sessions", "session-correlation-failure");

    await expect(prepareHarnessSession({
      sessionRoot,
      session: { sessionId: "session-correlation-failure", startedAt: "2026-07-26T00:00:00.000Z", mode: "headless" },
      scenario: "codearts-minimal-closure:baseline",
      correlate: async () => { throw new Error("Relay unreachable"); },
    })).rejects.toThrow("Relay unreachable");

    const result = JSON.parse(await readFile(path.join(sessionRoot, "result.json"), "utf8"));
    expect(result.status).toBe("failed");
    expect(result.scenario).toBe("codearts-minimal-closure:baseline");
    expect(result.failure).toContain("Relay unreachable");
  });
});
