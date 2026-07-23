import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

const roots: string[] = [];
const execFileAsync = promisify(execFile);
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

describe("ConPtyCodeArtsDriver", () => {
  it("reports an exited snapshot after stopping a real ConPTY session", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "gameforge-conpty-")); roots.push(root);
    const sessionRoot = path.join(root, "evidence");
    await writeFile(path.join(root, "package.json"), JSON.stringify({
      private: true,
      scripts: { codearts: "bun fixture.ts" },
    }), "utf8");
    await writeFile(path.join(root, "fixture.ts"), `
      process.stdout.write("Ask anything\\r\\n");
      process.stdin.resume();
      setInterval(() => undefined, 1_000);
    `, "utf8");
    const runner = path.join(root, "runner.ts");
    const driverUrl = new URL("./conpty-codearts.ts", import.meta.url).href;
    await writeFile(runner, `
      import { ConPtyCodeArtsDriver } from ${JSON.stringify(driverUrl)};
      const driver = new ConPtyCodeArtsDriver(${JSON.stringify({ repoRoot: root, sessionRoot })});
      const session = { sessionId: "session-conpty", startedAt: "2026-07-23T00:00:00.000Z", mode: "headless" };
      const started = await driver.start({ session, columns: 80, rows: 24 });
      await driver.stop("completed");
      const stopped = await driver.read();
      process.stdout.write(JSON.stringify({ started: started.status, stopped: stopped.status }));
    `, "utf8");
    const { stdout } = await execFileAsync(process.env.GAMEFORGE_BUN_BIN?.trim() || "bun", ["run", runner], { cwd: root, timeout: 12_000 });
    expect(JSON.parse(stdout.slice(stdout.lastIndexOf("{") || 0))).toEqual({ started: "running", stopped: "exited" });
  }, 15_000);
});
