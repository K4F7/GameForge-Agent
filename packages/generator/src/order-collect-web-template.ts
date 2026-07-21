import { orderCollectSimulationSource } from "@gameforge/simulation-core";

export const orderCollectWebRuntimeSource = String.raw`import Phaser from "phaser";
import rawSpec from "../game-spec.json";

type OrderCollectSpec = {
  title: string;
  locale?: "zh-CN" | "en-US";
  genre: "arcade";
  mechanicProfile: "order-collect";
  theme: "garden" | "restaurant" | "department-store";
  randomSeed: number;
  objective: string;
  winCondition: string;
  loseCondition: string;
  targetDurationSeconds: 75;
  gameplay: { collectibleCount: 6; hazardCount: 3; startingLives: 3; movementSpeed: number };
};
type RuntimeAsset = { role: string; path: string; mimeType: string };
type VerificationState = {
  status: "running" | "won" | "lost";
  score: number;
  lives: number;
  remainingSeconds: number;
  detail?: string;
  telemetry: { player: SimulationPoint; collectibles: SimulationPoint[]; hazards: SimulationPoint[] };
  simulation: OrderCollectTelemetry;
};
declare global { interface Window { __GAMEFORGE_TEST__: VerificationState } }
const spec = rawSpec as OrderCollectSpec;
const width = 540;
const height = 960;
const locale = spec.locale ?? "zh-CN";
document.documentElement.lang = locale;
const text = locale === "en-US"
  ? { order: "Order", lives: "Lives", won: "Order complete", lost: "Run failed", restart: "Tap or press R to restart" }
  : { order: "订单", lives: "生命", won: "订单完成", lost: "冲刺失败", restart: "点击或按 R 立即重开" };
const assets = await fetch("assets/manifest.json").then(async (response) => {
  if (!response.ok) return [] as RuntimeAsset[];
  const value = await response.json() as { assets?: RuntimeAsset[] };
  return Array.isArray(value.assets) ? value.assets.filter((entry) =>
    typeof entry.path === "string" && /^assets\/[a-z0-9][a-z0-9._/-]*$/.test(entry.path)
  ) : [];
}).catch(() => [] as RuntimeAsset[]);
` + orderCollectSimulationSource + String.raw`

class OrderCollectScene extends Phaser.Scene {
  private simulation!: OrderCollectSimulation;
  private player!: Phaser.Physics.Arcade.Sprite;
  private collectibles!: Phaser.Physics.Arcade.Group;
  private hazards!: Phaser.Physics.Arcade.Group;
  private readonly collectibleIds = new Map<Phaser.GameObjects.GameObject, string>();
  private readonly hazardIds = new Map<Phaser.GameObjects.GameObject, string>();
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private orderText!: Phaser.GameObjects.Text;
  private timerText!: Phaser.GameObjects.Text;
  private ended = false;
  private damageBlockedUntil = 0;
  private pointerTarget: SimulationPoint | undefined;

  constructor() { super("order-collect"); }

  preload(): void {
    for (const asset of assets) {
      if (asset.mimeType.startsWith("image/") && ["player", "collectible", "hazard", "background"].includes(asset.role)) {
        this.load.image(asset.role, asset.path);
      }
      if (asset.mimeType.startsWith("audio/") && ["collect-sound", "hit-sound", "bgm"].includes(asset.role)) {
        this.load.audio(asset.role, asset.path);
      }
    }
  }

  create(): void {
    this.simulation = new OrderCollectSimulation({
      randomSeed: spec.randomSeed,
      durationSeconds: 75,
      startingLives: 3,
      collectibleCount: 6,
      hazardCount: 3,
      width,
      height,
    });
    this.ended = false;
    this.collectibleIds.clear();
    this.hazardIds.clear();
    this.pointerTarget = undefined;
    this.createTextures();
    this.cameras.main.setBackgroundColor(this.themeColor());
    if (this.textures.exists("background")) this.add.image(width / 2, height / 2, "background").setDisplaySize(width, height).setAlpha(0.4);
    this.add.text(24, 24, spec.title, { color: "#fff", fontFamily: "system-ui", fontSize: "30px", fontStyle: "bold" }).setDepth(10);
    this.add.text(24, 68, spec.objective.slice(0, 72), { color: "#dbeafe", fontFamily: "system-ui", fontSize: "16px", wordWrap: { width: 490 } }).setDepth(10);
    this.orderText = this.add.text(24, 132, "", { color: "#fde68a", fontFamily: "monospace", fontSize: "22px" }).setDepth(10);
    this.timerText = this.add.text(width - 24, 24, "", { color: "#fff", fontFamily: "monospace", fontSize: "24px" }).setOrigin(1, 0).setDepth(10);
    this.add.text(width / 2, height - 24, locale === "en-US" ? "Drag to collect · Arrow keys also work" : "单指拖动收集 · 桌面端也可用方向键", { color: "#e2e8f0", fontFamily: "system-ui", fontSize: "15px" }).setOrigin(0.5, 1).setDepth(10);

    this.collectibles = this.physics.add.group({ allowGravity: false, immovable: true });
    this.hazards = this.physics.add.group({ allowGravity: false, immovable: true });
    const initial = this.simulation.snapshot();
    this.player = this.sizedSprite(initial.player.x, initial.player.y, "player", 46).setCollideWorldBounds(true);
    for (const entity of initial.collectibles) {
      const sprite = this.sizedSprite(entity.position.x, entity.position.y, "collectible", 38);
      sprite.setData("simulationId", entity.id);
      this.collectibleIds.set(sprite, entity.id);
      this.collectibles.add(sprite);
    }
    for (const entity of initial.hazards) {
      const sprite = this.sizedSprite(entity.position.x, entity.position.y, "hazard", 44);
      sprite.setData("simulationId", entity.id);
      this.hazardIds.set(sprite, entity.id);
      this.hazards.add(sprite);
    }
    this.physics.add.overlap(this.player, this.collectibles, (_player, item) => this.collect(item as Phaser.Physics.Arcade.Sprite));
    this.physics.add.overlap(this.player, this.hazards, (_player, hazard) => this.hit(hazard as Phaser.Physics.Arcade.Sprite));

    const keyboard = this.input.keyboard;
    if (keyboard === null) throw new Error("Keyboard input is unavailable.");
    this.cursors = keyboard.createCursorKeys();
    keyboard.on("keydown-R", () => { if (this.ended) this.scene.restart(); });
    this.input.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
      this.startAudio();
      if (this.ended) { this.scene.restart(); return; }
      this.applyPointer(pointer);
    });
    this.input.on("pointermove", (pointer: Phaser.Input.Pointer) => {
      if (pointer.isDown && !this.ended) this.applyPointer(pointer);
    });
    this.input.on("pointerup", () => { this.pointerTarget = undefined; });
    this.publish();
  }

  update(_time: number, delta: number): void {
    if (this.ended) return;
    this.simulation.advance(delta);
    const current = this.simulation.snapshot().player;
    let next = this.pointerTarget;
    if (next === undefined) {
      let dx = 0; let dy = 0;
      if (this.cursors.left.isDown) dx -= 1;
      if (this.cursors.right.isDown) dx += 1;
      if (this.cursors.up.isDown) dy -= 1;
      if (this.cursors.down.isDown) dy += 1;
      if (dx !== 0 || dy !== 0) {
        const length = Math.hypot(dx, dy);
        next = { x: current.x + dx / length * spec.gameplay.movementSpeed * delta / 1000, y: current.y + dy / length * spec.gameplay.movementSpeed * delta / 1000 };
      }
    }
    if (next !== undefined) this.simulation.movePlayer(next);
    let snapshot = this.simulation.snapshot();
    (this.player.body as Phaser.Physics.Arcade.Body).reset(snapshot.player.x, snapshot.player.y);
    this.resolveCoreCollisions();
    snapshot = this.simulation.snapshot();
    this.publish();
    if (snapshot.result !== "running") this.finish(snapshot);
  }

  private collect(sprite: Phaser.Physics.Arcade.Sprite): void {
    if (!sprite.active || this.ended) return;
    const id = this.collectibleIds.get(sprite);
    if (id === undefined) throw new Error("Collectible simulation ID is unavailable.");
    this.simulation.collect(id);
    this.collectibleIds.delete(sprite);
    sprite.destroy();
    this.play("collect-sound");
    this.publish();
    const snapshot = this.simulation.snapshot();
    if (snapshot.result !== "running") this.finish(snapshot);
  }

  private hit(sprite: Phaser.Physics.Arcade.Sprite): void {
    if (this.ended || performance.now() < this.damageBlockedUntil) return;
    this.damageBlockedUntil = performance.now() + 900;
    const id = this.hazardIds.get(sprite);
    if (id === undefined) throw new Error("Hazard simulation ID is unavailable.");
    this.simulation.hitHazard(id);
    this.play("hit-sound");
    this.simulation.movePlayer({ x: width / 2, y: height * 0.72 });
    this.pointerTarget = undefined;
    this.publish();
    const snapshot = this.simulation.snapshot();
    if (snapshot.result !== "running") this.finish(snapshot);
  }

  private applyPointer(pointer: Phaser.Input.Pointer): void {
    this.pointerTarget = { x: pointer.x, y: pointer.y };
    this.simulation.movePlayer(this.pointerTarget);
    let snapshot = this.simulation.snapshot();
    const hazard = snapshot.hazards.find((entity) => {
      const dx = entity.position.x - snapshot.player.x;
      const dy = entity.position.y - snapshot.player.y;
      return dx * dx + dy * dy <= 45 * 45;
    });
    if (hazard !== undefined && performance.now() >= this.damageBlockedUntil) {
      this.damageBlockedUntil = performance.now() + 900;
      this.simulation.hitHazard(hazard.id);
      this.simulation.movePlayer({ x: width / 2, y: height * 0.72 });
      this.pointerTarget = undefined;
      snapshot = this.simulation.snapshot();
    }
    (this.player.body as Phaser.Physics.Arcade.Body).reset(snapshot.player.x, snapshot.player.y);
    this.resolveCoreCollisions();
    this.publish();
    const current = this.simulation.snapshot();
    if (current.result !== "running") this.finish(current);
  }

  private resolveCoreCollisions(): void {
    if (this.ended) return;
    const distanceSquared = (sprite: Phaser.GameObjects.GameObject & { x: number; y: number }): number => {
      const dx = sprite.x - this.player.x;
      const dy = sprite.y - this.player.y;
      return dx * dx + dy * dy;
    };
    for (const candidate of [...this.collectibles.getChildren()]) {
      const sprite = candidate as Phaser.Physics.Arcade.Sprite;
      if (sprite.active && distanceSquared(sprite) <= 42 * 42) this.collect(sprite);
    }
    if (this.ended || performance.now() < this.damageBlockedUntil) return;
    const hazard = this.hazards.getChildren().find((candidate) => {
      const sprite = candidate as Phaser.Physics.Arcade.Sprite;
      return sprite.active && distanceSquared(sprite) <= 45 * 45;
    });
    if (hazard !== undefined) this.hit(hazard as Phaser.Physics.Arcade.Sprite);
  }

  private finish(snapshot: OrderCollectTelemetry): void {
    if (this.ended) return;
    this.ended = true;
    this.physics.pause();
    this.publish();
    const won = snapshot.result === "won";
    this.add.rectangle(width / 2, height / 2, 470, 250, 0x020617, 0.94).setStrokeStyle(3, won ? 0x34d399 : 0xfb7185).setDepth(20);
    this.add.text(width / 2, height / 2 - 55, won ? text.won : text.lost, { color: won ? "#6ee7b7" : "#fda4af", fontFamily: "system-ui", fontSize: "40px", fontStyle: "bold" }).setOrigin(0.5).setDepth(21);
    this.add.text(width / 2, height / 2 + 10, won ? spec.winCondition : spec.loseCondition, { color: "#e2e8f0", fontFamily: "system-ui", fontSize: "17px", align: "center", wordWrap: { width: 420 } }).setOrigin(0.5).setDepth(21);
    this.add.text(width / 2, height / 2 + 84, text.restart, { color: "#cbd5e1", fontFamily: "system-ui", fontSize: "16px" }).setOrigin(0.5).setDepth(21);
    window.dispatchEvent(new CustomEvent("gameforge:outcome", { detail: window.__GAMEFORGE_TEST__ }));
  }

  private publish(): void {
    const simulation = this.simulation.snapshot();
    const point = (object: Phaser.GameObjects.GameObject & { x: number; y: number }): SimulationPoint => ({
      x: Math.round(object.x * 100) / 100,
      y: Math.round(object.y * 100) / 100,
    });
    window.__GAMEFORGE_TEST__ = {
      status: simulation.result,
      score: simulation.score,
      lives: simulation.lives,
      remainingSeconds: simulation.remainingMs / 1000,
      ...(simulation.result === "running" ? {} : { detail: simulation.result === "won" ? spec.winCondition : spec.loseCondition }),
      telemetry: {
        player: point(this.player),
        collectibles: this.collectibles.getChildren().filter((item) => item.active).map((item) => point(item as Phaser.GameObjects.GameObject & { x: number; y: number })),
        hazards: this.hazards.getChildren().filter((item) => item.active).map((item) => point(item as Phaser.GameObjects.GameObject & { x: number; y: number })),
      },
      simulation,
    };
    this.orderText.setText(text.order + " " + simulation.order.collected + "/" + simulation.order.total + "   " + text.lives + " " + simulation.lives);
    this.timerText.setText(Math.ceil(simulation.remainingMs / 1000) + "s");
  }

  private sizedSprite(x: number, y: number, texture: string, size: number): Phaser.Physics.Arcade.Sprite {
    const sprite = this.physics.add.sprite(x, y, texture).setDisplaySize(size, size);
    (sprite.body as Phaser.Physics.Arcade.Body).setSize(size, size, true);
    return sprite;
  }

  private createTextures(): void {
    const graphics = this.add.graphics();
    if (!this.textures.exists("player")) graphics.fillStyle(0x22d3ee).fillRoundedRect(0, 0, 46, 46, 12).generateTexture("player", 46, 46);
    if (!this.textures.exists("collectible")) graphics.clear().fillStyle(0xfbbf24).fillCircle(19, 19, 17).generateTexture("collectible", 38, 38);
    if (!this.textures.exists("hazard")) graphics.clear().fillStyle(0xfb7185).fillTriangle(22, 0, 44, 44, 0, 44).generateTexture("hazard", 44, 44);
    graphics.destroy();
  }

  private themeColor(): string {
    if (spec.theme === "restaurant") return "#431407";
    if (spec.theme === "department-store") return "#172554";
    return "#052e16";
  }

  private startAudio(): void { if (this.cache.audio.exists("bgm") && !this.sound.get("bgm")) this.play("bgm", true); }
  private play(key: string, loop = false): void { if (this.cache.audio.exists(key)) { try { this.sound.play(key, { loop }); } catch {} } }
}

new Phaser.Game({
  type: Phaser.AUTO,
  parent: "game",
  width,
  height,
  backgroundColor: "#052e16",
  physics: { default: "arcade", arcade: { debug: false } },
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  scene: [OrderCollectScene],
});
`;
