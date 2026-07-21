import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { GameProjectGenerator } from "./generator.js";
import { ManagedLayaGameplayVerifier } from "./laya-headless.js";

const roots: string[] = [];
const baseSpec = {
  title: "Logic Proof",
  objective: "Reach deterministic win and loss terminal states.",
  controls: ["Arrow keys"],
  winCondition: "Complete the genre objective.",
  loseCondition: "The timer reaches zero.",
  targetDurationSeconds: 30,
  gameplay: { collectibleCount: 2, hazardCount: 2, startingLives: 3, movementSpeed: 220 },
};
const orderCollectSpec = {
  specVersion: "1.0" as const,
  title: "花园订单冲刺",
  locale: "zh-CN" as const,
  genre: "arcade" as const,
  mechanicProfile: "order-collect" as const,
  theme: "garden" as const,
  randomSeed: 19016,
  inputActions: ["move-pointer", "restart"] as Array<"move-pointer" | "restart">,
  objective: "在倒计时结束前收齐花园订单中的全部六件物品。",
  controls: ["单指拖动篮子", "方向键移动", "结束后立即重开"],
  winCondition: "在时限内收齐全部六件订单物品。",
  loseCondition: "倒计时耗尽或三点生命全部失去。",
  targetDurationSeconds: 75,
  gameplay: { collectibleCount: 6 as const, hazardCount: 3 as const, startingLives: 3 as const, movementSpeed: 220 },
};

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("managed Laya gameplay verifier", () => {
  it("proves shared-core win, timeout, and lives-depleted terminal states", async () => {
    const temporary = await mkdtemp(path.join(tmpdir(), "gameforge-order-collect-proof-"));
    roots.push(temporary);
    const projectsRoot = path.join(temporary, "projects");
    await new GameProjectGenerator({ outputRoot: projectsRoot }).execute({
      projectId: "garden-order-proof", target: "douyin-mini-game", mode: "apply", spec: orderCollectSpec,
    });

    await expect(new ManagedLayaGameplayVerifier({ projectsRoot }).verify("garden-order-proof"))
      .resolves.toMatchObject({
        projectId: "garden-order-proof",
        target: "douyin-mini-game",
        genre: "arcade",
        passed: true,
        scenarios: [
          { name: "genre-win", outcome: "won", actions: 6, telemetry: { endReason: "orders-complete", score: 6, lives: 3 } },
          { name: "timeout-loss", outcome: "lost", telemetry: { endReason: "time-expired", score: 0, lives: 3 } },
          { name: "lives-depleted-loss", outcome: "lost", actions: 3, telemetry: { endReason: "lives-depleted", score: 0, lives: 0 } },
        ],
      });
  });

  it("proves genre wins and timeout losses for both mini-game targets", async () => {
    const temporary = await mkdtemp(path.join(tmpdir(), "gameforge-managed-laya-proof-"));
    roots.push(temporary);
    const projectsRoot = path.join(temporary, "projects");
    const generator = new GameProjectGenerator({ outputRoot: projectsRoot });
    const verifier = new ManagedLayaGameplayVerifier({ projectsRoot });
    const genres = ["arcade", "platformer", "puzzle", "shooter", "strategy"] as const;
    for (const [index, genre] of genres.entries()) {
      const target = index % 2 === 0 ? "douyin-mini-game" : "wechat-mini-game";
      const projectId = `${target === "douyin-mini-game" ? "douyin" : "wechat"}-${genre}-proof`;
      await generator.execute({ projectId, target, mode: "apply", spec: { ...baseSpec, genre } });
      await expect(verifier.verify(projectId)).resolves.toMatchObject({
        projectId, target, genre, passed: true,
        scenarios: [
          { name: "genre-win", outcome: "won" },
          { name: "timeout-loss", outcome: "lost" },
        ],
      });
    }
  });

  it("refuses modified runtime code before creating a VM", async () => {
    const temporary = await mkdtemp(path.join(tmpdir(), "gameforge-managed-laya-tamper-"));
    roots.push(temporary);
    const projectsRoot = path.join(temporary, "projects");
    await new GameProjectGenerator({ outputRoot: projectsRoot }).execute({
      projectId: "tampered-game", target: "wechat-mini-game", mode: "apply", spec: { ...baseSpec, genre: "arcade" },
    });
    await writeFile(path.join(projectsRoot, "tampered-game", "src", "Main.ts"), "process.exit(1);\n");
    await expect(new ManagedLayaGameplayVerifier({ projectsRoot }).verify("tampered-game"))
      .rejects.toThrow("runtime hash mismatch");
  });

  it("rejects a forged file entry that no longer matches the top-level spec hash", async () => {
    const temporary = await mkdtemp(path.join(tmpdir(), "gameforge-managed-laya-spec-forge-"));
    roots.push(temporary);
    const projectsRoot = path.join(temporary, "projects");
    await new GameProjectGenerator({ outputRoot: projectsRoot }).execute({
      projectId: "forged-spec", target: "douyin-mini-game", mode: "apply", spec: { ...baseSpec, genre: "arcade" },
    });
    const project = path.join(projectsRoot, "forged-spec");
    const specPath = path.join(project, "assets", "resources", "game-spec.json");
    const changedSpec = `${JSON.stringify({ ...baseSpec, title: "Forged but valid", genre: "arcade" }, null, 2)}\n`;
    await writeFile(specPath, changedSpec);
    const manifestPath = path.join(project, ".gameforge", "manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
      target: string; planSha256: string; files: Array<{ path: string; bytes: number; sha256: string }>;
    };
    const entry = manifest.files.find((candidate) => candidate.path === "assets/resources/game-spec.json");
    if (entry === undefined) throw new Error("Expected managed GameSpec entry.");
    entry.bytes = Buffer.byteLength(changedSpec);
    entry.sha256 = createHash("sha256").update(changedSpec).digest("hex");
    manifest.planSha256 = createHash("sha256").update(JSON.stringify({ target: manifest.target, files: manifest.files })).digest("hex");
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    await expect(new ManagedLayaGameplayVerifier({ projectsRoot }).verify("forged-spec"))
      .rejects.toThrow("GameSpec hash mismatch");
  });
});
