import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repositoryRoot = path.resolve(import.meta.dirname, "../../..");
const retiredTargetPattern = /douyin|wechat|mini[-_]?game/i;

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
});
