import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

const roots: string[] = [];
const execFileAsync = promisify(execFile);
const CONPTY_FIXTURE_TIMEOUT_MS = 40_000;
const CONPTY_TEST_TIMEOUT_MS = 45_000;
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))); });

describe("ConPtyCodeArtsDriver", () => {
  it("reports an authorization-required screen before the generic readiness timeout", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "gameforge-conpty-auth-")); roots.push(root);
    const sessionRoot = path.join(root, "evidence");
    await writeFile(path.join(root, "package.json"), JSON.stringify({ private: true, scripts: { codearts: "bun fixture.ts" } }), "utf8");
    await writeFile(path.join(root, "fixture.ts"), `process.stdout.write("Authorization required. Run /login to continue.\\r\\n"); process.stdin.resume(); setInterval(() => undefined, 1_000);`, "utf8");
    const runner = path.join(root, "runner.ts");
    const driverUrl = new URL("./conpty-codearts.ts", import.meta.url).href;
    await writeFile(runner, `
      import { ConPtyCodeArtsDriver } from ${JSON.stringify(driverUrl)};
      const driver = new ConPtyCodeArtsDriver(${JSON.stringify({ repoRoot: root, sessionRoot })});
      try { await driver.start({ session: { sessionId: "auth-required", startedAt: new Date().toISOString(), mode: "headed/watch" }, columns: 80, rows: 24 }); }
      catch (error) { process.stdout.write("AUTH_RESULT:" + (error instanceof Error ? error.message : String(error))); }
      finally { await driver.stop("failed").catch(() => undefined); }
    `, "utf8");

    const { stdout } = await execFileAsync(process.env.GAMEFORGE_BUN_BIN?.trim() || "bun", ["run", runner], { cwd: root, timeout: CONPTY_FIXTURE_TIMEOUT_MS });
    expect(stdout).toContain("AUTH_RESULT:");
    expect(stdout).toMatch(/authorization is required or expired/i);
  }, CONPTY_TEST_TIMEOUT_MS);

  it("reports an exited snapshot after stopping a real ConPTY session", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "gameforge-conpty-")); roots.push(root);
    const sessionRoot = path.join(root, "evidence");
    await writeFile(path.join(root, "package.json"), JSON.stringify({
      private: true,
      scripts: { codearts: "bun fixture.ts" },
    }), "utf8");
    await writeFile(path.join(root, "fixture.ts"), `
      process.stdout.write(JSON.stringify({ pid: process.pid, argv: process.argv.slice(2), attach: process.env.GAMEFORGE_CODEARTS_ATTACH_URL ?? null }) + "\\r\\n");
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
      const childPid = Number(started.screen.match(/"pid":(\\d+)/)?.[1]);
      if (!Number.isSafeInteger(childPid)) throw new Error("Expected fixture PID in TUI output.");
      await driver.stop("completed");
      let childAlive = false;
      try { process.kill(childPid, 0); childAlive = true; } catch {}
      const stopped = await driver.read();
      process.stdout.write(JSON.stringify({ started: started.status, stopped: stopped.status, childAlive }));
    `, "utf8");
    const { stdout } = await execFileAsync(process.env.GAMEFORGE_BUN_BIN?.trim() || "bun", ["run", runner], { cwd: root, timeout: CONPTY_FIXTURE_TIMEOUT_MS });
    expect(JSON.parse(stdout.slice(stdout.lastIndexOf("{") || 0))).toEqual({ started: "running", stopped: "exited", childAlive: false });
  }, CONPTY_TEST_TIMEOUT_MS);

  it("rolls back a ConPTY that exits before ready so the driver can start again", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "gameforge-conpty-startup-rollback-")); roots.push(root);
    const sessionRoot = path.join(root, "evidence");
    await writeFile(path.join(root, "package.json"), JSON.stringify({ private: true, scripts: { codearts: "bun fixture.ts" } }), "utf8");
    await writeFile(path.join(root, "fixture.ts"), `
      import { existsSync, writeFileSync } from "node:fs";
      import path from "node:path";
      const marker = path.join(import.meta.dir, "second-start.marker");
      if (!existsSync(marker)) {
        writeFileSync(marker, "ready");
        process.stdout.write("startup failed before ready" + String.fromCharCode(13, 10));
        process.exit(1);
      }
      process.stdout.write(JSON.stringify({ pid: process.pid }) + String.fromCharCode(13, 10) + "Ask anything" + String.fromCharCode(13, 10));
      process.stdin.resume();
      setInterval(() => undefined, 1_000);
    `, "utf8");
    const runner = path.join(root, "runner.ts");
    const driverUrl = new URL("./conpty-codearts.ts", import.meta.url).href;
    await writeFile(runner, `
      import { ConPtyCodeArtsDriver } from ${JSON.stringify(driverUrl)};
      const driver = new ConPtyCodeArtsDriver(${JSON.stringify({ repoRoot: root, sessionRoot })});
      const session = { sessionId: "session-startup-rollback", startedAt: "2026-07-24T00:00:00.000Z", mode: "headless" };
      let firstRejected = false;
      try { await driver.start({ session, columns: 80, rows: 24 }); } catch { firstRejected = true; }
      let secondStatus = "rejected";
      let secondError = null;
      try { secondStatus = (await driver.start({ session, columns: 80, rows: 24 })).status; } catch (error) { secondError = error instanceof Error ? error.message : String(error); }
      const screen = (await driver.read()).screen;
      await driver.stop("completed");
      process.stdout.write("ROLLBACK_RESULT:" + JSON.stringify({ firstRejected, secondStatus, secondError, screen }));
    `, "utf8");
    const { stdout } = await execFileAsync(process.env.GAMEFORGE_BUN_BIN?.trim() || "bun", ["run", runner], { cwd: root, timeout: CONPTY_FIXTURE_TIMEOUT_MS });
    expect(JSON.parse(stdout.slice(stdout.lastIndexOf("ROLLBACK_RESULT:") + "ROLLBACK_RESULT:".length))).toEqual({ firstRejected: true, secondStatus: "running", secondError: null, screen: expect.stringContaining("Ask anything") });
  }, CONPTY_TEST_TIMEOUT_MS);

  it("rejects a concurrent start without losing ownership of the running ConPTY", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "gameforge-conpty-concurrent-start-")); roots.push(root);
    const sessionRoot = path.join(root, "evidence");
    await writeFile(path.join(root, "package.json"), JSON.stringify({
      private: true,
      scripts: { codearts: "bun fixture.ts" },
    }), "utf8");
    await writeFile(path.join(root, "fixture.ts"), `
      process.stdout.write(JSON.stringify({ pid: process.pid }) + "\\r\\nAsk anything\\r\\n");
      process.stdin.resume();
      setInterval(() => undefined, 1_000);
    `, "utf8");
    const runner = path.join(root, "runner.ts");
    const driverUrl = new URL("./conpty-codearts.ts", import.meta.url).href;
    await writeFile(runner, `
      import { ConPtyCodeArtsDriver } from ${JSON.stringify(driverUrl)};
      const driver = new ConPtyCodeArtsDriver(${JSON.stringify({ repoRoot: root, sessionRoot })});
      const session = { sessionId: "session-concurrent-start", startedAt: "2026-07-24T00:00:00.000Z", mode: "headless" };
      const starts = await Promise.allSettled([
        driver.start({ session, columns: 80, rows: 24 }),
        driver.start({ session, columns: 80, rows: 24 }),
      ]);
      const screen = (await driver.read()).screen;
      await driver.stop("completed");
      const pids = [...screen.matchAll(/"pid":(\\d+)/g)].map((match) => Number(match[1]));
      for (const pid of pids) {
        let alive = false;
        try { process.kill(pid, 0); alive = true; } catch {}
        if (alive && process.platform === "win32") await Bun.spawn(["taskkill.exe", "/PID", String(pid), "/T", "/F"], { stdout: "ignore", stderr: "ignore" }).exited;
      }
      process.stdout.write(JSON.stringify({ statuses: starts.map((entry) => entry.status).sort(), pidCount: new Set(pids).size }));
    `, "utf8");
    const { stdout } = await execFileAsync(process.env.GAMEFORGE_BUN_BIN?.trim() || "bun", ["run", runner], { cwd: root, timeout: CONPTY_FIXTURE_TIMEOUT_MS });
    expect(JSON.parse(stdout.slice(stdout.lastIndexOf("{")))).toEqual({ statuses: ["fulfilled", "rejected"], pidCount: 1 });
  }, CONPTY_TEST_TIMEOUT_MS);

  it("cancels a ConPTY start that has entered asynchronous initialization", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "gameforge-conpty-cancel-start-")); roots.push(root);
    const sessionRoot = path.join(root, "evidence");
    await writeFile(path.join(root, "package.json"), JSON.stringify({ private: true, scripts: { codearts: "bun fixture.ts" } }), "utf8");
    await writeFile(path.join(root, "fixture.ts"), `
      process.stdout.write(JSON.stringify({ pid: process.pid }) + "\\r\\nAsk anything\\r\\n");
      process.stdin.resume();
      setInterval(() => undefined, 1_000);
    `, "utf8");
    const runner = path.join(root, "runner.ts");
    const driverUrl = new URL("./conpty-codearts.ts", import.meta.url).href;
    await writeFile(runner, `
      import { ConPtyCodeArtsDriver } from ${JSON.stringify(driverUrl)};
      const driver = new ConPtyCodeArtsDriver(${JSON.stringify({ repoRoot: root, sessionRoot })});
      const session = { sessionId: "session-cancel-start", startedAt: "2026-07-24T00:00:00.000Z", mode: "headless" };
      const starting = driver.start({ session, columns: 80, rows: 24 });
      await driver.stop("cancelled");
      let startRejected = false;
      try { await starting; } catch { startRejected = true; }
      const statusAfterStop = (await driver.read()).status;
      await driver.stop("cancelled");
      process.stdout.write("CANCEL_START_RESULT:" + JSON.stringify({ startRejected, statusAfterStop }));
    `, "utf8");
    const { stdout } = await execFileAsync(process.env.GAMEFORGE_BUN_BIN?.trim() || "bun", ["run", runner], { cwd: root, timeout: CONPTY_FIXTURE_TIMEOUT_MS });
    expect(JSON.parse(stdout.slice(stdout.lastIndexOf("CANCEL_START_RESULT:") + "CANCEL_START_RESULT:".length))).toEqual({
      startRejected: true,
      statusAfterStop: "exited",
    });
  }, CONPTY_TEST_TIMEOUT_MS);

  it("rejects starting a new ConPTY while the previous process tree is stopping", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "gameforge-conpty-start-during-stop-")); roots.push(root);
    const sessionRoot = path.join(root, "evidence");
    await writeFile(path.join(root, "package.json"), JSON.stringify({ private: true, scripts: { codearts: "bun fixture.ts" } }), "utf8");
    await writeFile(path.join(root, "fixture.ts"), `
      process.stdout.write(JSON.stringify({ pid: process.pid }) + "\\r\\nAsk anything\\r\\n");
      process.stdin.resume();
      setInterval(() => undefined, 1_000);
    `, "utf8");
    const runner = path.join(root, "runner.ts");
    const driverUrl = new URL("./conpty-codearts.ts", import.meta.url).href;
    await writeFile(runner, `
      import { ConPtyCodeArtsDriver } from ${JSON.stringify(driverUrl)};
      const driver = new ConPtyCodeArtsDriver(${JSON.stringify({ repoRoot: root, sessionRoot })});
      const session = { sessionId: "session-start-during-stop", startedAt: "2026-07-24T00:00:00.000Z", mode: "headless" };
      await driver.start({ session, columns: 80, rows: 24 });
      const stopping = driver.stop("completed");
      let restart = "accepted";
      try { await driver.start({ session, columns: 80, rows: 24 }); } catch { restart = "rejected"; }
      await stopping;
      await driver.stop("cancelled");
      process.stdout.write(JSON.stringify({ restart }));
    `, "utf8");
    const { stdout } = await execFileAsync(process.env.GAMEFORGE_BUN_BIN?.trim() || "bun", ["run", runner], { cwd: root, timeout: CONPTY_FIXTURE_TIMEOUT_MS });
    expect(JSON.parse(stdout.slice(stdout.lastIndexOf("{")))).toEqual({ restart: "rejected" });
  }, CONPTY_TEST_TIMEOUT_MS);

  it("shares in-flight cleanup across concurrent ConPTY stop calls", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "gameforge-conpty-concurrent-stop-")); roots.push(root);
    const sessionRoot = path.join(root, "evidence");
    await writeFile(path.join(root, "package.json"), JSON.stringify({ private: true, scripts: { codearts: "bun fixture.ts" } }), "utf8");
    await writeFile(path.join(root, "fixture.ts"), `
      process.stdout.write(JSON.stringify({ pid: process.pid }) + "\\r\\nAsk anything\\r\\n");
      process.stdin.resume();
      setInterval(() => undefined, 1_000);
    `, "utf8");
    const runner = path.join(root, "runner.ts");
    const driverUrl = new URL("./conpty-codearts.ts", import.meta.url).href;
    await writeFile(runner, `
      import { ConPtyCodeArtsDriver } from ${JSON.stringify(driverUrl)};
      const driver = new ConPtyCodeArtsDriver(${JSON.stringify({ repoRoot: root, sessionRoot })});
      const session = { sessionId: "session-concurrent-stop", startedAt: "2026-07-24T00:00:00.000Z", mode: "headless" };
      const started = await driver.start({ session, columns: 80, rows: 24 });
      const pid = Number(started.screen.match(/"pid":(\\d+)/)?.[1]);
      let firstStopSettled = false;
      const firstStop = driver.stop("completed").then(() => { firstStopSettled = true; });
      await driver.stop("completed");
      let processAliveWhenSecondResolved = false;
      try { process.kill(pid, 0); processAliveWhenSecondResolved = true; } catch {}
      const firstStopSettledWhenSecondResolved = firstStopSettled;
      await firstStop;
      process.stdout.write(JSON.stringify({ firstStopSettledWhenSecondResolved, processAliveWhenSecondResolved }));
    `, "utf8");
    const { stdout } = await execFileAsync(process.env.GAMEFORGE_BUN_BIN?.trim() || "bun", ["run", runner], { cwd: root, timeout: CONPTY_FIXTURE_TIMEOUT_MS });
    expect(JSON.parse(stdout.slice(stdout.lastIndexOf("{")))).toEqual({ firstStopSettledWhenSecondResolved: true, processAliveWhenSecondResolved: false });
  }, CONPTY_TEST_TIMEOUT_MS);

  it("replays buffered VT output to a replay subscriber without duplicating live frames", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "gameforge-conpty-replay-")); roots.push(root);
    const sessionRoot = path.join(root, "evidence");
    await writeFile(path.join(root, "package.json"), JSON.stringify({ private: true, scripts: { codearts: "bun fixture.ts" } }), "utf8");
    await writeFile(path.join(root, "fixture.ts"), `
      process.stdout.write("early-marker\\r\\nAsk anything\\r\\n");
      setInterval(() => process.stdout.write("late-marker\\r\\n"), 200);
      process.stdin.resume();
    `, "utf8");
    const runner = path.join(root, "runner.ts");
    const driverUrl = new URL("./conpty-codearts.ts", import.meta.url).href;
    await writeFile(runner, `
      import { ConPtyCodeArtsDriver } from ${JSON.stringify(driverUrl)};
      const driver = new ConPtyCodeArtsDriver(${JSON.stringify({ repoRoot: root, sessionRoot })});
      const session = { sessionId: "session-replay", startedAt: "2026-07-26T00:00:00.000Z", mode: "headless" };
      await driver.start({ session, columns: 80, rows: 24 });
      const replayFrames = [];
      const liveFrames = [];
      driver.subscribeOutput((frame) => replayFrames.push(frame), { replayBuffered: true });
      driver.subscribeOutput((frame) => liveFrames.push(frame));
      await new Promise((resolve) => setTimeout(resolve, 700));
      await driver.stop("completed");
      const sequences = replayFrames.map((frame) => frame.sequence);
      process.stdout.write("REPLAY_RESULT:" + JSON.stringify({
        replaySeesEarly: replayFrames.map((frame) => frame.data).join("").includes("early-marker"),
        replaySeesLate: replayFrames.map((frame) => frame.data).join("").includes("late-marker"),
        liveSeesEarly: liveFrames.map((frame) => frame.data).join("").includes("early-marker"),
        liveSeesLate: liveFrames.map((frame) => frame.data).join("").includes("late-marker"),
        replaySessionIds: [...new Set(replayFrames.map((frame) => frame.sessionId))],
        monotonic: sequences.every((value, index) => index === 0 || value >= sequences[index - 1]),
      }));
    `, "utf8");
    const { stdout } = await execFileAsync(process.env.GAMEFORGE_BUN_BIN?.trim() || "bun", ["run", runner], { cwd: root, timeout: CONPTY_FIXTURE_TIMEOUT_MS });
    expect(JSON.parse(stdout.slice(stdout.lastIndexOf("REPLAY_RESULT:") + "REPLAY_RESULT:".length))).toEqual({
      replaySeesEarly: true,
      replaySeesLate: true,
      liveSeesEarly: false,
      liveSeesLate: true,
      replaySessionIds: ["session-replay"],
      monotonic: true,
    });
  }, CONPTY_TEST_TIMEOUT_MS);

  it("attaches to a credential-free loopback CodeArts server and preserves isolated env", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "gameforge-conpty-")); roots.push(root);
    const sessionRoot = path.join(root, "evidence");
    await writeFile(path.join(root, "package.json"), JSON.stringify({ private: true, scripts: { codearts: "bun fixture.ts" } }), "utf8");
    await writeFile(path.join(root, "fixture.ts"), `
      process.stdout.write(JSON.stringify({ argv: process.argv.slice(2), attach: process.env.GAMEFORGE_CODEARTS_ATTACH_URL ?? null }) + "\\r\\n");
      process.stdout.write("Ask anything\\r\\n");
      process.stdin.resume();
      setInterval(() => undefined, 1_000);
    `, "utf8");
    const runner = path.join(root, "runner.ts");
    const driverUrl = new URL("./conpty-codearts.ts", import.meta.url).href;
    await writeFile(runner, `
      import { ConPtyCodeArtsDriver } from ${JSON.stringify(driverUrl)};
      const driver = new ConPtyCodeArtsDriver(${JSON.stringify({ repoRoot: root, sessionRoot, attach: { serverUrl: "http://127.0.0.1:4097", sessionId: "ses_probe" } })});
      const session = { sessionId: "session-conpty", startedAt: "2026-07-23T00:00:00.000Z", mode: "headless" };
      await driver.start({ session, columns: 80, rows: 24 });
      const output = (await driver.read()).screen;
      await driver.stop("completed");
      process.stdout.write(JSON.stringify({ output }));
    `, "utf8");
    const { stdout } = await execFileAsync(process.env.GAMEFORGE_BUN_BIN?.trim() || "bun", ["run", runner], { cwd: root, timeout: CONPTY_FIXTURE_TIMEOUT_MS });
    expect(stdout).toContain("attach");
    expect(stdout).toContain("http://127.0.0.1:4097");
    expect(stdout).toContain("ses_probe");
  }, CONPTY_TEST_TIMEOUT_MS);

  it("recognizes the attach welcome screen when the legacy prompt is absent", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "gameforge-conpty-")); roots.push(root);
    const sessionRoot = path.join(root, "evidence");
    await writeFile(path.join(root, "package.json"), JSON.stringify({ private: true, scripts: { codearts: "bun fixture.ts" } }), "utf8");
    await writeFile(path.join(root, "fixture.ts"), `
      process.stdout.write("Build\\r\\ntab agents\\r\\n");
      process.stdin.resume();
      setInterval(() => undefined, 1_000);
    `, "utf8");
    const runner = path.join(root, "runner.ts");
    const driverUrl = new URL("./conpty-codearts.ts", import.meta.url).href;
    await writeFile(runner, `
      import { ConPtyCodeArtsDriver } from ${JSON.stringify(driverUrl)};
      const driver = new ConPtyCodeArtsDriver(${JSON.stringify({ repoRoot: root, sessionRoot, attach: { serverUrl: "http://127.0.0.1:4097", sessionId: "ses_probe" } })});
      const session = { sessionId: "session-conpty", startedAt: "2026-07-23T00:00:00.000Z", mode: "headless" };
      const started = await driver.start({ session, columns: 80, rows: 24 });
      await driver.stop("completed");
      process.stdout.write(JSON.stringify({ status: started.status, screen: started.screen }));
    `, "utf8");
    const { stdout } = await execFileAsync(process.env.GAMEFORGE_BUN_BIN?.trim() || "bun", ["run", runner], { cwd: root, timeout: CONPTY_FIXTURE_TIMEOUT_MS });
    expect(stdout).toContain('"status":"running"');
    expect(stdout).toContain("Build");
  }, CONPTY_TEST_TIMEOUT_MS);

  it("submits attach text through the CodeArts session API when Win32 input mode is enabled", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "gameforge-conpty-")); roots.push(root);
    const sessionRoot = path.join(root, "evidence");
    await writeFile(path.join(root, "package.json"), JSON.stringify({ private: true, scripts: { codearts: "bun fixture.ts" } }), "utf8");
    await writeFile(path.join(root, "fixture.ts"), `
      process.stdout.write("\\x1b[?9001hBuild\\r\\ntab agents\\r\\n");
      process.stdin.resume();
      setInterval(() => undefined, 1_000);
    `, "utf8");
    const runner = path.join(root, "runner.ts");
    const driverUrl = new URL("./conpty-codearts.ts", import.meta.url).href;
    await writeFile(runner, `
      import { ConPtyCodeArtsDriver } from ${JSON.stringify(driverUrl)};
      const requests: Array<{ url: string; method: string; body: unknown }> = [];
      globalThis.fetch = async (input, init) => {
        const request = input instanceof Request ? input : new Request(input, init);
        requests.push({ url: request.url, method: request.method, body: await request.clone().json() });
        return new Response(null, { status: 204 });
      };
      const driver = new ConPtyCodeArtsDriver(${JSON.stringify({ repoRoot: root, sessionRoot, attach: { serverUrl: "http://127.0.0.1:4097", sessionId: "ses_probe" } })});
      const session = { sessionId: "session-conpty", startedAt: "2026-07-23T00:00:00.000Z", mode: "headless" };
      await driver.start({ session, columns: 80, rows: 24 });
      await driver.sendText("probe", { appendEnter: true });
      await driver.stop("completed");
      process.stdout.write(JSON.stringify({ requests }));
    `, "utf8");
    const { stdout } = await execFileAsync(process.env.GAMEFORGE_BUN_BIN?.trim() || "bun", ["run", runner], { cwd: root, timeout: CONPTY_FIXTURE_TIMEOUT_MS });
    const result = JSON.parse(stdout.slice(stdout.lastIndexOf("{\"requests\":"))) as {
      requests: Array<{ url: string; method: string; body: { parts: Array<{ type: string; text: string }> } }>;
    };
    expect(result.requests).toEqual([{
      url: "http://127.0.0.1:4097/session/ses_probe/prompt_async",
      method: "POST",
      body: { parts: [{ type: "text", text: "probe" }] },
    }]);
  }, CONPTY_TEST_TIMEOUT_MS);
});
