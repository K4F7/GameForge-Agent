import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { GameProjectGenerator } from "./generator.js";

const temporaryRoots: string[] = [];
const spec = {
  title: "Safety Sprint",
  genre: "arcade" as const,
  objective: "Collect all safety equipment before the timer expires.",
  controls: ["Arrow keys to move"],
  winCondition: "Collect all required equipment.",
  loseCondition: "The timer reaches zero.",
  targetDurationSeconds: 90,
};

async function createGenerator(): Promise<{ generator: GameProjectGenerator; root: string }> {
  const temporary = await mkdtemp(path.join(tmpdir(), "gameforge-generator-test-"));
  temporaryRoots.push(temporary);
  const root = path.join(temporary, "generated");
  return { generator: new GameProjectGenerator({ outputRoot: root }), root };
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("GameProjectGenerator", () => {
  it("creates deterministic dry-run plans without writing files", async () => {
    const { generator, root } = await createGenerator();

    const first = await generator.execute({ projectId: "safety-sprint", spec });
    const second = await generator.execute({ projectId: "safety-sprint", spec });

    expect(first).toEqual(second);
    expect(first.mode).toBe("dry-run");
    expect(first.plan.files.map((file) => file.path)).toContain("src/main.ts");
    expect(first.plan.files.map((file) => file.path)).toContain("src/game.ts");
    expect(first.plan.files.map((file) => file.path)).toContain("public/assets/manifest.json");
    expect(first.plan.files.map((file) => file.path)).toContain(".npmrc");
    await expect(readFile(path.join(root, "safety-sprint", "game-spec.json"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("atomically creates a new standalone Phaser project", async () => {
    const { generator, root } = await createGenerator();

    const result = await generator.execute({ projectId: "safety-sprint", spec, mode: "apply" });

    expect(result.outputPath).toBe(path.join(root, "safety-sprint"));
    expect(JSON.parse(await readFile(path.join(root, "safety-sprint", "game-spec.json"), "utf8"))).toEqual(spec);
    const packageJson = JSON.parse(await readFile(
      path.join(root, "safety-sprint", "package.json"),
      "utf8",
    )) as { packageManager?: string };
    expect(packageJson.packageManager).toBe("bun@1.3.14");
    expect(await readFile(path.join(root, "safety-sprint", ".npmrc"), "utf8"))
      .toBe("registry=https://registry.npmjs.org/\n");
    const manifest = JSON.parse(await readFile(
      path.join(root, "safety-sprint", ".gameforge", "manifest.json"),
      "utf8",
    )) as { planSha256: string; files: unknown[] };
    expect(manifest.planSha256).toBe(result.plan.planSha256);
    expect(manifest.files).toHaveLength(result.plan.files.length - 1);
  });

  it("never overwrites an existing project", async () => {
    const { generator } = await createGenerator();
    await generator.execute({ projectId: "safety-sprint", spec, mode: "apply" });

    await expect(
      generator.execute({ projectId: "safety-sprint", spec, mode: "apply" }),
    ).rejects.toThrow("already exists");
  });

  it("keeps untrusted GameSpec text out of executable source", async () => {
    const { generator, root } = await createGenerator();
    const injected = {
      ...spec,
      objective: "Collect items. </script><script>globalThis.pwned=true</script>",
    };

    await generator.execute({ projectId: "safe-output", spec: injected, mode: "apply" });

    const source = await readFile(path.join(root, "safe-output", "src", "game.ts"), "utf8");
    const loader = await readFile(path.join(root, "safe-output", "src", "main.ts"), "utf8");
    const storedSpec = await readFile(path.join(root, "safe-output", "game-spec.json"), "utf8");
    expect(source).not.toContain("globalThis.pwned");
    expect(storedSpec).toContain("globalThis.pwned");
    expect(source).toContain("telemetry: this.telemetry()");
    expect(source).toContain("this.ended = true;\n    this.updateHud();");
    expect(loader).toContain('import("./game.js")');
  });

  it("plans a playable baseline for every supported genre", async () => {
    const { generator } = await createGenerator();
    const genres = ["arcade", "platformer", "puzzle", "shooter", "strategy"] as const;

    for (const genre of genres) {
      const result = await generator.execute({
        projectId: `game-${genre}`,
        spec: { ...spec, genre },
      });
      expect(result.plan.files.some((file) => file.path === "src/main.ts")).toBe(true);
    }
  });

  it("stores bounded gameplay tuning for the runtime instead of hard-coding one difficulty", async () => {
    const { generator, root } = await createGenerator();
    const tuned = {
      ...spec,
      gameplay: { collectibleCount: 2, hazardCount: 0, startingLives: 1, movementSpeed: 300 },
    };
    await generator.execute({ projectId: "tuned-game", spec: tuned, mode: "apply" });
    expect(JSON.parse(await readFile(path.join(root, "tuned-game", "game-spec.json"), "utf8")))
      .toMatchObject({ gameplay: tuned.gameplay });
    const source = await readFile(path.join(root, "tuned-game", "src", "game.ts"), "utf8");
    expect(source).toContain("spec.gameplay?.collectibleCount");
    expect(source).toContain("slice(0, hazardCount)");
    expect(source).toContain("direction.x * movementSpeed");
  });

  it("validates runtime media bindings and starts background music after user input", async () => {
    const { generator, root } = await createGenerator();
    await generator.execute({ projectId: "media-game", spec, mode: "apply" });

    const source = await readFile(path.join(root, "media-game", "src", "game.ts"), "utf8");
    expect(source).toContain("function parseRuntimeAssets(value: unknown)");
    expect(source).toContain("assetPathPattern.test(path)");
    expect(source).toContain("roles.has(role as RuntimeAssetRole)");
    expect(source).toContain('this.sound.play("bgm", { loop: true, volume: 0.35 })');
    expect(source).toContain('this.input.once("pointerdown", () => this.startAudio())');
  });

  it("normalizes generated image dimensions for rendering and collision", async () => {
    const { generator, root } = await createGenerator();
    await generator.execute({ projectId: "image-sizing", spec, mode: "apply" });

    const source = await readFile(path.join(root, "image-sizing", "src", "game.ts"), "utf8");
    expect(source).toContain('this.createSizedSprite(120, height / 2, "player", 32, 32)');
    expect(source).toContain('(sprite.body as Phaser.Physics.Arcade.Body).setSize(displayWidth, displayHeight, true)');
    expect(source).toContain('collectible.setDisplaySize(24, 24)');
    expect(source).toContain('(collectible.body as Phaser.Physics.Arcade.Body).setSize(24, 24, true)');
  });

  it("localizes generated runtime chrome while preserving legacy Chinese defaults", async () => {
    const { generator, root } = await createGenerator();
    await generator.execute({
      projectId: "english-game",
      spec: { ...spec, locale: "en-US" },
      mode: "apply",
    });

    const source = await readFile(path.join(root, "english-game", "src", "game.ts"), "utf8");
    const html = await readFile(path.join(root, "english-game", "index.html"), "utf8");
    expect(source).toContain('const locale = spec.locale ?? "zh-CN"');
    expect(source).toContain('document.documentElement.lang = locale');
    expect(source).toContain('won: "Mission Complete"');
    expect(source).toContain('arcadeControls: "Arrow keys to move, collect targets, and avoid hazards"');
    expect(source).toContain('won: "任务完成"');
    expect(html).toContain('<html lang="en-US">');
    expect(html).toContain('aria-label="GameForge generated game"');
    expect(html).toContain('<link rel="icon" href="data:," />');

    await generator.execute({ projectId: "legacy-game", spec, mode: "apply" });
    const legacyHtml = await readFile(path.join(root, "legacy-game", "index.html"), "utf8");
    expect(legacyHtml).toContain('<html lang="zh-CN">');
    expect(legacyHtml).toContain('aria-label="GameForge 生成的游戏"');
  });

  it("rejects relative output roots", () => {
    expect(() => new GameProjectGenerator({ outputRoot: "generated-games" })).toThrow("absolute");
  });
});
