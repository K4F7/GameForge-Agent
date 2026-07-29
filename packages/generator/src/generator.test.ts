import { mkdir, mkdtemp, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { hostname } from "node:os";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { GameProjectGenerator } from "./generator.js";
import type { GameSpec } from "@gameforge/contracts";

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

function candidateIdentity() {
  const id = randomUUID();
  return { attemptId: `attempt-${id}`, revisionId: `revision-${id}` } as const;
}

async function createAccepted(
  generator: GameProjectGenerator,
  root: string,
  projectId: string,
  gameSpec: GameSpec = spec,
) {
  const result = await generator.execute({
    projectId,
    spec: gameSpec,
    mode: "apply",
    ...candidateIdentity(),
  });
  if (result.outputPath === undefined) throw new Error("Candidate generation did not return an output path.");
  await rename(result.outputPath, path.join(root, projectId));
  return result;
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("GameProjectGenerator", () => {
  it("creates deterministic dry-run plans without writing files", async () => {
    const { generator, root } = await createGenerator();
    const identity = candidateIdentity();

    const first = await generator.execute({ projectId: "safety-sprint", spec, ...identity });
    const second = await generator.execute({ projectId: "safety-sprint", spec, ...identity });

    expect(first).toEqual(second);
    expect(first.mode).toBe("dry-run");
    expect(first.plan.target).toBe("web");
    expect(first.plan.files.map((file) => file.path)).toContain("src/main.ts");
    expect(first.plan.files.map((file) => file.path)).toContain("src/game.ts");
    expect(first.plan.files.map((file) => file.path)).toContain("public/assets/manifest.json");
    expect(first.plan.files.map((file) => file.path)).toContain(".npmrc");
    await expect(readFile(path.join(root, "safety-sprint", "game-spec.json"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("atomically creates a new standalone Phaser project", async () => {
    const { generator, root } = await createGenerator();

    const result = await generator.execute({ projectId: "safety-sprint", spec, mode: "apply", ...candidateIdentity() });

    expect(result.outputPath).toContain(`${path.sep}.gameforge${path.sep}candidates${path.sep}`);
    expect(JSON.parse(await readFile(path.join(result.outputPath!, "game-spec.json"), "utf8"))).toEqual(spec);
    const packageJson = JSON.parse(await readFile(
      path.join(result.outputPath!, "package.json"),
      "utf8",
    )) as { packageManager?: string };
    expect(packageJson.packageManager).toBe("bun@1.3.14");
    expect(await readFile(path.join(result.outputPath!, ".npmrc"), "utf8"))
      .toBe("registry=https://registry.npmjs.org/\n");
    const manifest = JSON.parse(await readFile(
      path.join(result.outputPath!, ".gameforge", "manifest.json"),
      "utf8",
    )) as { planSha256: string; target: string; files: unknown[] };
    expect(manifest.planSha256).toBe(result.plan.planSha256);
    expect(manifest.target).toBe("web");
    expect(manifest.files).toHaveLength(result.plan.files.length - 1);
  });

  it("never overwrites an existing Attempt candidate", async () => {
    const { generator } = await createGenerator();
    const identity = candidateIdentity();
    await generator.execute({ projectId: "safety-sprint", spec, mode: "apply", ...identity });

    await expect(
      generator.execute({ projectId: "safety-sprint", spec, mode: "apply", ...identity }),
    ).rejects.toThrow();
  });

  it("updates only clean generator-owned files and preserves assets and unknown files", async () => {
    const { generator, root } = await createGenerator();
    const created = await createAccepted(generator, root, "safety-sprint");
    const project = path.join(root, "safety-sprint");
    const assetManifestPath = path.join(project, "public", "assets", "manifest.json");
    const assetManifest = { schemaVersion: "1.0", projectId: "safety-sprint", revision: 1, assets: [] };
    await writeFile(assetManifestPath, `${JSON.stringify(assetManifest, null, 2)}\n`);
    await writeFile(path.join(project, "NOTES.md"), "user notes\n");
    const revised = { ...spec, title: "Safety Sprint Revised", targetDurationSeconds: 120 };

    const preview = await generator.execute({
      projectId: "safety-sprint",
      spec: revised,
      operation: "update",
      ...candidateIdentity(),
    });
    expect(preview.update).toMatchObject({
      currentPlanSha256: created.plan.planSha256,
      preservedPaths: ["public/assets/manifest.json"],
      conflicts: [],
    });
    expect(preview.update?.updatedPaths).toContain("game-spec.json");
    const currentPlanSha256 = preview.update?.currentPlanSha256;
    if (currentPlanSha256 === undefined) throw new Error("Update preview did not return a current plan hash.");

    const applied = await generator.execute({
      projectId: "safety-sprint",
      spec: revised,
      operation: "update",
      mode: "apply",
      expectedPlanSha256: currentPlanSha256,
      ...candidateIdentity(),
    });
    expect(applied.operation).toBe("update");
    expect(JSON.parse(await readFile(path.join(applied.outputPath!, "game-spec.json"), "utf8"))).toEqual(revised);
    expect(JSON.parse(await readFile(path.join(applied.outputPath!, "public", "assets", "manifest.json"), "utf8"))).toEqual(assetManifest);
    expect(await readFile(path.join(applied.outputPath!, "NOTES.md"), "utf8")).toBe("user notes\n");
  });

  it("writes a modification only to its Attempt candidate and returns its bounded digest manifest", async () => {
    const { generator, root } = await createGenerator();
    const created = await createAccepted(generator, root, "safety-sprint");
    const acceptedSpecPath = path.join(root, "safety-sprint", "game-spec.json");
    const acceptedSpec = await readFile(acceptedSpecPath, "utf8");
    const revised = { ...spec, title: "Isolated Revision" };

    const result = await generator.execute({
      projectId: "safety-sprint",
      spec: revised,
      operation: "update",
      mode: "apply",
      expectedPlanSha256: created.plan.planSha256,
      attemptId: "attempt-00000000-0000-4000-8000-000000000064",
      revisionId: "revision-00000000-0000-4000-8000-000000000064",
    });

    expect(await readFile(acceptedSpecPath, "utf8")).toBe(acceptedSpec);
    expect(result.outputPath).toBe(await realpath(path.join(
      root,
      ".gameforge",
      "candidates",
      "attempt-00000000-0000-4000-8000-000000000064",
      "safety-sprint",
    )));
    expect(JSON.parse(await readFile(path.join(result.outputPath!, "game-spec.json"), "utf8")))
      .toEqual(revised);
    const candidate = JSON.parse(await readFile(
      path.join(result.outputPath!, ".gameforge", "candidate.json"),
      "utf8",
    )) as {
      attemptId: string;
      revisionId: string;
      files: Array<{ path: string; bytes: number; sha256: string }>;
      aggregateSha256: string;
    };
    expect(candidate).toMatchObject({
      attemptId: "attempt-00000000-0000-4000-8000-000000000064",
      revisionId: "revision-00000000-0000-4000-8000-000000000064",
    });
    expect(candidate.files.length).toBeGreaterThan(0);
    expect(candidate.files.length).toBeLessThanOrEqual(4_096);
    expect(candidate.aggregateSha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it("cleans a failed Attempt candidate without changing the accepted project", async () => {
    const { generator, root } = await createGenerator();
    const created = await createAccepted(generator, root, "safety-sprint");
    const project = path.join(root, "safety-sprint");
    const gameSourcePath = path.join(project, "src", "game.ts");
    const originalGameSource = await readFile(gameSourcePath, "utf8");
    await writeFile(gameSourcePath, "// user modification\n");
    const acceptedBefore = await readFile(gameSourcePath, "utf8");
    const revised = { ...spec, title: "Revised" };
    const preview = await generator.execute({
      projectId: "safety-sprint", spec: revised, operation: "update", ...candidateIdentity(),
    });
    expect(preview.update?.conflicts).toEqual(["src/game.ts"]);
    const failedIdentity = candidateIdentity();
    await expect(generator.execute({
      projectId: "safety-sprint",
      spec: revised,
      operation: "update",
      mode: "apply",
      expectedPlanSha256: created.plan.planSha256,
      ...failedIdentity,
    })).rejects.toThrow("modified managed files");
    expect(await readFile(gameSourcePath, "utf8")).toBe(acceptedBefore);
    await expect(readFile(path.join(
      root,
      ".gameforge",
      "candidates",
      failedIdentity.attemptId,
      "safety-sprint",
      "game-spec.json",
    ))).rejects.toMatchObject({ code: "ENOENT" });

    await writeFile(gameSourcePath, originalGameSource);
    await expect(generator.execute({
      projectId: "safety-sprint",
      spec: revised,
      operation: "update",
      mode: "apply",
      expectedPlanSha256: "0".repeat(64),
      ...candidateIdentity(),
    })).rejects.toThrow("plan conflict");
  });

  it("does not reuse an existing Attempt candidate", async () => {
    const { generator, root } = await createGenerator();
    const created = await createAccepted(generator, root, "safety-sprint");
    const identity = candidateIdentity();
    const lockPath = path.join(root, ".gameforge", "candidates", identity.attemptId, "safety-sprint", ".gameforge", "update.lock");
    await mkdir(path.dirname(lockPath), { recursive: true });
    await writeFile(lockPath, `${JSON.stringify({
      version: 1,
      token: "00000000-0000-4000-8000-000000000077",
      pid: 2_147_483_647,
      hostname: hostname(),
      createdAtMs: 0,
    })}\n`);
    await expect(generator.execute({
      projectId: "safety-sprint",
      spec: { ...spec, title: "Recovered Update" },
      operation: "update",
      mode: "apply",
      expectedPlanSha256: created.plan.planSha256,
      ...identity,
    })).rejects.toThrow("already exists");
    await expect(readFile(lockPath)).resolves.toBeTruthy();
  });

  it("rolls back or finalizes a persisted managed update from the manifest commit point", async () => {
    for (const state of ["old", "new"] as const) {
      const { generator, root } = await createGenerator();
      const projectId = `txn-${state}`;
      const project = path.join(root, projectId);
      const oldSpec = { ...spec, title: `Old ${state}` };
      const newSpec = { ...spec, title: `New ${state}` };
      const created = await createAccepted(generator, root, projectId, oldSpec);
      const manifestPath = path.join(project, ".gameforge", "manifest.json");
      const specPath = path.join(project, "game-spec.json");
      const oldManifestText = await readFile(manifestPath, "utf8");
      const oldManifest = JSON.parse(oldManifestText) as { planSha256: string; files: Array<{ path: string; bytes: number; sha256: string }> };
      const oldSpecText = await readFile(specPath, "utf8");
      const updated = await generator.execute({
        projectId,
        spec: newSpec,
        operation: "update",
        mode: "apply",
        expectedPlanSha256: created.plan.planSha256,
        ...candidateIdentity(),
      });
      const newManifestText = await readFile(path.join(updated.outputPath!, ".gameforge", "manifest.json"), "utf8");
      const newManifest = JSON.parse(newManifestText) as { planSha256: string; files: Array<{ path: string; bytes: number; sha256: string }> };
      const newSpecText = await readFile(path.join(updated.outputPath!, "game-spec.json"), "utf8");
      const transactionId = state === "old"
        ? "00000000-0000-4000-8000-000000000061"
        : "00000000-0000-4000-8000-000000000062";
      const oldFile = oldManifest.files.find((file) => file.path === "game-spec.json");
      const newFile = newManifest.files.find((file) => file.path === "game-spec.json");
      if (oldFile === undefined || newFile === undefined) throw new Error("Test manifest lacks game-spec metadata.");
      await writeFile(`${specPath}.${transactionId}.bak`, oldSpecText);
      await writeFile(specPath, newSpecText);
      if (state === "new") await writeFile(manifestPath, newManifestText);
      const hash = (value: string) => createHash("sha256").update(value).digest("hex");
      await writeFile(path.join(project, ".gameforge", "update.transaction.json"), `${JSON.stringify({
        version: 1,
        transactionId,
        projectId,
        oldManifestSha256: hash(oldManifestText),
        newManifestSha256: hash(newManifestText),
        oldPlanSha256: oldManifest.planSha256,
        newPlanSha256: newManifest.planSha256,
        files: [{ path: "game-spec.json", action: "update", old: oldFile, new: newFile }],
      }, null, 2)}\n`);

      await expect(generator.recover(projectId)).resolves.toMatchObject({
        projectId,
        status: state === "old" ? "rolled-back" : "committed",
        planSha256: state === "old" ? oldManifest.planSha256 : newManifest.planSha256,
      });
      expect(JSON.parse(await readFile(specPath, "utf8"))).toMatchObject({ title: state === "old" ? oldSpec.title : newSpec.title });
      await expect(readFile(`${specPath}.${transactionId}.bak`)).rejects.toMatchObject({ code: "ENOENT" });
    }
  });

  it("recovers a managed delete without touching unknown files", async () => {
    for (const state of ["old", "new"] as const) {
      const { generator, root } = await createGenerator();
      const projectId = `delete-${state}`;
      const project = path.join(root, projectId);
      await createAccepted(generator, root, projectId);
      await writeFile(path.join(project, "NOTES.md"), "keep me\n");
      const manifestPath = path.join(project, ".gameforge", "manifest.json");
      const oldManifestText = await readFile(manifestPath, "utf8");
      const oldManifest = JSON.parse(oldManifestText) as {
        planSha256: string; files: Array<{ path: string; bytes: number; sha256: string }>;
      };
      const oldFile = oldManifest.files.find((file) => file.path === ".npmrc");
      if (oldFile === undefined) throw new Error("Test manifest lacks .npmrc metadata.");
      const newManifest = { ...oldManifest, planSha256: "b".repeat(64), files: oldManifest.files.filter((file) => file.path !== ".npmrc") };
      const newManifestText = `${JSON.stringify(newManifest, null, 2)}\n`;
      const transactionId = state === "old"
        ? "00000000-0000-4000-8000-000000000063"
        : "00000000-0000-4000-8000-000000000064";
      const npmrcPath = path.join(project, ".npmrc");
      await rename(npmrcPath, `${npmrcPath}.${transactionId}.bak`);
      if (state === "new") await writeFile(manifestPath, newManifestText);
      const hash = (value: string) => createHash("sha256").update(value).digest("hex");
      await writeFile(path.join(project, ".gameforge", "update.transaction.json"), `${JSON.stringify({
        version: 1,
        transactionId,
        projectId,
        oldManifestSha256: hash(oldManifestText),
        newManifestSha256: hash(newManifestText),
        oldPlanSha256: oldManifest.planSha256,
        newPlanSha256: newManifest.planSha256,
        files: [{ path: ".npmrc", action: "delete", old: oldFile }],
      }, null, 2)}\n`);
      await expect(generator.recover(projectId)).resolves.toMatchObject({ status: state === "old" ? "rolled-back" : "committed" });
      if (state === "old") expect(await readFile(npmrcPath, "utf8")).toContain("registry=");
      else await expect(readFile(npmrcPath)).rejects.toMatchObject({ code: "ENOENT" });
      expect(await readFile(path.join(project, "NOTES.md"), "utf8")).toBe("keep me\n");
    }
  });

  it("keeps untrusted GameSpec text out of executable source", async () => {
    const { generator, root } = await createGenerator();
    const injected = {
      ...spec,
      objective: "Collect items. </script><script>globalThis.pwned=true</script>",
    };

    await createAccepted(generator, root, "safe-output", injected);

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
        ...candidateIdentity(),
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
    await createAccepted(generator, root, "tuned-game", tuned);
    expect(JSON.parse(await readFile(path.join(root, "tuned-game", "game-spec.json"), "utf8")))
      .toMatchObject({ gameplay: tuned.gameplay });
    const source = await readFile(path.join(root, "tuned-game", "src", "game.ts"), "utf8");
    expect(source).toContain("spec.gameplay?.collectibleCount");
    expect(source).toContain("slice(0, hazardCount)");
    expect(source).toContain("direction.x * movementSpeed");
  });

  it("validates runtime media bindings and starts background music after user input", async () => {
    const { generator, root } = await createGenerator();
    await createAccepted(generator, root, "media-game");

    const source = await readFile(path.join(root, "media-game", "src", "game.ts"), "utf8");
    expect(source).toContain("function parseRuntimeAssets(value: unknown)");
    expect(source).toContain("assetPathPattern.test(path)");
    expect(source).toContain("roles.has(role as RuntimeAssetRole)");
    expect(source).toContain('this.sound.play("bgm", { loop: true, volume: 0.35 })');
    expect(source).toContain('this.input.once("pointerdown", () => this.startAudio())');
  });

  it("normalizes generated image dimensions for rendering and collision", async () => {
    const { generator, root } = await createGenerator();
    await createAccepted(generator, root, "image-sizing");

    const source = await readFile(path.join(root, "image-sizing", "src", "game.ts"), "utf8");
    expect(source).toContain('this.createSizedSprite(120, height / 2, "player", 32, 32)');
    expect(source).toContain('(sprite.body as Phaser.Physics.Arcade.Body).setSize(displayWidth, displayHeight, true)');
    expect(source).toContain('collectible.setDisplaySize(24, 24)');
    expect(source).toContain('(collectible.body as Phaser.Physics.Arcade.Body).setSize(24, 24, true)');
  });

  it("localizes generated runtime chrome while preserving legacy Chinese defaults", async () => {
    const { generator, root } = await createGenerator();
    await createAccepted(generator, root, "english-game", { ...spec, locale: "en-US" });

    const source = await readFile(path.join(root, "english-game", "src", "game.ts"), "utf8");
    const html = await readFile(path.join(root, "english-game", "index.html"), "utf8");
    expect(source).toContain('const locale = spec.locale ?? "zh-CN"');
    expect(source).toContain('document.documentElement.lang = locale');
    expect(source).toContain('won: "Mission Complete"');
    expect(source).toContain('arcadeControls: "Arrow keys to move, collect targets, and avoid hazards"');
    const semanticSource = source.replace(/\\u([0-9a-f]{4})/gi, (_match, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)));
    expect(semanticSource).toContain('won: "任务完成"');
    expect(html).toContain('<html lang="en-US">');
    expect(html).toContain('aria-label="GameForge generated game"');
    expect(html).toContain('<link rel="icon" href="data:," />');

    await createAccepted(generator, root, "legacy-game");
    const legacyHtml = await readFile(path.join(root, "legacy-game", "index.html"), "utf8");
    expect(legacyHtml).toContain('<html lang="zh-CN">');
    expect(legacyHtml).toContain('aria-label="GameForge 生成的游戏"');
  });

  it("rejects relative output roots", () => {
    expect(() => new GameProjectGenerator({ outputRoot: "generated-games" })).toThrow("absolute");
  });
});
