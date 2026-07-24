import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, test } from "vitest";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

describe("Douyin bridge host process", () => {
  test("releases its lock when startup fails after lock acquisition", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "gameforge-douyin-host-failure-"));
    roots.push(root);
    await mkdir(path.join(root, "gameforge-douyin-bridge-host.json"));
    const script = fileURLToPath(new URL("./douyin-bridge-host.ts", import.meta.url));
    const child = spawn("bun", [script], {
      cwd: path.dirname(script),
      env: { ...process.env, TEMP: root, TMP: root, TMPDIR: root },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });

    const result = await waitForExit(child, 10_000);

    expect(result.timedOut).toBe(false);
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain("The Douyin bridge host rendezvous path is unsafe.");
    await expect(readFile(path.join(root, "gameforge-douyin-bridge-host.lock"), "utf8"))
      .rejects.toMatchObject({ code: "ENOENT" });
  });

});

function waitForExit(child: ReturnType<typeof spawn>, timeoutMs: number): Promise<{ code: number | null; stderr: string; timedOut: boolean }> {
  return new Promise((resolve) => {
    let stderr = "";
    let timedOut = false;
    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk: string) => { stderr += chunk; });
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, timeoutMs);
    child.once("exit", (code) => { clearTimeout(timer); resolve({ code, stderr, timedOut }); });
  });
}
