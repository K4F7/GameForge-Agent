import { mkdtemp, mkdir, rm, symlink, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { validateDouyinMiniGameProject } from "./index.js";

const roots: string[] = [];

async function project(gameConfig: Record<string, unknown> = { deviceOrientation: "portrait" }): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "gameforge-douyin-validator-"));
  roots.push(root);
  await writeFile(path.join(root, "game.js"), "const canvas = tt.createCanvas();\n");
  await writeFile(path.join(root, "game.json"), `${JSON.stringify(gameConfig)}\n`);
  await writeFile(path.join(root, "project.config.json"), '{"description":"GameForge","setting":{"es6":true}}\n');
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("Douyin mini-game artifact validator", () => {
  it("validates the official root files and reports package sizes", async () => {
    const root = await project({ deviceOrientation: "portrait", subPackages: [{ name: "level-2", root: "levels/two" }] });
    await mkdir(path.join(root, "levels", "two"), { recursive: true });
    await writeFile(path.join(root, "levels", "two", "game.js"), "module.exports = {};\n");
    await expect(validateDouyinMiniGameProject(root)).resolves.toMatchObject({
      platform: "douyin-mini-game", passed: true, deviceOrientation: "portrait",
      subpackages: [{ root: "levels/two" }],
    });
  });

  it("rejects missing files, DOM entrypoints and invalid orientation", async () => {
    const missing = await project();
    await rm(path.join(missing, "project.config.json"));
    await expect(validateDouyinMiniGameProject(missing)).rejects.toThrow("project.config.json");
    const dom = await project();
    await writeFile(path.join(dom, "game.js"), "document.body.append('game');\n");
    await expect(validateDouyinMiniGameProject(dom)).rejects.toThrow("DOM globals");
    const orientation = await project({ deviceOrientation: "square" });
    await expect(validateDouyinMiniGameProject(orientation)).rejects.toThrow();
  });

  it("rejects symbolic links and main packages larger than 4 MiB", async () => {
    const linked = await project();
    await symlink(path.join(linked, "game.js"), path.join(linked, "linked.js"));
    await expect(validateDouyinMiniGameProject(linked)).rejects.toThrow("symbolic link");
    const oversized = await project();
    await writeFile(path.join(oversized, "large.bin"), "");
    await truncate(path.join(oversized, "large.bin"), 4 * 1024 * 1024);
    await expect(validateDouyinMiniGameProject(oversized)).rejects.toThrow("exceeds 4 MiB");
  });

  it("rejects unsafe and duplicate subpackage roots", async () => {
    await expect(validateDouyinMiniGameProject(await project({ subPackages: [{ root: "../escape" }] })))
      .rejects.toThrow();
    await expect(validateDouyinMiniGameProject(await project({ subPackages: [{ root: "levels" }, { root: "levels/" }] })))
      .rejects.toThrow("unique");
  });
});
