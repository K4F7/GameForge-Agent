export const runtimeSource = String.raw`import Phaser from "phaser";
import rawSpec from "../game-spec.json";

type Genre = "arcade" | "platformer" | "puzzle" | "shooter" | "strategy";
type GameSpec = {
  title: string;
  locale?: "zh-CN" | "en-US";
  genre: Genre;
  objective: string;
  controls: string[];
  winCondition: string;
  loseCondition: string;
  targetDurationSeconds: number;
  gameplay?: {
    collectibleCount: number;
    hazardCount: number;
    startingLives: number;
    movementSpeed: number;
  };
};

const spec = rawSpec as GameSpec;
const locale = spec.locale ?? "zh-CN";
document.documentElement.lang = locale;
const ui = locale === "en-US" ? {
  progress: "Progress",
  lives: "Lives",
  won: "Mission Complete",
  lost: "Mission Failed",
  restart: "Refresh the page to restart",
  strategyMode: "Command mode changed: movement speed affects risk and time.",
  platformerControls: "Arrow keys to move, ↑ to jump",
  shooterControls: "Arrow keys to move, Space to fire",
  puzzleControls: "Use arrow keys to move one grid cell and plan the route",
  strategyControls: "Use arrow keys for movement orders, Space to switch strategy",
  arcadeControls: "Arrow keys to move, collect targets, and avoid hazards",
} : {
  progress: "进度",
  lives: "生命",
  won: "任务完成",
  lost: "任务失败",
  restart: "刷新页面可重新开始",
  strategyMode: "指令模式切换：移动速度会影响风险与时间。",
  platformerControls: "方向键移动，↑ 跳跃",
  shooterControls: "方向键移动，空格发射",
  puzzleControls: "方向键逐格移动并规划路线",
  strategyControls: "方向键下达移动指令，空格切换策略状态",
  arcadeControls: "方向键移动，收集目标并避开危险",
};
type RuntimeAssetRole = "player" | "collectible" | "hazard" | "background" | "collect-sound" | "hit-sound" | "voice" | "bgm";
type RuntimeAsset = { role: RuntimeAssetRole; path: string; mimeType: string };
type VerificationState = {
  schemaVersion: 1;
  status: "running" | "won" | "lost";
  score: number;
  lives: number;
  remainingSeconds: number;
  detail?: string;
  telemetry?: {
    player: { x: number; y: number };
    collectibles: Array<{ x: number; y: number }>;
    hazards: Array<{ x: number; y: number }>;
  };
};
declare global {
  interface Window { __GAMEFORGE_TEST__: VerificationState }
}
const imageRoles = new Set<RuntimeAssetRole>(["player", "collectible", "hazard", "background"]);
const audioRoles = new Set<RuntimeAssetRole>(["collect-sound", "hit-sound", "voice", "bgm"]);
const assetPathPattern = /^assets\/[a-z0-9][a-z0-9._-]*(?:\/[a-z0-9][a-z0-9._-]*)*$/;
function parseRuntimeAssets(value: unknown): RuntimeAsset[] {
  if (typeof value !== "object" || value === null || !("assets" in value) || !Array.isArray(value.assets)) return [];
  const accepted: RuntimeAsset[] = [];
  const roles = new Set<RuntimeAssetRole>();
  for (const candidate of value.assets) {
    if (typeof candidate !== "object" || candidate === null) continue;
    const role = "role" in candidate ? candidate.role : undefined;
    const path = "path" in candidate ? candidate.path : undefined;
    const mimeType = "mimeType" in candidate ? candidate.mimeType : undefined;
    if (typeof role !== "string" || typeof path !== "string" || typeof mimeType !== "string") continue;
    if (![...imageRoles, ...audioRoles].includes(role as RuntimeAssetRole) || roles.has(role as RuntimeAssetRole)) continue;
    if (!assetPathPattern.test(path)) continue;
    const typedRole = role as RuntimeAssetRole;
    const compatible = imageRoles.has(typedRole)
      ? ["image/jpeg", "image/png", "image/webp"].includes(mimeType)
      : ["audio/mpeg", "audio/ogg", "audio/wav"].includes(mimeType);
    if (!compatible) continue;
    roles.add(typedRole);
    accepted.push({ role: typedRole, path, mimeType });
  }
  return accepted;
}
const runtimeAssets = await fetch("assets/manifest.json")
  .then(async (response) => response.ok ? parseRuntimeAssets(await response.json()) : [])
  .catch((): RuntimeAsset[] => []);
const width = 960;
const height = 540;
const collectibleCount = spec.gameplay?.collectibleCount ?? (spec.genre === "strategy" ? 6 : 5);
const hazardCount = spec.gameplay?.hazardCount ?? (spec.genre === "platformer" ? 2 : 3);
const startingLives = spec.gameplay?.startingLives ?? 3;
const movementSpeed = spec.gameplay?.movementSpeed ?? (spec.genre === "strategy" ? 150 : spec.genre === "platformer" ? 210 : 220);
window.__GAMEFORGE_TEST__ = {
  schemaVersion: 1,
  status: "running",
  score: 0,
  lives: startingLives,
  remainingSeconds: spec.targetDurationSeconds,
};

class GameScene extends Phaser.Scene {
  private player!: Phaser.Physics.Arcade.Sprite;
  private collectibles!: Phaser.Physics.Arcade.Group;
  private hazards!: Phaser.Physics.Arcade.Group;
  private bullets!: Phaser.Physics.Arcade.Group;
  private platforms?: Phaser.Physics.Arcade.StaticGroup;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private actionKey!: Phaser.Input.Keyboard.Key;
  private scoreText!: Phaser.GameObjects.Text;
  private timerText!: Phaser.GameObjects.Text;
  private statusText!: Phaser.GameObjects.Text;
  private score = 0;
  private lives = startingLives;
  private remainingSeconds = spec.targetDurationSeconds;
  private ended = false;
  private damageBlockedUntil = 0;
  private voicePlayed = false;
  private bgmStarted = false;
  private direction = new Phaser.Math.Vector2(1, 0);

  constructor() {
    super("game");
  }

  preload(): void {
    for (const asset of runtimeAssets) {
      if (asset.mimeType.startsWith("image/")) this.load.image(asset.role, asset.path);
      if (asset.mimeType.startsWith("audio/")) this.load.audio(asset.role, asset.path);
    }
  }

  create(): void {
    this.createTextures();
    this.cameras.main.setBackgroundColor("#08111f");
    this.physics.world.setBounds(0, 0, width, height);
    if (this.textures.exists("background")) {
      this.add.image(width / 2, height / 2, "background").setDisplaySize(width, height).setAlpha(0.42);
    }

    this.add.text(24, 18, spec.title, {
      color: "#f8fafc", fontFamily: "system-ui", fontSize: "26px", fontStyle: "bold",
    }).setDepth(10);
    this.add.text(24, 52, spec.objective.slice(0, 110), {
      color: "#94a3b8", fontFamily: "system-ui", fontSize: "14px",
    }).setDepth(10);
    this.scoreText = this.add.text(24, 88, "", {
      color: "#67e8f9", fontFamily: "monospace", fontSize: "18px",
    }).setDepth(10);
    this.timerText = this.add.text(width - 24, 24, "", {
      color: "#fbbf24", fontFamily: "monospace", fontSize: "20px",
    }).setOrigin(1, 0).setDepth(10);
    this.statusText = this.add.text(width / 2, height - 24, this.controlHint(), {
      color: "#cbd5e1", fontFamily: "system-ui", fontSize: "14px",
    }).setOrigin(0.5, 1).setDepth(10);

    const keyboard = this.input.keyboard;
    if (keyboard === null) {
      throw new Error("Keyboard input is unavailable.");
    }
    this.cursors = keyboard.createCursorKeys();
    this.actionKey = keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);
    this.input.once("pointerdown", () => this.startAudio());
    keyboard.once("keydown", () => this.startAudio());

    this.collectibles = this.physics.add.group({ allowGravity: false, immovable: true });
    this.hazards = this.physics.add.group({ allowGravity: spec.genre === "platformer" });
    this.bullets = this.physics.add.group({ allowGravity: false });

    if (spec.genre === "platformer") {
      this.createPlatformerWorld();
    } else {
      this.createArenaWorld();
    }

    this.physics.add.overlap(this.player, this.collectibles, (_player, item) => {
      this.collectItem(item as Phaser.GameObjects.GameObject);
    });
    this.physics.add.overlap(this.player, this.hazards, () => this.hitHazard());
    this.physics.add.overlap(this.bullets, this.hazards, (_bullet, hazard) => {
      if (spec.genre === "shooter") {
        (_bullet as Phaser.GameObjects.GameObject).destroy();
        (hazard as Phaser.GameObjects.GameObject).destroy();
      }
    });

    this.updateHud();
  }

  update(_time: number, delta: number): void {
    if (this.ended) return;

    this.remainingSeconds = Math.max(0, this.remainingSeconds - delta / 1000);
    if (this.remainingSeconds <= 0) {
      this.finish(false, spec.loseCondition);
      return;
    }

    if (spec.genre === "platformer") {
      this.updatePlatformerMovement();
    } else if (spec.genre === "puzzle") {
      this.updatePuzzleMovement();
    } else {
      this.updateArenaMovement();
    }

    if (spec.genre === "shooter" && Phaser.Input.Keyboard.JustDown(this.actionKey)) {
      this.fire();
    }
    if (spec.genre === "strategy" && Phaser.Input.Keyboard.JustDown(this.actionKey)) {
      this.player.setTint(this.player.tintTopLeft === 0xffffff ? 0x22d3ee : 0xffffff);
      this.statusText.setText(ui.strategyMode);
    }

    this.updateHud();
  }

  private createTextures(): void {
    const graphics = this.add.graphics();
    if (!this.textures.exists("player")) {
      graphics.fillStyle(0x22d3ee).fillRoundedRect(0, 0, 32, 32, 8).generateTexture("player", 32, 32);
    }
    if (!this.textures.exists("collectible")) {
      graphics.clear().fillStyle(0xfbbf24).fillCircle(12, 12, 11).generateTexture("collectible", 24, 24);
    }
    if (!this.textures.exists("hazard")) {
      graphics.clear().fillStyle(0xef4444).fillTriangle(16, 0, 32, 32, 0, 32).generateTexture("hazard", 32, 32);
    }
    graphics.clear().fillStyle(0xa78bfa).fillRoundedRect(0, 0, 60, 20, 5).generateTexture("platform", 60, 20);
    graphics.clear().fillStyle(0xf8fafc).fillCircle(5, 5, 5).generateTexture("bullet", 10, 10);
    graphics.destroy();
  }

  private createArenaWorld(): void {
    if (!this.textures.exists("background")) {
      this.add.grid(width / 2, height / 2 + 40, width - 80, height - 160, 48, 48, 0x0f1f35, 0.9, 0x1e3a5f, 0.35);
    }
    this.player = this.createSizedSprite(120, height / 2, "player", 32, 32).setCollideWorldBounds(true);

    const itemPositions: ReadonlyArray<readonly [number, number]> = [[250, 170], [440, 150], [690, 180], [310, 390], [650, 390], [820, 300], [540, 410], [790, 150], [390, 220], [720, 330]];
    for (let index = 0; index < collectibleCount; index += 1) {
      const position = itemPositions[index] ?? [480, 270];
      this.createCollectible(position[0], position[1]);
    }

    const hazardPositions: ReadonlyArray<readonly [number, number]> = [[380, 270], [570, 300], [780, 410], [470, 410], [830, 220], [260, 320]];
    hazardPositions.slice(0, hazardCount).forEach((position, index) => {
      const hazard = this.createSizedSprite(position[0], position[1], "hazard", 32, 32)
        .setCollideWorldBounds(true)
        .setBounce(1)
        .setVelocity(index % 2 === 0 ? 115 : -135, index === 1 ? 90 : -70);
      this.hazards.add(hazard);
    });
  }

  private createPlatformerWorld(): void {
    this.platforms = this.physics.add.staticGroup();
    for (let x = 30; x < width; x += 60) this.platforms.create(x, 510, "platform");
    [[210, 410], [270, 410], [470, 340], [530, 340], [720, 420], [780, 420]].forEach(([x, y]) => {
      this.platforms?.create(x, y, "platform");
    });

    this.player = this.createSizedSprite(100, 460, "player", 32, 32).setCollideWorldBounds(true).setBounce(0.05);
    this.physics.add.collider(this.player, this.platforms);
    this.physics.add.collider(this.hazards, this.platforms);

    const itemPositions: ReadonlyArray<readonly [number, number]> = [[230, 370], [500, 300], [750, 380], [620, 470], [860, 470], [320, 470], [420, 470], [580, 470], [700, 470], [810, 470]];
    itemPositions.slice(0, collectibleCount).forEach(([x, y]) => {
      this.createCollectible(x, y);
    });
    const hazardPositions: ReadonlyArray<readonly [number, number]> = [[350, 450], [680, 450], [820, 450], [520, 450], [260, 450], [760, 390]];
    hazardPositions.slice(0, hazardCount).forEach(([x, y], index) => {
      const hazard = this.createSizedSprite(x, y, "hazard", 32, 32).setBounce(1).setVelocityX(index === 0 ? 100 : -120);
      this.hazards.add(hazard);
    });
  }

  private updateArenaMovement(): void {
    let x = 0;
    let y = 0;
    if (this.cursors.left.isDown) x -= 1;
    if (this.cursors.right.isDown) x += 1;
    if (this.cursors.up.isDown) y -= 1;
    if (this.cursors.down.isDown) y += 1;
    const direction = new Phaser.Math.Vector2(x, y).normalize();
    this.player.setVelocity(direction.x * movementSpeed, direction.y * movementSpeed);
    if (direction.lengthSq() > 0) this.direction.copy(direction);
  }

  private createSizedSprite(
    x: number,
    y: number,
    texture: string,
    displayWidth: number,
    displayHeight: number,
  ): Phaser.Physics.Arcade.Sprite {
    const sprite = this.physics.add.sprite(x, y, texture).setDisplaySize(displayWidth, displayHeight);
    (sprite.body as Phaser.Physics.Arcade.Body).setSize(displayWidth, displayHeight, true);
    return sprite;
  }

  private createCollectible(x: number, y: number): void {
    const collectible = this.collectibles.create(x, y, "collectible") as Phaser.Physics.Arcade.Sprite;
    collectible.setDisplaySize(24, 24);
    (collectible.body as Phaser.Physics.Arcade.Body).setSize(24, 24, true);
  }

  private updatePuzzleMovement(): void {
    const step = 48;
    let x = this.player.x;
    let y = this.player.y;
    if (Phaser.Input.Keyboard.JustDown(this.cursors.left)) x -= step;
    else if (Phaser.Input.Keyboard.JustDown(this.cursors.right)) x += step;
    else if (Phaser.Input.Keyboard.JustDown(this.cursors.up)) y -= step;
    else if (Phaser.Input.Keyboard.JustDown(this.cursors.down)) y += step;
    x = Phaser.Math.Clamp(x, 64, width - 64);
    y = Phaser.Math.Clamp(y, 128, height - 64);
    (this.player.body as Phaser.Physics.Arcade.Body).reset(x, y);
  }

  private updatePlatformerMovement(): void {
    this.player.setVelocityX(0);
    if (this.cursors.left.isDown) this.player.setVelocityX(-movementSpeed);
    if (this.cursors.right.isDown) this.player.setVelocityX(movementSpeed);
    if (this.cursors.up.isDown && (this.player.body as Phaser.Physics.Arcade.Body).blocked.down) this.player.setVelocityY(-440);
  }

  private fire(): void {
    const bullet = this.physics.add.sprite(this.player.x, this.player.y, "bullet");
    bullet.setVelocity(this.direction.x * 520, this.direction.y * 520).setCollideWorldBounds(true).setBounce(1);
    this.bullets.add(bullet);
    this.time.delayedCall(1200, () => bullet.destroy());
  }

  private collectItem(item: Phaser.GameObjects.GameObject): void {
    if (!item.active) return;
    item.destroy();
    this.score += 1;
    this.playSound("collect-sound");
    this.cameras.main.flash(90, 34, 211, 238);
    if (this.score >= collectibleCount) this.finish(true, spec.winCondition);
  }

  private hitHazard(): void {
    if (this.time.now < this.damageBlockedUntil || this.ended) return;
    this.damageBlockedUntil = this.time.now + 900;
    this.lives -= 1;
    this.playSound("hit-sound");
    this.player.setTint(0xfca5a5);
    this.time.delayedCall(250, () => this.player.clearTint());
    (this.player.body as Phaser.Physics.Arcade.Body).reset(110, spec.genre === "platformer" ? 450 : height / 2);
    if (this.lives <= 0) this.finish(false, spec.loseCondition);
  }

  private finish(won: boolean, detail: string): void {
    this.ended = true;
    this.updateHud();
    window.__GAMEFORGE_TEST__ = {
      status: won ? "won" : "lost",
      score: this.score,
      lives: this.lives,
      remainingSeconds: this.remainingSeconds,
      detail,
      telemetry: this.telemetry(),
    };
    window.dispatchEvent(new CustomEvent("gameforge:outcome", { detail: window.__GAMEFORGE_TEST__ }));
    this.physics.pause();
    this.add.rectangle(width / 2, height / 2, 640, 220, 0x020617, 0.94).setStrokeStyle(2, won ? 0x22d3ee : 0xef4444).setDepth(20);
    this.add.text(width / 2, height / 2 - 48, won ? ui.won : ui.lost, {
      color: won ? "#67e8f9" : "#fca5a5", fontFamily: "system-ui", fontSize: "38px", fontStyle: "bold",
    }).setOrigin(0.5).setDepth(21);
    this.add.text(width / 2, height / 2 + 18, detail.slice(0, 120), {
      color: "#e2e8f0", fontFamily: "system-ui", fontSize: "17px", align: "center", wordWrap: { width: 540 },
    }).setOrigin(0.5).setDepth(21);
    this.add.text(width / 2, height / 2 + 80, ui.restart, {
      color: "#94a3b8", fontFamily: "system-ui", fontSize: "14px",
    }).setOrigin(0.5).setDepth(21);
  }

  private updateHud(): void {
    if (!this.ended) {
      window.__GAMEFORGE_TEST__ = {
        status: "running",
        score: this.score,
        lives: this.lives,
        remainingSeconds: this.remainingSeconds,
        telemetry: this.telemetry(),
      };
    }
    this.scoreText.setText(ui.progress + " " + this.score + "/" + collectibleCount + "   " + ui.lives + " " + this.lives);
    this.timerText.setText(Math.ceil(this.remainingSeconds) + "s");
  }

  private telemetry(): NonNullable<VerificationState["telemetry"]> {
    const point = (object: Phaser.GameObjects.GameObject): { x: number; y: number } => {
      const positioned = object as Phaser.GameObjects.GameObject & { x: number; y: number };
      return { x: Math.round(positioned.x * 100) / 100, y: Math.round(positioned.y * 100) / 100 };
    };
    return {
      player: point(this.player),
      collectibles: this.collectibles.getChildren().filter((item) => item.active).map(point),
      hazards: this.hazards.getChildren().filter((item) => item.active).map(point),
    };
  }

  private controlHint(): string {
    if (spec.genre === "platformer") return ui.platformerControls;
    if (spec.genre === "shooter") return ui.shooterControls;
    if (spec.genre === "puzzle") return ui.puzzleControls;
    if (spec.genre === "strategy") return ui.strategyControls;
    return ui.arcadeControls;
  }

  private playSound(key: string): void {
    if (!this.cache.audio.exists(key)) return;
    try {
      this.sound.play(key);
    } catch {
      // Audio decoding or autoplay restrictions must not make the game unplayable.
    }
  }

  private playVoice(): void {
    if (this.voicePlayed || !this.cache.audio.exists("voice")) return;
    this.voicePlayed = true;
    this.playSound("voice");
  }

  private startAudio(): void {
    if (!this.bgmStarted && this.cache.audio.exists("bgm")) {
      this.bgmStarted = true;
      try {
        this.sound.play("bgm", { loop: true, volume: 0.35 });
      } catch {
        this.bgmStarted = false;
      }
    }
    this.playVoice();
  }
}

new Phaser.Game({
  type: Phaser.AUTO,
  parent: "game",
  width,
  height,
  backgroundColor: "#08111f",
  physics: {
    default: "arcade",
    arcade: { gravity: { x: 0, y: spec.genre === "platformer" ? 900 : 0 }, debug: false },
  },
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  scene: [GameScene],
});
`;

export const loaderSource = String.raw`const host = document.querySelector<HTMLElement>("#game");
if (host === null) throw new Error("Game host is missing.");
host.dataset.state = "loading";

import("./game.js").then(() => {
  host.dataset.state = "ready";
}).catch((error: unknown) => {
  host.dataset.state = "failed";
  host.textContent = error instanceof Error ? "Game failed to load: " + error.message : "Game failed to load.";
});
`;

export function createIndexHtml(locale: "zh-CN" | "en-US" = "zh-CN"): string {
  const ariaLabel = locale === "en-US" ? "GameForge generated game" : "GameForge 生成的游戏";
  return String.raw`<!doctype html>
<html lang="${locale}">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="theme-color" content="#08111f" />
    <link rel="icon" href="data:," />
    <title>GameForge Generated Game</title>
    <style>
      html, body, #game { width: 100%; height: 100%; margin: 0; }
      body { overflow: hidden; background: #08111f; }
      canvas { display: block; margin: auto; }
      #game[data-state="loading"]::before { content: "${locale === "en-US" ? "Loading game…" : "游戏加载中…"}"; color: #e2e8f0; font: 600 18px system-ui; position: absolute; inset: 50% auto auto 50%; transform: translate(-50%, -50%); }
      #game[data-state="failed"] { color: #fca5a5; display: grid; place-items: center; font: 600 16px system-ui; }
    </style>
  </head>
  <body>
    <main id="game" aria-label="${ariaLabel}"></main>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
`;
}
