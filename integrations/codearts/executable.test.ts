import path from "node:path";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { describe, expect, it, vi } from "vitest";
import { codeArtsSpawnCommand, resolveCodeArtsLaunchTarget } from "./executable.js";

describe("resolveCodeArtsLaunchTarget", () => {
  it("uses the installed Windows executable when present", async () => {
    const access = vi.fn(async () => undefined);
    const target = await resolveCodeArtsLaunchTarget({ home: "C:\\Users\\tester", platform: "win32", access });
    expect(target).toEqual({
      executable: path.win32.join("C:\\Users\\tester", ".codeartsdoer", "installers", "bin", "codearts.exe"),
      command: path.win32.join("C:\\Users\\tester", ".codeartsdoer", "installers", "bin", "codearts.exe"),
      kind: "direct",
    });
    expect(access).toHaveBeenCalledTimes(1);
  });

  it("falls back to the supported cmd shim through ComSpec", async () => {
    const access = vi.fn(async (candidate: string) => {
      if (candidate.endsWith("codearts.exe")) throw Object.assign(new Error("missing"), { code: "ENOENT" });
    });
    const target = await resolveCodeArtsLaunchTarget({
      home: "C:\\Users\\tester",
      platform: "win32",
      comspec: "C:\\Windows\\System32\\cmd.exe",
      access,
    });
    expect(target.executable).toBe(path.win32.join("C:\\Users\\tester", ".codeartsdoer", "installers", "codearts.cmd"));
    expect(target.command).toBe("C:\\Windows\\System32\\cmd.exe");
    expect(target.kind).toBe("cmd-shim");
    const command = codeArtsSpawnCommand(target, ["C:\\Project With Spaces"]);
    expect(command.args).toEqual([
      "/d", "/s", "/c", `call "${target.executable}" "C:\\Project With Spaces"`,
    ]);
    expect(command.windowsVerbatimArguments).toBe(true);
    expect(access).toHaveBeenCalledTimes(2);
  });

  it("honors an explicit binary and keeps non-Windows PATH discovery", async () => {
    await expect(resolveCodeArtsLaunchTarget({
      home: "/home/tester", platform: "linux", configured: "/opt/codearts",
    })).resolves.toMatchObject({ executable: "/opt/codearts", command: "/opt/codearts", kind: "direct" });
    await expect(resolveCodeArtsLaunchTarget({ home: "/home/tester", platform: "darwin" }))
      .resolves.toMatchObject({ executable: "codearts", command: "codearts", kind: "direct" });
  });

  it("rejects cmd metacharacters instead of passing them to the shell", async () => {
    const target = await resolveCodeArtsLaunchTarget({
      home: "C:\\Users\\tester", platform: "win32", configured: "C:\\CodeArts\\codearts.cmd",
    });
    expect(() => codeArtsSpawnCommand(target, ["safe & unsafe"])).toThrow("metacharacters");
  });

  it.runIf(process.platform === "win32")("launches a cmd shim from a path containing spaces", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "gameforge codearts shim "));
    try {
      const shim = path.join(root, "codearts test.cmd");
      const output = path.join(root, "result.txt");
      await writeFile(shim, "@echo off\r\n> \"%~1\" echo %~2\r\n", "utf8");
      const target = await resolveCodeArtsLaunchTarget({ home: root, platform: "win32", configured: shim });
      const command = codeArtsSpawnCommand(target, [output, "hello world"]);
      await new Promise<void>((resolve, reject) => {
        const child = spawn(command.command, command.args, {
          stdio: "ignore",
          windowsVerbatimArguments: command.windowsVerbatimArguments,
        });
        child.once("error", reject);
        child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`cmd exited ${String(code)}`)));
      });
      await expect(readFile(output, "utf8")).resolves.toBe("hello world\r\n");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
