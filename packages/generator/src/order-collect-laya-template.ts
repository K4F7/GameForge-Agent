import { orderCollectSimulationSource } from "@gameforge/simulation-core";

export const orderCollectLayaRuntimeSource = String.raw`const { regClass } = Laya;
type OrderCollectSpec = {
  title: string;
  objective: string;
  genre: "arcade";
  mechanicProfile: "order-collect";
  theme: "garden" | "restaurant" | "department-store";
  randomSeed: number;
  targetDurationSeconds: 75;
  winCondition: string;
  loseCondition: string;
  gameplay: { collectibleCount: 6; hazardCount: 3; startingLives: 3; movementSpeed: number };
};
type VerificationState = {
  status: "running" | "won" | "lost";
  genre: "arcade";
  score: number;
  lives: number;
  remainingSeconds: number;
  player: SimulationPoint;
  collectibles: SimulationPoint[];
  hazards: SimulationPoint[];
  simulation: OrderCollectTelemetry;
};
declare const GameGlobal: { __GAMEFORGE_TEST__?: VerificationState };
` + orderCollectSimulationSource + String.raw`

@regClass()
export class Main extends Laya.Scene {
  private readonly player = new Laya.Sprite();
  private readonly collectibles: Laya.Sprite[] = [];
  private readonly collectibleIds = new Map<Laya.Sprite, string>();
  private readonly hazards: Array<{ sprite: Laya.Sprite; vx: number; vy: number; id: string }> = [];
  private readonly hud = new Laya.Text();
  private readonly overlays: Laya.Sprite[] = [];
  private simulation?: OrderCollectSimulation;
  private spec?: OrderCollectSpec;
  private targetX = 270;
  private targetY = 690;
  private previousFrameMs = 0;
  private invulnerableUntilMs = 0;
  private ended = false;

  onAwake(): void { void this.initialize(); }

  private async initialize(): Promise<void> {
    this.spec = await Laya.loader.load("resources/game-spec.json", Laya.Loader.JSON) as OrderCollectSpec;
    this.width = 540;
    this.height = 960;
    this.graphics.drawRect(0, 0, 540, 960, this.themeColor());
    const title = new Laya.Text();
    title.text = this.spec.title;
    title.color = "#ffffff";
    title.fontSize = 34;
    title.pos(24, 24);
    this.addChild(title);
    const objective = new Laya.Text();
    objective.text = this.spec.objective;
    objective.color = "#dbeafe";
    objective.fontSize = 18;
    objective.pos(24, 78);
    this.addChild(objective);
    this.hud.color = "#fde68a";
    this.hud.fontSize = 22;
    this.hud.pos(24, 132);
    this.addChild(this.hud);
    this.resetGame();
    Laya.stage.on(Laya.Event.KEY_DOWN, this, this.onKeyDown);
    Laya.stage.on(Laya.Event.MOUSE_DOWN, this, this.onPointer);
    Laya.stage.on(Laya.Event.MOUSE_MOVE, this, this.onPointerMove);
    this.previousFrameMs = Laya.timer.currTimer;
    Laya.timer.frameLoop(1, this, this.updateGame);
  }

  private resetGame(): void {
    const spec = this.requiredSpec();
    for (const collectible of this.collectibles.splice(0)) collectible.removeSelf();
    for (const hazard of this.hazards.splice(0)) hazard.sprite.removeSelf();
    for (const overlay of this.overlays.splice(0)) overlay.removeSelf();
    this.collectibleIds.clear();
    this.player.removeSelf();
    this.simulation = new OrderCollectSimulation({
      randomSeed: spec.randomSeed,
      durationSeconds: 75,
      startingLives: 3,
      collectibleCount: 6,
      hazardCount: 3,
      width: 540,
      height: 960,
    });
    const snapshot = this.simulation.snapshot();
    this.player.graphics.clear();
    this.player.graphics.drawRect(-23, -23, 46, 46, "#22d3ee");
    this.player.pos(snapshot.player.x, snapshot.player.y);
    this.addChild(this.player);
    for (const entity of snapshot.collectibles) {
      const item = new Laya.Sprite();
      item.graphics.drawCircle(0, 0, 19, "#fbbf24");
      item.pos(entity.position.x, entity.position.y);
      this.collectibleIds.set(item, entity.id);
      this.collectibles.push(item);
      this.addChild(item);
    }
    for (const entity of snapshot.hazards) {
      const hazard = new Laya.Sprite();
      hazard.graphics.drawRect(-22, -22, 44, 44, "#fb7185");
      hazard.pos(entity.position.x, entity.position.y);
      this.hazards.push({ sprite: hazard, vx: 0, vy: 0, id: entity.id });
      this.addChild(hazard);
    }
    this.targetX = snapshot.player.x;
    this.targetY = snapshot.player.y;
    this.invulnerableUntilMs = 0;
    this.previousFrameMs = Laya.timer.currTimer;
    this.ended = false;
    this.publish(snapshot);
  }

  private onKeyDown(event: Laya.Event): void {
    const key = event.key.toLowerCase();
    if (this.ended && key === "r") { this.resetGame(); return; }
    if (this.ended) return;
    const step = Math.max(24, this.requiredSpec().gameplay.movementSpeed * 0.15);
    if (key === "arrowleft" || key === "a") this.targetX -= step;
    if (key === "arrowright" || key === "d") this.targetX += step;
    if (key === "arrowup" || key === "w") this.targetY -= step;
    if (key === "arrowdown" || key === "s") this.targetY += step;
  }

  private onPointer(): void {
    if (this.ended) { this.resetGame(); return; }
    this.targetX = Laya.stage.mouseX;
    this.targetY = Laya.stage.mouseY;
  }

  private onPointerMove(): void {
    if (this.ended) return;
    this.targetX = Laya.stage.mouseX;
    this.targetY = Laya.stage.mouseY;
  }

  private updateGame(): void {
    if (this.ended) return;
    const simulation = this.requiredSimulation();
    const now = Laya.timer.currTimer;
    const deltaMs = Math.max(0, now - this.previousFrameMs);
    const movementDeltaMs = Math.min(50, deltaMs);
    this.previousFrameMs = now;
    simulation.advance(deltaMs);
    const current = simulation.snapshot().player;
    const dx = this.targetX - current.x;
    const dy = this.targetY - current.y;
    const distance = Math.hypot(dx, dy);
    if (distance > 0) {
      const travel = Math.min(distance, this.requiredSpec().gameplay.movementSpeed * movementDeltaMs / 1000);
      simulation.movePlayer({ x: current.x + dx / distance * travel, y: current.y + dy / distance * travel });
    }
    let snapshot = simulation.snapshot();
    this.player.pos(snapshot.player.x, snapshot.player.y);
    for (const item of [...this.collectibles]) {
      if (this.distanceSquared(item, this.player) <= 34 * 34) {
        const id = this.collectibleIds.get(item);
        if (id !== undefined) simulation.collect(id);
        item.removeSelf();
        this.collectibles.splice(this.collectibles.indexOf(item), 1);
        this.collectibleIds.delete(item);
      }
    }
    if (now >= this.invulnerableUntilMs) {
      const hazard = this.hazards.find((candidate) => this.distanceSquared(candidate.sprite, this.player) <= 36 * 36);
      if (hazard !== undefined) {
        simulation.hitHazard(hazard.id);
        simulation.movePlayer({ x: 270, y: 691.2 });
        this.targetX = 270;
        this.targetY = 691.2;
        this.invulnerableUntilMs = now + 900;
      }
    }
    snapshot = simulation.snapshot();
    this.player.pos(snapshot.player.x, snapshot.player.y);
    this.publish(snapshot);
    if (snapshot.result !== "running") this.finish(snapshot);
  }

  private finish(snapshot: OrderCollectTelemetry): void {
    if (this.ended) return;
    this.ended = true;
    const panel = new Laya.Sprite();
    panel.graphics.drawRect(35, 350, 470, 250, "#020617");
    this.addChild(panel);
    this.overlays.push(panel);
    const result = new Laya.Text();
    result.text = snapshot.result === "won" ? "订单完成" : "冲刺失败";
    result.color = snapshot.result === "won" ? "#6ee7b7" : "#fda4af";
    result.fontSize = 46;
    result.bold = true;
    result.pos(155, 405);
    this.addChild(result);
    this.overlays.push(result);
    const restart = new Laya.Text();
    restart.text = "点击或按 R 立即重开";
    restart.color = "#cbd5e1";
    restart.fontSize = 20;
    restart.pos(155, 520);
    this.addChild(restart);
    this.overlays.push(restart);
    this.publish(snapshot);
  }

  private publish(snapshot: OrderCollectTelemetry): void {
    this.hud.text = "订单 " + snapshot.order.collected + "/" + snapshot.order.total + " · 生命 " + snapshot.lives + " · " + Math.ceil(snapshot.remainingMs / 1000) + "s";
    const host = typeof GameGlobal !== "undefined" ? GameGlobal : Laya.Browser.window as { __GAMEFORGE_TEST__?: VerificationState };
    host.__GAMEFORGE_TEST__ = {
      status: snapshot.result,
      genre: "arcade",
      score: snapshot.score,
      lives: snapshot.lives,
      remainingSeconds: snapshot.remainingMs / 1000,
      player: snapshot.player,
      collectibles: snapshot.collectibles.map((entity) => entity.position),
      hazards: snapshot.hazards.map((entity) => entity.position),
      simulation: snapshot,
    };
  }

  private distanceSquared(left: Laya.Sprite, right: Laya.Sprite): number {
    const dx = left.x - right.x;
    const dy = left.y - right.y;
    return dx * dx + dy * dy;
  }
  private themeColor(): string {
    if (this.spec?.theme === "restaurant") return "#431407";
    if (this.spec?.theme === "department-store") return "#172554";
    return "#052e16";
  }
  private requiredSpec(): OrderCollectSpec { if (this.spec === undefined) throw new Error("GameSpec is unavailable."); return this.spec; }
  private requiredSimulation(): OrderCollectSimulation { if (this.simulation === undefined) throw new Error("SimulationCore is unavailable."); return this.simulation; }
  onDestroy(): void { Laya.stage.offAllCaller(this); Laya.timer.clearAll(this); }
}
`;
