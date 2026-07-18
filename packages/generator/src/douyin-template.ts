export const douyinRuntimeSource = `const { regClass } = Laya;

type GameSpec = {
  title: string;
  objective: string;
  gameplay?: {
    collectibleCount: number;
    hazardCount: number;
    startingLives: number;
    movementSpeed: number;
  };
};

@regClass()
export class Main extends Laya.Scene {
  private readonly player = new Laya.Sprite();
  private readonly collectibles: Laya.Sprite[] = [];
  private readonly hazards: Array<{ sprite: Laya.Sprite; vx: number; vy: number }> = [];
  private readonly hud = new Laya.Text();
  private score = 0;
  private lives = 3;
  private remainingSeconds = 60;
  private movementSpeed = 220;
  private ended = false;
  private targetX = 480;
  private targetY = 350;
  private previousFrameMs = 0;
  private invulnerableUntilMs = 0;

  onAwake(): void {
    void this.initialize();
  }

  private async initialize(): Promise<void> {
    const spec = await Laya.loader.load("resources/game-spec.json", Laya.Loader.JSON) as GameSpec;
    const gameplay = spec.gameplay;
    const collectibleCount = gameplay?.collectibleCount ?? 3;
    const hazardCount = gameplay?.hazardCount ?? 2;
    this.lives = gameplay?.startingLives ?? 3;
    this.movementSpeed = gameplay?.movementSpeed ?? 220;

    this.width = 960;
    this.height = 540;
    this.graphics.drawRect(0, 0, 960, 540, "#0b1736");
    const title = new Laya.Text();
    title.text = spec.title;
    title.color = "#ffffff";
    title.fontSize = 28;
    title.pos(28, 20);
    this.addChild(title);
    const objective = new Laya.Text();
    objective.text = spec.objective;
    objective.color = "#91b8e8";
    objective.fontSize = 16;
    objective.pos(28, 58);
    this.addChild(objective);
    this.hud.color = "#d7e9ff";
    this.hud.fontSize = 18;
    this.hud.pos(28, 88);
    this.addChild(this.hud);

    this.player.graphics.drawRect(-16, -16, 32, 32, "#62d5ff");
    this.player.pos(480, 350);
    this.addChild(this.player);
    for (let index = 0; index < collectibleCount; index += 1) {
      const angle = (Math.PI * 2 * index) / Math.max(1, collectibleCount);
      const item = new Laya.Sprite();
      item.graphics.drawCircle(0, 0, 13, "#ffd35a");
      item.pos(480 + Math.cos(angle) * 270, 320 + Math.sin(angle) * 150);
      this.collectibles.push(item);
      this.addChild(item);
    }
    for (let index = 0; index < hazardCount; index += 1) {
      const hazard = new Laya.Sprite();
      hazard.graphics.drawRect(-15, -15, 30, 30, "#ff657d");
      hazard.pos(240 + index * 170, 190 + (index % 2) * 210);
      this.hazards.push({ sprite: hazard, vx: 95 + index * 13, vy: index % 2 === 0 ? 72 : -72 });
      this.addChild(hazard);
    }
    Laya.stage.on(Laya.Event.KEY_DOWN, this, this.onKeyDown);
    Laya.stage.on(Laya.Event.MOUSE_DOWN, this, this.onPointer);
    this.previousFrameMs = Laya.timer.currTimer;
    Laya.timer.frameLoop(1, this, this.updateGame);
    Laya.timer.loop(1000, this, this.tick);
    this.refreshHud();
  }

  private onKeyDown(event: Laya.Event): void {
    const step = Math.max(18, this.movementSpeed * 0.12);
    if (event.key === "ArrowLeft" || event.key === "a") this.targetX -= step;
    if (event.key === "ArrowRight" || event.key === "d") this.targetX += step;
    if (event.key === "ArrowUp" || event.key === "w") this.targetY -= step;
    if (event.key === "ArrowDown" || event.key === "s") this.targetY += step;
  }

  private onPointer(): void {
    this.targetX = Laya.stage.mouseX;
    this.targetY = Laya.stage.mouseY;
  }

  private updateGame(): void {
    if (this.ended) return;
    const now = Laya.timer.currTimer;
    const deltaSeconds = Math.min(0.05, Math.max(0, (now - this.previousFrameMs) / 1000));
    this.previousFrameMs = now;
    this.targetX = Math.max(18, Math.min(942, this.targetX));
    this.targetY = Math.max(125, Math.min(522, this.targetY));
    const dx = this.targetX - this.player.x;
    const dy = this.targetY - this.player.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    if (distance > 1) {
      const travel = Math.min(distance, this.movementSpeed * deltaSeconds);
      this.player.x += (dx / distance) * travel;
      this.player.y += (dy / distance) * travel;
    }
    for (const item of [...this.collectibles]) {
      if (this.distanceSquared(item, this.player) <= 32 * 32) {
        item.removeSelf();
        this.collectibles.splice(this.collectibles.indexOf(item), 1);
        this.score += 1;
        if (this.collectibles.length === 0) this.finish("YOU WIN", "#7dff9a");
      }
    }
    for (const hazard of this.hazards) {
      hazard.sprite.x += hazard.vx * deltaSeconds;
      hazard.sprite.y += hazard.vy * deltaSeconds;
      if (hazard.sprite.x < 18 || hazard.sprite.x > 942) hazard.vx *= -1;
      if (hazard.sprite.y < 125 || hazard.sprite.y > 522) hazard.vy *= -1;
      if (now >= this.invulnerableUntilMs && this.distanceSquared(hazard.sprite, this.player) <= 31 * 31) {
        this.lives -= 1;
        this.invulnerableUntilMs = now + 1000;
        this.player.pos(480, 350);
        this.targetX = 480;
        this.targetY = 350;
        if (this.lives <= 0) this.finish("GAME OVER", "#ff7d91");
      }
    }
    this.refreshHud();
  }

  private distanceSquared(left: Laya.Sprite, right: Laya.Sprite): number {
    const dx = left.x - right.x;
    const dy = left.y - right.y;
    return dx * dx + dy * dy;
  }

  private tick(): void {
    if (this.ended) return;
    this.remainingSeconds -= 1;
    if (this.remainingSeconds <= 0) this.finish("TIME UP", "#ff7d91");
    this.refreshHud();
  }

  private finish(message: string, color: string): void {
    this.ended = true;
    const result = new Laya.Text();
    result.text = message;
    result.color = color;
    result.fontSize = 52;
    result.bold = true;
    result.pos(350, 250);
    this.addChild(result);
  }

  private refreshHud(): void {
    this.hud.text = "Score " + this.score + " · Remaining " + this.collectibles.length + " · Lives " + this.lives + " · " + this.remainingSeconds + "s · Tap or arrow keys";
  }

  onDestroy(): void {
    Laya.stage.offAllCaller(this);
    Laya.timer.clearAll(this);
  }
}
`;
