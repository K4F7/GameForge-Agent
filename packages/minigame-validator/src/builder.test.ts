import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DouyinMiniGameBuilder, WechatMiniGameBuilder } from "./builder.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture(target: "web" | "douyin-mini-game" | "wechat-mini-game" = "douyin-mini-game"): Promise<{ root: string; project: string; cli: string }> {
  const root = await mkdtemp(path.join(tmpdir(), "gameforge-laya-builder-"));
  roots.push(root);
  const project = path.join(root, "projects", "safe-game");
  await mkdir(path.join(project, ".gameforge"), { recursive: true });
  await writeFile(path.join(project, ".gameforge", "manifest.json"), `${JSON.stringify({
    schemaVersion: "1.0",
    generatorVersion: "0.9.0",
    projectId: "safe-game",
    target,
    specSha256: "a".repeat(64),
    planSha256: "b".repeat(64),
    files: [{ path: "game-spec.json", bytes: 3, sha256: "c".repeat(64) }],
  })}\n`);
  await writeFile(path.join(project, "game-spec.json"), "{}\n");
  const cli = path.join(root, "fake-laya.mjs");
  await writeFile(cli, `
import { mkdir, writeFile } from "node:fs/promises";
const args = process.argv.slice(2);
if (args.includes("--version")) { console.log("LayaAir CLI 3.4.0"); process.exit(0); }
const isWechat = args.includes("wxgame");
const out = args[args.indexOf("--out") + 1];
await mkdir(out, { recursive: true });
await mkdir(out + "/resources", { recursive: true });
await mkdir(out + "/resources/assets", { recursive: true });
await writeFile(out + "/game.js", isWechat ? "const canvas = wx.createCanvas();\\n" : "const canvas = tt.createCanvas();\\n");
await writeFile(out + "/game.json", '{"deviceOrientation":"portrait"}\\n');
await writeFile(out + "/project.config.json", '{"setting":{"es6":false}}\\n');
await writeFile(out + "/resources/gameforge-platform.json", JSON.stringify({
  schemaVersion: "1.0", target: isWechat ? "wechat-mini-game" : "douyin-mini-game",
  adapter: { engine: "layaair", version: "3.4.0" },
  capabilities: { network: false, login: false, share: false, ads: false, payments: false },
  allowedNetworkHosts: [], remoteScripts: false,
}) + "\\n");
await writeFile(out + "/resources/assets/manifest.json", '${JSON.stringify({ schemaVersion: "1.0", projectId: "safe-game", revision: 0, assets: [] })}\\n');
console.log("Build end, result=Success");
`);
  return { root: path.join(root, "projects"), project, cli };
}

describe("DouyinMiniGameBuilder", () => {
  it("builds a managed Douyin project and validates the bounded output", async () => {
    const { root, cli } = await fixture();
    const builder = new DouyinMiniGameBuilder({ projectsRoot: root, cliPath: process.execPath, cliPrefixArgs: [cli] });
    await expect(builder.build("safe-game")).resolves.toMatchObject({
      projectId: "safe-game",
      cliVersion: "3.4.0",
      validation: { passed: true, platform: "douyin-mini-game" },
      handoff: { remoteOperations: "forbidden", devToolVerification: "not-run" },
    });
  });

  it("builds a managed WeChat project through the fixed wxgame target", async () => {
    const { root, cli } = await fixture("wechat-mini-game");
    const builder = new WechatMiniGameBuilder({ projectsRoot: root, cliPath: process.execPath, cliPrefixArgs: [cli] });
    await expect(builder.build("safe-game")).resolves.toMatchObject({
      projectId: "safe-game",
      cliVersion: "3.4.0",
      validation: { passed: true, platform: "wechat-mini-game" },
      handoff: { artifactRoot: "release/wxgame", remoteOperations: "forbidden" },
    });
  });

  it("resolves the pinned official dispatcher layout without executing its cmd wrapper", async () => {
    const { root, cli } = await fixture();
    const installRoot = path.join(path.dirname(root), "laya-install");
    const resources = path.join(installRoot, "3.4.0", "Resources");
    await mkdir(resources, { recursive: true });
    await writeFile(path.join(installRoot, "layaair.cmd"), "@echo off\nexit /b 99\n", "utf8");
    await writeFile(path.join(installRoot, "versions.json"), JSON.stringify({
      versions: [{ version: "3.4.0", path: "3.4.0" }],
    }), "utf8");
    await writeFile(path.join(resources, "package.json"), JSON.stringify({
      name: "layaair-cli",
      version: "3.4.0",
    }), "utf8");
    await writeFile(path.join(resources, "cli-main.js"), await readFile(cli, "utf8"), "utf8");
    const builder = new DouyinMiniGameBuilder({
      projectsRoot: root,
      cliPath: path.join(installRoot, "layaair.cmd"),
    });
    await expect(builder.build("safe-game")).resolves.toMatchObject({
      projectId: "safe-game",
      cliVersion: "3.4.0",
      validation: { passed: true, platform: "douyin-mini-game" },
    });
  });

  it("rejects an official dispatcher whose pinned version path is redirected", async () => {
    const { root } = await fixture();
    const installRoot = path.join(path.dirname(root), "laya-unsafe");
    await mkdir(installRoot);
    await writeFile(path.join(installRoot, "layaair.cmd"), "@echo off\n", "utf8");
    await writeFile(path.join(installRoot, "versions.json"), JSON.stringify({
      versions: [{ version: "3.4.0", path: "../outside" }],
    }), "utf8");
    const builder = new DouyinMiniGameBuilder({
      projectsRoot: root,
      cliPath: path.join(installRoot, "layaair.cmd"),
    });
    await expect(builder.build("safe-game")).rejects.toThrow("version path is unsafe");
  });

  it("rejects web projects and unsafe project IDs before starting the CLI", async () => {
    const { root, cli } = await fixture("web");
    const builder = new DouyinMiniGameBuilder({ projectsRoot: root, cliPath: process.execPath, cliPrefixArgs: [cli] });
    await expect(builder.build("safe-game")).rejects.toThrow("requires a managed douyin-mini-game");
    await expect(builder.build("../escape")).rejects.toThrow();
  });

  it("serializes concurrent builds with a project lock", async () => {
    const { root, project, cli } = await fixture();
    await writeFile(path.join(project, ".gameforge", "laya-build.lock"), "active\n");
    const builder = new DouyinMiniGameBuilder({ projectsRoot: root, cliPath: process.execPath, cliPrefixArgs: [cli] });
    await expect(builder.build("safe-game")).rejects.toThrow("already active");
  });

  it("rejects a metadata directory redirected outside the managed project", async () => {
    const { root, project, cli } = await fixture();
    const outside = path.join(path.dirname(root), "outside-metadata");
    await mkdir(outside);
    await rm(path.join(project, ".gameforge"), { recursive: true });
    await symlink(outside, path.join(project, ".gameforge"), process.platform === "win32" ? "junction" : "dir");
    const builder = new DouyinMiniGameBuilder({ projectsRoot: root, cliPath: process.execPath, cliPrefixArgs: [cli] });
    await expect(builder.build("safe-game")).rejects.toThrow("metadata directory is missing or unsafe");
    await expect(readOptional(path.join(outside, "laya-build.lock"))).resolves.toBeUndefined();
  });

  it("rejects the official failed-build marker even when the CLI exits zero", async () => {
    const { root, cli } = await fixture();
    await writeFile(cli, `
const args = process.argv.slice(2);
if (args.includes("--version")) console.log("LayaAir CLI 3.4.0");
else console.log("[Build] Build end, result=Failed");
`);
    const builder = new DouyinMiniGameBuilder({ projectsRoot: root, cliPath: process.execPath, cliPrefixArgs: [cli] });
    await expect(builder.build("safe-game")).rejects.toThrow("reported a failed build");
    await writeFile(cli, `
const args = process.argv.slice(2);
if (args.includes("--version")) console.log("LayaAir CLI 3.4.0");
else { process.stderr.write("x".repeat(70000)); console.error("[Build] Build end, result=Failed"); }
`);
    await expect(builder.build("safe-game")).rejects.toThrow("reported a failed build");
  });

  it("requires exact version output from non-official test entries and removes the build lock", async () => {
    const { root, project, cli } = await fixture();
    await writeFile(cli, `
if (process.argv.includes("--version")) console.log("LayaAir CLI 3.4.0 untrusted");
`);
    const builder = new DouyinMiniGameBuilder({ projectsRoot: root, cliPath: process.execPath, cliPrefixArgs: [cli] });
    await expect(builder.build("safe-game")).rejects.toThrow("version mismatch");
    await expect(readOptional(path.join(project, ".gameforge", "laya-build.lock"))).resolves.toBeUndefined();
  });
});

async function readOptional(filePath: string): Promise<string | undefined> {
  const { readFile } = await import("node:fs/promises");
  return readFile(filePath, "utf8").catch(() => undefined);
}
