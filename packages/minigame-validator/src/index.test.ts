import { createHash } from "node:crypto";
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
  await mkdir(path.join(root, "resources"));
  await writePolicy(root);
  await mkdir(path.join(root, "resources", "assets"));
  await writeFile(path.join(root, "resources", "assets", "manifest.json"), `${JSON.stringify({
    schemaVersion: "1.0", projectId: "fixture", revision: 0, assets: [],
  })}\n`);
  return root;
}

async function writePolicy(
  root: string,
  overrides: { network?: boolean; login?: boolean; share?: boolean; ads?: boolean; payments?: boolean; hosts?: string[] } = {},
): Promise<void> {
  await writeFile(path.join(root, "resources", "gameforge-platform.json"), `${JSON.stringify({
    schemaVersion: "1.0",
    target: "douyin-mini-game",
    adapter: { engine: "layaair", version: "3.4.0" },
    capabilities: {
      network: overrides.network ?? false,
      login: overrides.login ?? false,
      share: overrides.share ?? false,
      ads: overrides.ads ?? false,
      payments: overrides.payments ?? false,
    },
    allowedNetworkHosts: overrides.hosts ?? [],
    remoteScripts: false,
  })}\n`);
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
      capabilities: { network: false, login: false, share: false, ads: false, payments: false },
      allowedNetworkHosts: [],
      assetManifestRevision: 0,
      assetCount: 0,
      projectId: "fixture",
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

  it("rejects unsupported file types and remote JavaScript", async () => {
    const unsupported = await project();
    await writeFile(path.join(unsupported, "payload.exe"), "not executable\n");
    await expect(validateDouyinMiniGameProject(unsupported)).rejects.toThrow("unsupported file type");
    const remoteScript = await project();
    await writePolicy(remoteScript, { network: true, hosts: ["cdn.example.com"] });
    await writeFile(path.join(remoteScript, "game.js"), 'require("https://cdn.example.com/game.js");\n');
    await expect(validateDouyinMiniGameProject(remoteScript)).rejects.toThrow("remote JavaScript");
    await writeFile(path.join(remoteScript, "game.js"), 'Laya.loader.load("https://cdn.example.com/feature.js");\n');
    await expect(validateDouyinMiniGameProject(remoteScript)).rejects.toThrow("remote JavaScript");
    await writeFile(path.join(remoteScript, "game.js"), 'importScripts("data:text/javascript,alert(1)");\n');
    await expect(validateDouyinMiniGameProject(remoteScript)).rejects.toThrow("remote JavaScript");
  });

  it("requires HTTPS, safe declared hosts and network capability for remote URLs", async () => {
    const insecure = await project();
    await writePolicy(insecure, { network: true, hosts: ["api.example.com"] });
    await writeFile(path.join(insecure, "game.js"), 'const endpoint = "http://api.example.com/data";\n');
    await expect(validateDouyinMiniGameProject(insecure)).rejects.toThrow("must use HTTPS");
    await writeFile(path.join(insecure, "game.js"), 'const endpoint = "//api.example.com/data";\n');
    await expect(validateDouyinMiniGameProject(insecure)).rejects.toThrow("explicitly use HTTPS");

    const undeclaredCapability = await project();
    await writeFile(path.join(undeclaredCapability, "game.js"), 'const endpoint = "https://api.example.com/data";\n');
    await expect(validateDouyinMiniGameProject(undeclaredCapability)).rejects.toThrow("without declaring network capability");

    const undeclaredHost = await project();
    await writePolicy(undeclaredHost, { network: true, hosts: ["api.example.com"] });
    await writeFile(path.join(undeclaredHost, "game.js"), 'const endpoint = "https://cdn.example.com/data";\n');
    await expect(validateDouyinMiniGameProject(undeclaredHost)).rejects.toThrow("host is not declared");

    const loopback = await project();
    await writePolicy(loopback, { network: true, hosts: ["api.example.com"] });
    await writeFile(path.join(loopback, "game.js"), 'const endpoint = "https://127.0.0.1/data";\n');
    await expect(validateDouyinMiniGameProject(loopback)).rejects.toThrow("host is unsafe");

    const safe = await project();
    await writePolicy(safe, { network: true, hosts: ["api.example.com"] });
    await writeFile(path.join(safe, "game.js"), 'const endpoint = "https://api.example.com/data";\n');
    await expect(validateDouyinMiniGameProject(safe)).resolves.toMatchObject({ allowedNetworkHosts: ["api.example.com"] });
  });

  it("rejects platform API use unless its capability is declared", async () => {
    const login = await project();
    await writeFile(path.join(login, "game.js"), "tt.login({});\n");
    await expect(validateDouyinMiniGameProject(login)).rejects.toThrow("undeclared login capability");
    await writePolicy(login, { login: true });
    await expect(validateDouyinMiniGameProject(login)).resolves.toMatchObject({ capabilities: { login: true } });

    const bracketLogin = await project();
    await writeFile(path.join(bracketLogin, "game.js"), "tt['login']({});\n");
    await expect(validateDouyinMiniGameProject(bracketLogin)).rejects.toThrow("undeclared login capability");

    const untrustedLibrary = await project();
    await mkdir(path.join(untrustedLibrary, "libs"));
    await writeFile(path.join(untrustedLibrary, "libs", "evil.js"), "tt.login({});\n");
    await expect(validateDouyinMiniGameProject(untrustedLibrary)).rejects.toThrow("undeclared login capability");
  });

  it("verifies every published runtime asset against its manifest hash", async () => {
    const root = await project();
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const assetPath = path.join(root, "resources", "assets", "images", "player.png");
    await mkdir(path.dirname(assetPath), { recursive: true });
    await writeFile(assetPath, bytes);
    await writeFile(path.join(root, "resources", "assets", "manifest.json"), `${JSON.stringify({
      schemaVersion: "1.0",
      projectId: "fixture",
      revision: 1,
      assets: [{
        assetId: "images/player.png", kind: "image", role: "player", path: "assets/images/player.png",
        mimeType: "image/png", bytes: bytes.length, sha256,
        provenance: {
          assetId: "images/player.png", kind: "image", origin: "generated", provider: "fixture",
          model: "fixture", prompt: "https://documentation.example.com is metadata only",
          license: "https://license.example.com/terms", sha256,
        },
      }],
    })}\n`);
    await expect(validateDouyinMiniGameProject(root)).resolves.toMatchObject({ assetManifestRevision: 1, assetCount: 1 });
    await expect(validateDouyinMiniGameProject(root, { expectedProjectId: "another-project" }))
      .rejects.toThrow("project ID mismatch");
    await writeFile(assetPath, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]));
    await expect(validateDouyinMiniGameProject(root)).rejects.toThrow("hash is inconsistent");
  });

  it("rejects projects whose split packages exceed the 20 MiB total limit", async () => {
    const root = await project({ subPackages: [{ root: "level-a" }, { root: "level-b" }] });
    await mkdir(path.join(root, "level-a"));
    await mkdir(path.join(root, "level-b"));
    await writeFile(path.join(root, "level-a", "assets.bin"), "");
    await writeFile(path.join(root, "level-b", "assets.bin"), "");
    await truncate(path.join(root, "level-a", "assets.bin"), 11 * 1024 * 1024);
    await truncate(path.join(root, "level-b", "assets.bin"), 10 * 1024 * 1024);
    await expect(validateDouyinMiniGameProject(root)).rejects.toThrow("project exceeds 20 MiB");
  });
});
