import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const packageRoot = fileURLToPath(new URL("../..", import.meta.url));
const fixture = fileURLToPath(new URL("./playwright-startup-failure.fixture.mjs", import.meta.url));
const xtermFixture = fileURLToPath(new URL("./xterm-startup-failure.fixture.mjs", import.meta.url));
const remoteWaitFixture = fileURLToPath(new URL("./playwright-remote-wait.fixture.mjs", import.meta.url));
const playwrightSuccessCloseFixture = fileURLToPath(new URL("./playwright-success-close.fixture.mjs", import.meta.url));
const doubleLaunchFixture = fileURLToPath(new URL("./playwright-double-launch.fixture.mjs", import.meta.url));
const xtermSuccessCloseFixture = fileURLToPath(new URL("./xterm-success-close.fixture.mjs", import.meta.url));
const xtermPostReadyFailureFixture = fileURLToPath(new URL("./xterm-post-ready-failure.fixture.mjs", import.meta.url));
const roots: string[] = [];

beforeAll(async () => {
  const build = spawn("bun", ["run", "build"], { cwd: packageRoot, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  const result = await waitForExit(build, 30_000);
  if (result.code !== 0) throw new Error(`Harness build failed: ${result.stderr}`);
});
afterAll(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

describe("Browser helper lifecycle", () => {
  it.skipIf(process.platform !== "win32")("rejects immediately when the Playwright helper exits after an invalid endpoint line", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "gameforge-playwright-invalid-endpoint-")); roots.push(root);
    const shimSource = path.join(root, "node-shim.ts");
    const shimExecutable = path.join(root, "node.exe");
    await writeFile(shimSource, 'process.stdout.write("\\n");', "utf8");
    const compile = spawn("bun", ["build", shimSource, "--compile", "--outfile", shimExecutable], { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    const compileResult = await waitForExit(compile, 30_000);
    expect(compileResult.timedOut).toBe(false);
    expect(compileResult.code).toBe(0);

    const child = spawn("bun", [fixture, root], {
      cwd: packageRoot,
      env: { ...process.env, PATH: root + path.delimiter + (process.env.PATH ?? "") },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    const result = await waitForExit(child, 5_000);

    expect(result.timedOut).toBe(false);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("launch rejected");
  }, 40_000);

  it("does not retain the Bun process after remote page launch fails", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "gameforge-playwright-lifecycle-")); roots.push(root);
    const child = spawn("bun", [fixture, root], { cwd: packageRoot, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    const result = await waitForExit(child, 50_000);

    expect(result.timedOut).toBe(false);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("launch rejected");
  }, 60_000);

  it("rejects a second remote launch without replacing the owned helper", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "gameforge-playwright-double-launch-")); roots.push(root);
    const child = spawn("bun", [doubleLaunchFixture, root], { cwd: packageRoot, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    const result = await waitForExit(child, 10_000);

    expect(result.timedOut).toBe(false);
    expect(result.code).toBe(0);
    expect(result.stdout.trim()).toBe("second launch rejected");
  }, 20_000);

  it("rejects a remote launch while the previous helper is closing", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "gameforge-playwright-launch-during-close-")); roots.push(root);
    const child = spawn("bun", [doubleLaunchFixture, root, "--during-close"], { cwd: packageRoot, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    const result = await waitForExit(child, 20_000);

    expect(result.timedOut).toBe(false);
    expect(result.code).toBe(0);
    expect(result.stdout.trim()).toBe("launch while closing rejected");
  }, 30_000);

  it("does not retain the Bun process after visible xterm helper startup fails", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "gameforge-xterm-lifecycle-")); roots.push(root);
    const child = spawn("bun", [xtermFixture, root], { cwd: packageRoot, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    const result = await waitForExit(child, 3_000);

    expect(result.timedOut).toBe(false);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("open rejected");
  }, 10_000);

  it.skipIf(process.platform !== "win32")("rolls back a visible xterm helper when setup fails after ready", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "gameforge-xterm-post-ready-failure-")); roots.push(root);
    const child = spawn("bun", [xtermPostReadyFailureFixture, root], { cwd: packageRoot, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    const result = await waitForExit(child, 20_000);

    expect(result.timedOut).toBe(false);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("open rejected");
  }, 30_000);

  it.skipIf(process.platform !== "win32")("waits for the visible xterm helper to exit before close resolves", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "gameforge-xterm-success-close-")); roots.push(root);
    const child = spawn("bun", [xtermSuccessCloseFixture, root], { cwd: packageRoot, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    const result = await waitForExit(child, 30_000);

    expect(result.timedOut).toBe(false);
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout.trim())).toEqual({ visible: true, helperAliveAfterClose: false, browserPidsAliveAfterClose: [] });
  }, 40_000);

  it.skipIf(process.platform !== "win32")("rejects a snapshot after the visible xterm helper exits", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "gameforge-xterm-exited-snapshot-")); roots.push(root);
    const child = spawn("bun", [xtermSuccessCloseFixture, root, "--kill-before-snapshot"], { cwd: packageRoot, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    const result = await waitForExit(child, 30_000);

    expect(result.timedOut).toBe(false);
    expect(result.code).toBe(0);
    expect(result.stdout.trim()).toBe("snapshot rejected exited helper");
  }, 40_000);

  it.skipIf(process.platform !== "win32")("shares in-flight visible xterm cleanup across concurrent close calls", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "gameforge-xterm-concurrent-close-")); roots.push(root);
    const child = spawn("bun", [xtermSuccessCloseFixture, root, "--concurrent-close"], { cwd: packageRoot, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    const result = await waitForExit(child, 30_000);

    expect(result.timedOut).toBe(false);
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout.trim())).toEqual({ visible: true, helperAliveAfterClose: false, browserPidsAliveAfterClose: [] });
  }, 40_000);

  it.skipIf(process.platform !== "win32")("rejects opening a visible xterm observer while its helper is closing", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "gameforge-xterm-open-during-close-")); roots.push(root);
    const child = spawn("bun", [xtermSuccessCloseFixture, root, "--open-during-close"], { cwd: packageRoot, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    const result = await waitForExit(child, 40_000);

    expect(result.timedOut).toBe(false);
    expect(result.code).toBe(0);
    expect(result.stdout.trim()).toBe("open while closing rejected");
  }, 50_000);

  it("waits through the Node helper and exits after a successful remote close", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "gameforge-playwright-remote-")); roots.push(root);
    const child = spawn("bun", [remoteWaitFixture, root], { cwd: packageRoot, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    const result = await waitForExit(child, 30_000);

    expect(result.timedOut).toBe(false);
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout.trim())).toEqual({
      title: "Remote Complete",
      diagnostics: { consoleErrors: [], pageErrors: [], failedRequests: [] },
    });
  }, 40_000);

  it.skipIf(process.platform !== "win32")("waits for the Playwright helper to exit before close resolves", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "gameforge-playwright-success-close-")); roots.push(root);
    const child = spawn("bun", [playwrightSuccessCloseFixture, root], { cwd: packageRoot, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    const result = await waitForExit(child, 30_000);

    expect(result.timedOut).toBe(false);
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout.trim())).toEqual({ helperAliveAfterClose: false, browserPidsAliveAfterClose: [] });
  }, 40_000);

  it.skipIf(process.platform !== "win32")("shares in-flight Playwright cleanup across concurrent close calls", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "gameforge-playwright-concurrent-close-")); roots.push(root);
    const child = spawn("bun", [playwrightSuccessCloseFixture, root, "--concurrent-close"], { cwd: packageRoot, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    const result = await waitForExit(child, 30_000);

    expect(result.timedOut).toBe(false);
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout.trim())).toEqual({
      helperAliveAfterClose: false,
      browserPidsAliveAfterClose: [],
      firstCloseSettledWhenSecondResolved: true,
    });
  }, 40_000);
});

function waitForExit(child: ChildProcess, timeoutMs: number): Promise<{ code: number | null; stdout: string; stderr: string; timedOut: boolean }> {
  return new Promise((resolve, reject) => {
    let stdout = ""; let stderr = ""; let timedOut = false;
    child.stdout?.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr?.on("data", (chunk) => { stderr += String(chunk); });
    child.once("error", reject);
    child.once("exit", (code) => { clearTimeout(timer); resolve({ code, stdout, stderr, timedOut }); });
    const timer = setTimeout(() => { timedOut = true; void terminateProcessTree(child); }, timeoutMs);
  });
}

async function terminateProcessTree(child: ChildProcess): Promise<void> {
  if (child.pid === undefined) return;
  if (process.platform !== "win32") { child.kill(); return; }
  const taskkill = spawn("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
  await new Promise<void>((resolve) => taskkill.once("exit", () => resolve()));
}
