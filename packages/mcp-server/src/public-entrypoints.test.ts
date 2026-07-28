import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repositoryRoot = path.resolve(import.meta.dirname, "../../..");
const retiredTargetPattern = /douyin|wechat|mini[-_]?game/i;
const publicDocumentation = [
  "README.md",
  "docs/codearts-quickstart.md",
  "integrations/README.md",
];
const historicalMiniGameDocumentation = [
  "docs/game-generation-runtime.md",
  "docs/douyin-cli-pipeline.md",
  "docs/domestic-mini-game-platforms.md",
];
const retiredPublicEntrypoints = [
  "bun run doctor:douyin",
  "build_douyin_mini_game",
  "build_wechat_mini_game",
  "get_douyin_mini_game_cli_status",
];
const activeSourceRoots = ["packages", "integrations", ".codeartsdoer/skills"];
const policyFile = "packages/mcp-server/src/public-entrypoints.test.ts";

describe("GameForge public discovery", () => {
  it("keeps retired platform targets out of active code, tests, manifests, and skills", async () => {
    const sourceFiles = (await Promise.all(activeSourceRoots.map((root) => listFiles(root)))).flat();
    const candidates = ["package.json", "bun.lock", ...sourceFiles]
      .filter((relativePath) => relativePath !== policyFile)
      .filter((relativePath) => relativePath.endsWith(".ts") || relativePath.endsWith(".json") ||
        relativePath.endsWith(".lock") || relativePath.endsWith("/SKILL.md"));
    const violations: string[] = [];
    for (const relativePath of candidates) {
      const content = await readFile(path.join(repositoryRoot, relativePath), "utf8");
      if (retiredTargetPattern.test(content)) violations.push(relativePath);
    }
    expect(violations).toEqual([]);
  });

  it("presents a Web-only workflow through root commands and active CodeArts instructions", async () => {
    const manifest = JSON.parse(await readFile(path.join(repositoryRoot, "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };
    const instructions = await readFile(
      path.join(repositoryRoot, ".codeartsdoer", "skills", "gameforge-build", "SKILL.md"),
      "utf8",
    );

    expect(Object.keys(manifest.scripts)).not.toEqual(expect.arrayContaining([
      "doctor:douyin",
      "douyin:e2e",
      "douyin:host-smoke",
      "dev:douyin-bridge",
      "minigame:validate",
      "minigame:handoff",
      "start:douyin-bridge",
    ]));
    expect(instructions).toMatch(/web/i);
    expect(instructions).toMatch(/Phaser/);
    expect(instructions).toMatch(/Vite/);
    expect(instructions).not.toMatch(retiredTargetPattern);
    expect(instructions).not.toContain("build.ready");
  });

  it("does not advertise withdrawn mini-game entry points in current user documentation", async () => {
    const documents = await Promise.all(
      publicDocumentation.map(async (relativePath) => ({
        relativePath,
        content: await readFile(path.join(repositoryRoot, relativePath), "utf8"),
      })),
    );

    for (const { relativePath, content } of documents) {
      for (const entrypoint of retiredPublicEntrypoints) {
        expect(content, `${relativePath} advertises ${entrypoint}`).not.toContain(entrypoint);
      }
      expect(content, `${relativePath} advertises dev:local as a bridge-host launcher`).not.toMatch(
        /dev:local[^\n]*(?:Douyin|抖音)[^\n]*Bridge Host/i,
      );
    }
  });

  it("documents benchmark capture with the current Web-only contract", async () => {
    const quickstart = await readFile(
      path.join(repositoryRoot, "docs", "codearts-quickstart.md"),
      "utf8",
    );
    const benchmarkGuidance = quickstart
      .split("## 7. 第一次基准实验")[1]
      ?.split("## 官方文档")[0];

    expect(benchmarkGuidance).toBeDefined();
    expect(benchmarkGuidance).toMatch(/Web/);
    expect(benchmarkGuidance).toContain("verification.ready");
    expect(benchmarkGuidance).not.toMatch(retiredTargetPattern);
    expect(benchmarkGuidance).not.toMatch(/runtimeGenre|gameplay\.verified|build\.ready/);
  });

  it("labels retained mini-game research as historical instead of current guidance", async () => {
    for (const relativePath of historicalMiniGameDocumentation) {
      const content = await readFile(path.join(repositoryRoot, relativePath), "utf8");
      expect(content.slice(0, 600), `${relativePath} lacks a historical status notice`).toMatch(/历史/);
      expect(content.slice(0, 600), `${relativePath} still presents supported entry points`).toMatch(
        /不再(?:是|作为|提供|支持)/,
      );
    }
  });

  it("does not discover a dedicated mini-game runtime workspace or dependency", async () => {
    const packageDirectories = await readdir(path.join(repositoryRoot, "packages"), { withFileTypes: true });
    const workspaceNames = await Promise.all(
      packageDirectories
        .filter((entry) => entry.isDirectory())
        .map(async (entry) => {
          const manifestPath = path.join(repositoryRoot, "packages", entry.name, "package.json");
          const source = await readFile(manifestPath, "utf8").catch(() => null);
          return source === null ? null : (JSON.parse(source) as { name: string }).name;
        }),
    );

    expect(workspaceNames).not.toEqual(expect.arrayContaining([
      "@gameforge/minigame-validator",
      "gameforge-douyin-devtool-extension",
    ]));
    const lockfile = await readFile(path.join(repositoryRoot, "bun.lock"), "utf8");
    expect(lockfile).not.toMatch(/@gameforge\/minigame-validator|gameforge-douyin-devtool-extension|gameforge-douyin-cli-doctor|@types\/vscode/);
  });
});

async function listFiles(relativeRoot: string): Promise<string[]> {
  const entries = await readdir(path.join(repositoryRoot, relativeRoot), { withFileTypes: true });
  const files = await Promise.all(entries.map(async (entry) => {
    const relativePath = path.posix.join(relativeRoot, entry.name);
    if (entry.isDirectory() && ["dist", "node_modules", ".vite"].includes(entry.name)) return [];
    return entry.isDirectory() ? await listFiles(relativePath) : [relativePath];
  }));
  return files.flat();
}
