import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DouyinMiniGameBuilder } from "./builder.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture(target: "web" | "douyin-mini-game" = "douyin-mini-game"): Promise<{ root: string; project: string; cli: string }> {
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
const out = args[args.indexOf("--out") + 1];
await mkdir(out, { recursive: true });
await mkdir(out + "/resources", { recursive: true });
await writeFile(out + "/game.js", "const canvas = tt.createCanvas();\\n");
await writeFile(out + "/game.json", '{"deviceOrientation":"portrait"}\\n');
await writeFile(out + "/project.config.json", '{"setting":{"es6":false}}\\n');
await writeFile(out + "/resources/gameforge-platform.json", '${JSON.stringify({
  schemaVersion: "1.0",
  target: "douyin-mini-game",
  adapter: { engine: "layaair", version: "3.4.0" },
  capabilities: { network: false, login: false, share: false, ads: false, payments: false },
  allowedNetworkHosts: [],
  remoteScripts: false,
})}\\n');
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
    });
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
});

async function readOptional(filePath: string): Promise<string | undefined> {
  const { readFile } = await import("node:fs/promises");
  return readFile(filePath, "utf8").catch(() => undefined);
}
