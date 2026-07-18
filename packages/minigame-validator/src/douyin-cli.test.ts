import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DouyinMiniGameCliProbe, douyinMiniGameCliPolicy } from "./douyin-cli.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fakeCli(
  source: string,
  manifest: { name: string; version: string; bin: Record<string, string> } = {
    name: "tt-minigame-ide-cli",
    version: "2.1.1",
    bin: { tmg: "bin/tmg.js" },
  },
): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "gameforge-tmg-"));
  temporaryRoots.push(root);
  const bin = path.join(root, "bin");
  await mkdir(bin);
  await writeFile(path.join(root, "package.json"), `${JSON.stringify(manifest)}\n`, "utf8");
  const script = path.join(bin, "tmg.js");
  await writeFile(script, source, "utf8");
  return script;
}

describe("DouyinMiniGameCliProbe", () => {
  it("executes only the pinned tmg version probe with a secret-free environment", async () => {
    const script = await fakeCli(`
      if (process.argv[2] !== "--version") process.exit(10);
      if (process.env.DASHSCOPE_API_KEY !== undefined) process.exit(11);
      console.error("runtime 24.18.0");
      console.log("2.1.1");
    `);
    const previousSecret = process.env.DASHSCOPE_API_KEY;
    process.env.DASHSCOPE_API_KEY = "must-not-reach-child";
    try {
      const report = await new DouyinMiniGameCliProbe({
        cliPath: script,
      }).probe();
      expect(report).toEqual({
        platform: "douyin-mini-game",
        ready: true,
        packageName: "tt-minigame-ide-cli",
        binary: "tmg",
        version: "2.1.1",
        executedArguments: ["--version"],
        remoteOperations: "forbidden",
        exposedArguments: ["--version"],
      });
      expect(douyinMiniGameCliPolicy.commandsNotExposed).toEqual([
        "login", "login-e", "logout", "open", "set-config", "version", "build-npm", "preview", "upload",
      ]);
    } finally {
      if (previousSecret === undefined) delete process.env.DASHSCOPE_API_KEY;
      else process.env.DASHSCOPE_API_KEY = previousSecret;
    }
  });

  it("rejects the mini-app tma version instead of treating it as a mini-game CLI", async () => {
    const script = await fakeCli(`console.log("0.1.33");`, {
      name: "tt-ide-cli",
      version: "0.1.33",
      bin: { tma: "bin/tmg.js" },
    });
    await expect(new DouyinMiniGameCliProbe({ cliPath: script }).probe()).rejects.toThrow(
      "package identity or version is unsupported",
    );
  });

  it("rejects unsupported output even when a package manifest claims the pinned identity", async () => {
    const script = await fakeCli(`console.log("0.1.33");`);
    await expect(new DouyinMiniGameCliProbe({ cliPath: script }).probe()).rejects.toThrow(
      "version mismatch; expected 2.1.1",
    );
  });

  it("rejects extra stdout instead of accepting a loosely matching version", async () => {
    const script = await fakeCli(`console.log("2.1.1\\nuntrusted-extra-output");`);
    await expect(new DouyinMiniGameCliProbe({ cliPath: script }).probe()).rejects.toThrow(
      "version mismatch; expected 2.1.1",
    );
  });

  it("rejects a nonzero version probe without exposing child diagnostics", async () => {
    const script = await fakeCli(`console.error("private diagnostic"); process.exit(23);`);
    await expect(new DouyinMiniGameCliProbe({ cliPath: script }).probe()).rejects.toThrow(
      "version probe failed with exit code 23",
    );
  });

  it("rejects an official-looking manifest with an unsafe binary mapping", async () => {
    const script = await fakeCli(`console.log("2.1.1");`, {
      name: "tt-minigame-ide-cli",
      version: "2.1.1",
      bin: { tmg: "scripts/remote.js" },
    });
    await expect(new DouyinMiniGameCliProbe({ cliPath: script }).probe()).rejects.toThrow(
      "package identity or version is unsupported",
    );
  });

  it("rejects unsafe paths and timeout values before spawning", () => {
    expect(() => new DouyinMiniGameCliProbe({ cliPath: "tmg" })).toThrow("must be absolute");
    expect(() => new DouyinMiniGameCliProbe({ cliPath: process.execPath })).toThrow("official bin/tmg.js entry");
    expect(() => new DouyinMiniGameCliProbe({ cliPath: path.resolve("bin", "tmg.js"), timeoutMs: 100 })).toThrow(
      "timeout must be between 500 and 30000",
    );
  });

  it("terminates a bounded version probe that does not exit", async () => {
    const script = await fakeCli(`setInterval(() => undefined, 1000);`);
    await expect(new DouyinMiniGameCliProbe({ cliPath: script, timeoutMs: 500 }).probe()).rejects.toThrow(
      "version probe timed out",
    );
  });
});
