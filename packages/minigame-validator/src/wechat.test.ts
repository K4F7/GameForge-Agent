import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { validateWechatMiniGameProject } from "./index.js";

const roots: string[] = [];

async function project(overrides: { login?: boolean } = {}): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "gameforge-wechat-validator-"));
  roots.push(root);
  await mkdir(path.join(root, "resources", "assets"), { recursive: true });
  await writeFile(path.join(root, "game.js"), "const canvas = wx.createCanvas();\n");
  await writeFile(path.join(root, "game.json"), '{"deviceOrientation":"portrait"}\n');
  await writeFile(path.join(root, "project.config.json"), '{"compileType":"game","setting":{"es6":false}}\n');
  await writeFile(path.join(root, "resources", "gameforge-platform.json"), `${JSON.stringify({
    schemaVersion: "1.0",
    target: "wechat-mini-game",
    adapter: { engine: "layaair", version: "3.4.0" },
    capabilities: { network: false, login: overrides.login ?? false, share: false, ads: false, payments: false },
    allowedNetworkHosts: [],
    remoteScripts: false,
  })}\n`);
  await writeFile(path.join(root, "resources", "assets", "manifest.json"), `${JSON.stringify({
    schemaVersion: "1.0", projectId: "wechat-fixture", revision: 0, assets: [],
  })}\n`);
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("WeChat mini-game artifact validator", () => {
  it("validates the official Laya wxgame root and bounded package report", async () => {
    await expect(validateWechatMiniGameProject(await project(), { expectedProjectId: "wechat-fixture" }))
      .resolves.toMatchObject({
        platform: "wechat-mini-game",
        passed: true,
        deviceOrientation: "portrait",
        projectId: "wechat-fixture",
        capabilities: { login: false },
      });
  });

  it("requires a declared capability for direct wx API use", async () => {
    const undeclared = await project();
    await writeFile(path.join(undeclared, "game.js"), "wx.login({});\n");
    await expect(validateWechatMiniGameProject(undeclared)).rejects.toThrow("undeclared login capability");
    const declared = await project({ login: true });
    await writeFile(path.join(declared, "game.js"), "wx.login({});\n");
    await expect(validateWechatMiniGameProject(declared)).resolves.toMatchObject({ capabilities: { login: true } });
  });

  it("rejects a Douyin policy disguised as a WeChat artifact", async () => {
    const root = await project();
    const policyPath = path.join(root, "resources", "gameforge-platform.json");
    const text = await import("node:fs/promises").then(({ readFile }) => readFile(policyPath, "utf8"));
    await writeFile(policyPath, text.replace("wechat-mini-game", "douyin-mini-game"));
    await expect(validateWechatMiniGameProject(root)).rejects.toThrow();
  });
});
