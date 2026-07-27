import { readFile } from "node:fs/promises";
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

describe("GameForge public discovery", () => {
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

  it("labels retained mini-game research as historical instead of current guidance", async () => {
    for (const relativePath of historicalMiniGameDocumentation) {
      const content = await readFile(path.join(repositoryRoot, relativePath), "utf8");
      expect(content.slice(0, 600), `${relativePath} lacks a historical status notice`).toMatch(/历史/);
      expect(content.slice(0, 600), `${relativePath} still presents supported entry points`).toMatch(
        /不再(?:是|作为|提供|支持)/,
      );
    }
  });
});
