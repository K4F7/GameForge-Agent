export const douyinRuntimeSource = `const { regClass } = Laya;

type GameSpec = {
  title: string;
  objective: string;
  genre: "arcade" | "platformer" | "puzzle" | "shooter" | "strategy";
  targetDurationSeconds: number;
  gameplay?: {
    collectibleCount: number;
    hazardCount: number;
    startingLives: number;
    movementSpeed: number;
  };
};

type RuntimeAssetRole = "player" | "collectible" | "hazard" | "background" | "collect-sound" | "hit-sound" | "voice" | "bgm";
type RuntimeAssetEntry = {
  kind: "image" | "sound" | "voice" | "music";
  role: RuntimeAssetRole;
  path: string;
  mimeType: "image/jpeg" | "image/png" | "image/webp" | "audio/mpeg" | "audio/ogg" | "audio/wav";
};
type VerificationState = {
  status: "running" | "won" | "lost";
  genre: GameSpec["genre"];
  score: number;
  lives: number;
  remainingSeconds: number;
  player: { x: number; y: number };
  collectibles: Array<{ x: number; y: number }>;
  hazards: Array<{ x: number; y: number }>;
};
declare const GameGlobal: { __GAMEFORGE_TEST__?: VerificationState };

@regClass()
export class Main extends Laya.Scene {
  private readonly player = new Laya.Sprite();
  private readonly collectibles: Laya.Sprite[] = [];
  private readonly hazards: Array<{ sprite: Laya.Sprite; vx: number; vy: number }> = [];
  private readonly bullets: Array<{ sprite: Laya.Sprite; vx: number; vy: number; expiresAt: number }> = [];
  private readonly platforms: Array<{ x: number; y: number; width: number }> = [];
  private readonly pressedKeys = new Set<string>();
  private readonly hud = new Laya.Text();
  private score = 0;
  private lives = 3;
  private remainingSeconds = 60;
  private movementSpeed = 220;
  private genre: GameSpec["genre"] = "arcade";
  private ended = false;
  private targetX = 480;
  private targetY = 350;
  private previousFrameMs = 0;
  private invulnerableUntilMs = 0;
  private playerVelocityY = 0;
  private playerGrounded = false;
  private facingX = 1;
  private facingY = 0;
  private strategyAggressive = false;
  private shooterHadHazards = false;
  private readonly runtimeAssets = new Map<RuntimeAssetRole, RuntimeAssetEntry>();
  private readonly textures = new Map<RuntimeAssetRole, Laya.Texture>();
  private audioStarted = false;

  onAwake(): void {
    void this.initialize();
  }

  private async initialize(): Promise<void> {
    const spec = await Laya.loader.load("resources/game-spec.json", Laya.Loader.JSON) as GameSpec;
    await this.loadRuntimeAssets();
    const gameplay = spec.gameplay;
    this.genre = spec.genre;
    const collectibleCount = gameplay?.collectibleCount ?? (this.genre === "strategy" ? 6 : 3);
    const hazardCount = gameplay?.hazardCount ?? (this.genre === "platformer" ? 2 : 3);
    this.lives = gameplay?.startingLives ?? 3;
    this.movementSpeed = gameplay?.movementSpeed ?? (this.genre === "strategy" ? 150 : this.genre === "platformer" ? 210 : 220);
    const targetDurationSeconds = Number(spec.targetDurationSeconds);
    this.remainingSeconds = Number.isFinite(targetDurationSeconds) && targetDurationSeconds > 0
      ? targetDurationSeconds
      : 60;
    this.shooterHadHazards = this.genre === "shooter" && hazardCount > 0;

    this.width = 960;
    this.height = 540;
    const backgroundTexture = this.textures.get("background");
    if (backgroundTexture === undefined) this.graphics.drawRect(0, 0, 960, 540, "#0b1736");
    else {
      const background = new Laya.Sprite();
      background.graphics.drawTexture(backgroundTexture, 0, 0, 960, 540);
      this.addChild(background);
    }
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

    if (this.genre === "platformer") this.createPlatforms();

    this.drawRole(this.player, "player", 32, 32, () => this.player.graphics.drawRect(-16, -16, 32, 32, "#62d5ff"));
    if (this.genre === "platformer") this.player.pos(100, 470);
    else if (this.genre === "puzzle") this.player.pos(96, 192);
    else this.player.pos(480, 350);
    this.targetX = this.player.x;
    this.targetY = this.player.y;
    this.addChild(this.player);
    const collectiblePositions = this.collectiblePositions(collectibleCount);
    for (let index = 0; index < collectibleCount; index += 1) {
      const item = new Laya.Sprite();
      this.drawRole(item, "collectible", 24, 24, () => item.graphics.drawCircle(0, 0, 13, "#ffd35a"));
      const position = collectiblePositions[index] ?? { x: 480, y: 300 };
      item.pos(position.x, position.y);
      this.collectibles.push(item);
      this.addChild(item);
    }
    for (let index = 0; index < hazardCount; index += 1) {
      const hazard = new Laya.Sprite();
      this.drawRole(hazard, "hazard", 32, 32, () => hazard.graphics.drawRect(-15, -15, 30, 30, "#ff657d"));
      const position = this.hazardPosition(index);
      hazard.pos(position.x, position.y);
      const moving = this.genre !== "puzzle";
      this.hazards.push({ sprite: hazard, vx: moving ? 95 + index * 13 : 0, vy: moving && this.genre !== "platformer" ? (index % 2 === 0 ? 72 : -72) : 0 });
      this.addChild(hazard);
    }
    Laya.stage.on(Laya.Event.KEY_DOWN, this, this.onKeyDown);
    Laya.stage.on(Laya.Event.KEY_UP, this, this.onKeyUp);
    Laya.stage.on(Laya.Event.MOUSE_DOWN, this, this.onPointer);
    this.previousFrameMs = Laya.timer.currTimer;
    Laya.timer.frameLoop(1, this, this.updateGame);
    Laya.timer.loop(1000, this, this.tick);
    this.refreshHud();
  }

  private onKeyDown(event: Laya.Event): void {
    this.startAudio();
    const key = event.key.toLowerCase();
    this.pressedKeys.add(key);
    if (this.genre === "puzzle") {
      const step = 48;
      if (key === "arrowleft" || key === "a") this.player.x -= step;
      if (key === "arrowright" || key === "d") this.player.x += step;
      if (key === "arrowup" || key === "w") this.player.y -= step;
      if (key === "arrowdown" || key === "s") this.player.y += step;
      this.player.x = Math.max(48, Math.min(912, Math.round(this.player.x / step) * step));
      this.player.y = Math.max(144, Math.min(480, Math.round(this.player.y / step) * step));
      this.targetX = this.player.x;
      this.targetY = this.player.y;
      return;
    }
    if (this.genre === "platformer" && (key === "arrowup" || key === "w") && this.playerGrounded) {
      this.playerVelocityY = -440;
      this.playerGrounded = false;
    }
    if (key === " " || key === "space") {
      if (this.genre === "shooter") this.fireBullet();
      if (this.genre === "strategy") this.strategyAggressive = !this.strategyAggressive;
    }
    const step = Math.max(18, this.movementSpeed * 0.12);
    if (key === "arrowleft" || key === "a") { this.targetX -= step; this.facingX = -1; this.facingY = 0; }
    if (key === "arrowright" || key === "d") { this.targetX += step; this.facingX = 1; this.facingY = 0; }
    if (key === "arrowup" || key === "w") { this.targetY -= step; this.facingX = 0; this.facingY = -1; }
    if (key === "arrowdown" || key === "s") { this.targetY += step; this.facingX = 0; this.facingY = 1; }
  }

  private onKeyUp(event: Laya.Event): void {
    this.pressedKeys.delete(event.key.toLowerCase());
  }

  private onPointer(): void {
    this.startAudio();
    this.targetX = Laya.stage.mouseX;
    this.targetY = Laya.stage.mouseY;
    if (this.genre === "platformer" && this.playerGrounded && this.targetY < this.player.y - 24) {
      this.playerVelocityY = -440;
      this.playerGrounded = false;
    }
  }

  private updateGame(): void {
    if (this.ended) return;
    const now = Laya.timer.currTimer;
    const deltaSeconds = Math.min(0.05, Math.max(0, (now - this.previousFrameMs) / 1000));
    this.previousFrameMs = now;
    if (this.genre === "platformer") this.updatePlatformer(deltaSeconds);
    else if (this.genre !== "puzzle") this.updateTargetMovement(deltaSeconds);
    this.updateBullets(deltaSeconds, now);
    if (this.ended) { this.refreshHud(); return; }
    for (const item of [...this.collectibles]) {
      if (this.distanceSquared(item, this.player) <= 32 * 32) {
        item.removeSelf();
        this.collectibles.splice(this.collectibles.indexOf(item), 1);
        this.score += 1;
        this.playEffect("collect-sound");
        if (this.collectibles.length === 0 && !this.shooterHadHazards) this.finish("YOU WIN", "#7dff9a");
      }
    }
    for (const hazard of [...this.hazards]) {
      hazard.sprite.x += hazard.vx * deltaSeconds;
      hazard.sprite.y += hazard.vy * deltaSeconds;
      if (hazard.sprite.x < 18 || hazard.sprite.x > 942) hazard.vx *= -1;
      if (this.genre !== "platformer" && (hazard.sprite.y < 125 || hazard.sprite.y > 522)) hazard.vy *= -1;
      if (now >= this.invulnerableUntilMs && this.distanceSquared(hazard.sprite, this.player) <= 31 * 31) {
        this.lives -= this.genre === "strategy" && this.strategyAggressive ? 2 : 1;
        this.playEffect("hit-sound");
        this.invulnerableUntilMs = now + 1000;
        this.resetPlayer();
        if (this.lives <= 0) this.finish("GAME OVER", "#ff7d91");
      }
    }
    this.refreshHud();
  }

  private updateTargetMovement(deltaSeconds: number): void {
    this.targetX = Math.max(18, Math.min(942, this.targetX));
    this.targetY = Math.max(125, Math.min(522, this.targetY));
    const dx = this.targetX - this.player.x;
    const dy = this.targetY - this.player.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    if (distance <= 1) return;
    const strategyFactor = this.genre === "strategy" ? (this.strategyAggressive ? 1.35 : 0.72) : 1;
    const travel = Math.min(distance, this.movementSpeed * strategyFactor * deltaSeconds);
    this.player.x += (dx / distance) * travel;
    this.player.y += (dy / distance) * travel;
  }

  private updatePlatformer(deltaSeconds: number): void {
    let horizontal = 0;
    if (this.pressedKeys.has("arrowleft") || this.pressedKeys.has("a")) horizontal -= 1;
    if (this.pressedKeys.has("arrowright") || this.pressedKeys.has("d")) horizontal += 1;
    if (horizontal === 0) horizontal = Math.abs(this.targetX - this.player.x) > 8 ? Math.sign(this.targetX - this.player.x) : 0;
    this.player.x = Math.max(16, Math.min(944, this.player.x + horizontal * this.movementSpeed * deltaSeconds));
    const previousBottom = this.player.y + 16;
    this.playerVelocityY = Math.min(720, this.playerVelocityY + 900 * deltaSeconds);
    let nextY = this.player.y + this.playerVelocityY * deltaSeconds;
    this.playerGrounded = false;
    if (this.playerVelocityY >= 0) {
      for (const platform of this.platforms) {
        const nextBottom = nextY + 16;
        const withinX = this.player.x + 13 >= platform.x - platform.width / 2 && this.player.x - 13 <= platform.x + platform.width / 2;
        if (withinX && previousBottom <= platform.y && nextBottom >= platform.y) {
          nextY = platform.y - 16;
          this.playerVelocityY = 0;
          this.playerGrounded = true;
          break;
        }
      }
    }
    this.player.y = nextY;
    if (this.player.y > 570) {
      this.lives -= 1;
      this.resetPlayer();
      if (this.lives <= 0) this.finish("GAME OVER", "#ff7d91");
    }
  }

  private updateBullets(deltaSeconds: number, now: number): void {
    for (const bullet of [...this.bullets]) {
      bullet.sprite.x += bullet.vx * deltaSeconds;
      bullet.sprite.y += bullet.vy * deltaSeconds;
      let consumed = now >= bullet.expiresAt || bullet.sprite.x < 0 || bullet.sprite.x > 960 || bullet.sprite.y < 110 || bullet.sprite.y > 540;
      if (!consumed) {
        const hit = this.hazards.find((hazard) => this.distanceSquared(hazard.sprite, bullet.sprite) <= 24 * 24);
        if (hit !== undefined) {
          hit.sprite.removeSelf();
          this.hazards.splice(this.hazards.indexOf(hit), 1);
          this.score += 1;
          consumed = true;
          if (this.shooterHadHazards && this.hazards.length === 0) this.finish("YOU WIN", "#7dff9a");
        }
      }
      if (consumed) {
        bullet.sprite.removeSelf();
        this.bullets.splice(this.bullets.indexOf(bullet), 1);
      }
    }
  }

  private fireBullet(): void {
    if (this.ended) return;
    const bullet = new Laya.Sprite();
    bullet.graphics.drawCircle(0, 0, 5, "#f8fafc");
    bullet.pos(this.player.x, this.player.y);
    this.addChild(bullet);
    this.bullets.push({
      sprite: bullet,
      vx: this.facingX * 520,
      vy: this.facingY * 520,
      expiresAt: Laya.timer.currTimer + 1400,
    });
  }

  private createPlatforms(): void {
    const definitions = [
      { x: 480, y: 510, width: 960 },
      { x: 230, y: 410, width: 160 },
      { x: 500, y: 340, width: 160 },
      { x: 760, y: 420, width: 160 },
    ];
    for (const platform of definitions) {
      const sprite = new Laya.Sprite();
      sprite.graphics.drawRect(-platform.width / 2, 0, platform.width, 18, "#7459a8");
      sprite.pos(platform.x, platform.y);
      this.addChild(sprite);
      this.platforms.push(platform);
    }
  }

  private collectiblePositions(count: number): Array<{ x: number; y: number }> {
    if (this.genre === "platformer") {
      const positions = [{ x: 230, y: 380 }, { x: 500, y: 310 }, { x: 760, y: 390 }, { x: 620, y: 480 }, { x: 870, y: 480 }];
      return Array.from({ length: count }, (_value, index) => positions[index] ?? { x: 120 + (index % 8) * 100, y: 480 });
    }
    if (this.genre === "puzzle") {
      return Array.from({ length: count }, (_value, index) => ({ x: 192 + (index % 6) * 96, y: 192 + Math.floor(index / 6) * 96 }));
    }
    return Array.from({ length: count }, (_value, index) => {
      const angle = (Math.PI * 2 * index) / Math.max(1, count);
      return { x: 480 + Math.cos(angle) * 270, y: 320 + Math.sin(angle) * 150 };
    });
  }

  private hazardPosition(index: number): { x: number; y: number } {
    if (this.genre === "platformer") return { x: 320 + index * 210, y: 478 };
    if (this.genre === "puzzle") return { x: 336 + (index % 4) * 144, y: 240 + Math.floor(index / 4) * 144 };
    return { x: 240 + index * 170, y: 190 + (index % 2) * 210 };
  }

  private resetPlayer(): void {
    if (this.genre === "platformer") {
      this.player.pos(100, 470);
      this.playerVelocityY = 0;
    } else if (this.genre === "puzzle") this.player.pos(96, 192);
    else this.player.pos(480, 350);
    this.targetX = this.player.x;
    this.targetY = this.player.y;
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
    this.publishState(message === "YOU WIN" ? "won" : "lost");
  }

  private refreshHud(): void {
    let controls = "Tap or arrow keys";
    if (this.genre === "platformer") controls = "Left/right to move · Up/tap above to jump";
    if (this.genre === "puzzle") controls = "Arrow keys move one grid cell";
    if (this.genre === "shooter") controls = "Arrow keys aim · Space fires";
    if (this.genre === "strategy") controls = "Arrows command · Space: " + (this.strategyAggressive ? "surge (2x damage)" : "cautious");
    this.hud.text = "Score " + this.score + " · Remaining " + this.collectibles.length + " · Lives " + this.lives + " · " + this.remainingSeconds + "s · " + controls;
    if (!this.ended) this.publishState("running");
  }

  private publishState(status: VerificationState["status"]): void {
    const point = (sprite: Laya.Sprite): { x: number; y: number } => ({
      x: Math.round(sprite.x * 100) / 100,
      y: Math.round(sprite.y * 100) / 100,
    });
    const telemetryHost = typeof GameGlobal !== "undefined"
      ? GameGlobal
      : Laya.Browser.window as unknown as { __GAMEFORGE_TEST__?: VerificationState };
    telemetryHost.__GAMEFORGE_TEST__ = {
      status,
      genre: this.genre,
      score: this.score,
      lives: this.lives,
      remainingSeconds: this.remainingSeconds,
      player: point(this.player),
      collectibles: this.collectibles.map(point),
      hazards: this.hazards.map((hazard) => point(hazard.sprite)),
    };
  }

  private async loadRuntimeAssets(): Promise<void> {
    let manifest: unknown;
    try {
      manifest = await Laya.loader.load("resources/assets/manifest.json", Laya.Loader.JSON) as unknown;
    } catch {
      return;
    }
    for (const entry of this.parseRuntimeAssets(manifest)) this.runtimeAssets.set(entry.role, entry);
    const imageRoles: RuntimeAssetRole[] = ["player", "collectible", "hazard", "background"];
    await Promise.all(imageRoles.map(async (role) => {
      const entry = this.runtimeAssets.get(role);
      if (entry === undefined) return;
      try {
        const texture = await Laya.loader.load(this.resourceUrl(entry.path), Laya.Loader.IMAGE) as Laya.Texture;
        if (texture !== null) this.textures.set(role, texture);
      } catch {
        this.runtimeAssets.delete(role);
      }
    }));
  }

  private parseRuntimeAssets(value: unknown): RuntimeAssetEntry[] {
    if (!this.isRecord(value) || value.schemaVersion !== "1.0" || !Array.isArray(value.assets) || value.assets.length > 1000) return [];
    const result: RuntimeAssetEntry[] = [];
    const roles = new Set<RuntimeAssetRole>();
    for (const candidate of value.assets) {
      if (!this.isRecord(candidate) || !this.isRuntimeRole(candidate.role) || roles.has(candidate.role)) continue;
      if (typeof candidate.path !== "string" || !new RegExp("^assets/[a-z0-9][a-z0-9._-]*(?:/[a-z0-9][a-z0-9._-]*)*$").test(candidate.path)) continue;
      if (!this.isRuntimeMime(candidate.mimeType) || !this.isRuntimeKind(candidate.kind)) continue;
      const imageRole = candidate.role === "player" || candidate.role === "collectible" || candidate.role === "hazard" || candidate.role === "background";
      const imageMime = candidate.mimeType.startsWith("image/");
      if (imageRole !== imageMime || imageMime !== (candidate.kind === "image")) continue;
      if (candidate.role === "voice" && candidate.kind !== "voice") continue;
      if (candidate.role === "bgm" && candidate.kind !== "music") continue;
      if ((candidate.role === "collect-sound" || candidate.role === "hit-sound") && candidate.kind !== "sound") continue;
      roles.add(candidate.role);
      result.push({ kind: candidate.kind, role: candidate.role, path: candidate.path, mimeType: candidate.mimeType });
    }
    return result;
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }

  private isRuntimeRole(value: unknown): value is RuntimeAssetRole {
    return typeof value === "string" && ["player", "collectible", "hazard", "background", "collect-sound", "hit-sound", "voice", "bgm"].includes(value);
  }

  private isRuntimeMime(value: unknown): value is RuntimeAssetEntry["mimeType"] {
    return typeof value === "string" && ["image/jpeg", "image/png", "image/webp", "audio/mpeg", "audio/ogg", "audio/wav"].includes(value);
  }

  private isRuntimeKind(value: unknown): value is RuntimeAssetEntry["kind"] {
    return typeof value === "string" && ["image", "sound", "voice", "music"].includes(value);
  }

  private resourceUrl(assetPath: string): string {
    return "resources/" + assetPath;
  }

  private drawRole(sprite: Laya.Sprite, role: RuntimeAssetRole, width: number, height: number, fallback: () => void): void {
    const texture = this.textures.get(role);
    if (texture === undefined) fallback();
    else sprite.graphics.drawTexture(texture, -width / 2, -height / 2, width, height);
  }

  private startAudio(): void {
    if (this.audioStarted) return;
    this.audioStarted = true;
    const bgm = this.runtimeAssets.get("bgm");
    const voice = this.runtimeAssets.get("voice");
    try {
      if (bgm !== undefined) Laya.SoundManager.playMusic(this.resourceUrl(bgm.path), 0);
      if (voice !== undefined) Laya.SoundManager.playSound(this.resourceUrl(voice.path), 1);
    } catch {
      // Audio is optional; gameplay remains functional when decoding is unavailable.
    }
  }

  private playEffect(role: "collect-sound" | "hit-sound"): void {
    const entry = this.runtimeAssets.get(role);
    if (entry === undefined) return;
    try {
      Laya.SoundManager.playSound(this.resourceUrl(entry.path), 1);
    } catch {
      // Sound effects degrade to silence.
    }
  }

  onDestroy(): void {
    Laya.stage.offAllCaller(this);
    Laya.timer.clearAll(this);
  }
}
`;
