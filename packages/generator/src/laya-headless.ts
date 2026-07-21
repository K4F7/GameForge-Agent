import { createHash } from "node:crypto";
import { lstat, open, realpath } from "node:fs/promises";
import path from "node:path";
import { createContext, Script } from "node:vm";
import {
  gameSpecSchema,
  managedGeneratedProjectManifestSchema,
  projectIdSchema,
  type GamePlatformTarget,
  type GameSpec,
  type OrderCollectTelemetry,
} from "@gameforge/contracts";
import { transformSync } from "esbuild";
import { douyinRuntimeSource } from "./douyin-template.js";
import { orderCollectLayaRuntimeSource } from "./order-collect-laya-template.js";
import { GAMEFORGE_GENERATOR_VERSION } from "./generator.js";

type Genre = GameSpec["genre"];
type Telemetry = {
  status: "running" | "won" | "lost";
  genre: Genre;
  score: number;
  lives: number;
  remainingSeconds: number;
  player: { x: number; y: number };
  collectibles: Array<{ x: number; y: number }>;
  hazards: Array<{ x: number; y: number }>;
  simulation?: OrderCollectTelemetry;
};

export type LayaGameplayScenario = {
  name: "genre-win" | "timeout-loss" | "lives-depleted-loss";
  outcome: "won" | "lost";
  actions: number;
  telemetry?: NonNullable<Telemetry["simulation"]>;
};

export type LayaGameplayVerificationReport = {
  projectId: string;
  target: Exclude<GamePlatformTarget, "web">;
  genre: Genre;
  passed: true;
  scenarios: readonly [
    LayaGameplayScenario & { name: "genre-win"; outcome: "won" },
    LayaGameplayScenario & { name: "timeout-loss"; outcome: "lost" },
  ] | readonly [
    LayaGameplayScenario & { name: "genre-win"; outcome: "won" },
    LayaGameplayScenario & { name: "timeout-loss"; outcome: "lost" },
    LayaGameplayScenario & { name: "lives-depleted-loss"; outcome: "lost" },
  ];
  durationMs: number;
  templateSha256: string;
};

class FakeGraphics {
  clear(): void {}
  drawRect(): void {}
  drawCircle(): void {}
  drawTexture(): void {}
}

class FakeNode {
  x = 0;
  y = 0;
  width = 0;
  height = 0;
  parent: FakeNode | undefined;
  readonly children: FakeNode[] = [];
  readonly graphics = new FakeGraphics();
  pos(x: number, y: number): void { this.x = x; this.y = y; }
  addChild<T extends FakeNode>(child: T): T { child.parent = this; this.children.push(child); return child; }
  removeSelf(): this {
    if (this.parent !== undefined) {
      const index = this.parent.children.indexOf(this);
      if (index >= 0) this.parent.children.splice(index, 1);
      this.parent = undefined;
    }
    return this;
  }
}

class FakeSprite extends FakeNode {}
class FakeScene extends FakeSprite {}
class FakeText extends FakeSprite { text = ""; color = ""; fontSize = 0; bold = false; }

type Listener = { caller: object; callback: (event: { key: string }) => void };
class FakeStage extends FakeNode {
  mouseX = 0;
  mouseY = 0;
  readonly #listeners = new Map<string, Listener[]>();
  on(type: string, caller: object, callback: Listener["callback"]): void {
    const listeners = this.#listeners.get(type) ?? [];
    listeners.push({ caller, callback });
    this.#listeners.set(type, listeners);
  }
  emit(type: string, event: { key: string } = { key: "" }): void {
    for (const listener of [...(this.#listeners.get(type) ?? [])]) listener.callback.call(listener.caller, event);
  }
  offAllCaller(caller: object): void {
    for (const [type, listeners] of this.#listeners) {
      this.#listeners.set(type, listeners.filter((listener) => listener.caller !== caller));
    }
  }
}

type TimerJob = { caller: object; callback: () => void; interval: number; elapsed: number };
class FakeTimer {
  currTimer = 0;
  readonly #frameJobs: TimerJob[] = [];
  readonly #loopJobs: TimerJob[] = [];
  frameLoop(_frames: number, caller: object, callback: () => void): void {
    this.#frameJobs.push({ caller, callback, interval: 0, elapsed: 0 });
  }
  loop(interval: number, caller: object, callback: () => void): void {
    this.#loopJobs.push({ caller, callback, interval, elapsed: 0 });
  }
  clearAll(caller: object): void {
    for (const jobs of [this.#frameJobs, this.#loopJobs]) {
      for (let index = jobs.length - 1; index >= 0; index -= 1) {
        if (jobs[index]?.caller === caller) jobs.splice(index, 1);
      }
    }
  }
  advance(milliseconds: number, frameMilliseconds = 16): void {
    let remaining = milliseconds;
    let steps = 0;
    while (remaining > 0) {
      steps += 1;
      if (steps > 2_500) throw new Error("Laya logic verification exceeded its timer step budget.");
      const elapsed = Math.min(frameMilliseconds, remaining);
      remaining -= elapsed;
      this.currTimer += elapsed;
      for (const job of [...this.#frameJobs]) job.callback.call(job.caller);
      for (const job of [...this.#loopJobs]) {
        job.elapsed += elapsed;
        while (job.elapsed >= job.interval) {
          job.elapsed -= job.interval;
          job.callback.call(job.caller);
        }
      }
    }
  }
}

type RuntimeInternals = FakeScene & {
  player: FakeSprite;
  collectibles: FakeSprite[];
  hazards: Array<{ sprite: FakeSprite; vx: number; vy: number }>;
  onAwake(): void;
  onDestroy(): void;
};

type Runtime = {
  scene: RuntimeInternals;
  stage: FakeStage;
  timer: FakeTimer;
  state(): Telemetry;
};

function runtimeSourceFor(spec: GameSpec): string {
  return spec.mechanicProfile === "order-collect" ? orderCollectLayaRuntimeSource : douyinRuntimeSource;
}

export class ManagedLayaGameplayVerifier {
  readonly #projectsRoot: string;
  constructor(options: { projectsRoot: string }) {
    if (!path.isAbsolute(options.projectsRoot) || path.resolve(options.projectsRoot) === path.parse(path.resolve(options.projectsRoot)).root) {
      throw new Error("Gameplay verifier projects root must be an absolute non-root path.");
    }
    this.#projectsRoot = path.resolve(options.projectsRoot);
  }

  async verify(projectIdInput: string): Promise<LayaGameplayVerificationReport> {
    const startedAt = performance.now();
    const projectId = projectIdSchema.parse(projectIdInput);
    const { target, spec } = await readManagedInputs(this.#projectsRoot, projectId);
    const win = await startRuntime(spec);
    let actions = 0;
    let winState: Telemetry | undefined;
    try {
      actions = exerciseGenreWin(win, spec.genre);
      winState = win.state();
      if (winState.status !== "won") throw new Error(`Laya ${spec.genre} win scenario did not reach won telemetry.`);
    } finally {
      win.scene.onDestroy();
    }
    const loss = await startRuntime(spec);
    let lossState: Telemetry | undefined;
    try {
      for (const hazard of loss.scene.hazards) { hazard.sprite.pos(20, 125); hazard.vx = 0; hazard.vy = 0; }
      loss.timer.advance(spec.targetDurationSeconds * 1000, 1_000);
      lossState = loss.state();
      if (lossState.status !== "lost") throw new Error("Laya timeout scenario did not reach lost telemetry.");
    } finally {
      loss.scene.onDestroy();
    }
    const startingLives = spec.gameplay?.startingLives ?? 3;
    let livesState: Telemetry | undefined;
    if (spec.mechanicProfile === "order-collect") {
      const lives = await startRuntime(spec);
      try {
        const hazard = lives.scene.hazards[0];
        if (hazard === undefined) throw new Error("Laya lives-depleted scenario requires one hazard.");
        hazard.vx = 0;
        hazard.vy = 0;
        for (let hit = 0; hit < startingLives; hit += 1) {
          hazard.sprite.pos(lives.scene.player.x, lives.scene.player.y);
          lives.timer.advance(hit === 0 ? 16 : 900, 16);
        }
        livesState = lives.state();
        if (livesState.status !== "lost" || livesState.simulation?.endReason !== "lives-depleted") {
          throw new Error("Laya lives-depleted scenario did not reach the expected terminal telemetry.");
        }
      } finally {
        lives.scene.onDestroy();
      }
    }
    const scenarios: LayaGameplayVerificationReport["scenarios"] = livesState?.simulation === undefined
      ? [
          {
            name: "genre-win", outcome: "won", actions,
            ...(winState?.simulation === undefined ? {} : { telemetry: winState.simulation }),
          },
          {
            name: "timeout-loss", outcome: "lost", actions: 1,
            ...(lossState?.simulation === undefined ? {} : { telemetry: lossState.simulation }),
          },
        ]
      : [
          {
            name: "genre-win", outcome: "won", actions,
            ...(winState?.simulation === undefined ? {} : { telemetry: winState.simulation }),
          },
          {
            name: "timeout-loss", outcome: "lost", actions: 1,
            ...(lossState?.simulation === undefined ? {} : { telemetry: lossState.simulation }),
          },
          { name: "lives-depleted-loss", outcome: "lost", actions: startingLives, telemetry: livesState.simulation },
        ];
    return {
      projectId,
      target,
      genre: spec.genre,
      passed: true,
      scenarios,
      durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
      templateSha256: createHash("sha256").update(runtimeSourceFor(spec), "utf8").digest("hex"),
    };
  }
}

function exerciseGenreWin(runtime: Runtime, genre: Genre): number {
  let actions = 0;
  for (const hazard of runtime.scene.hazards) { hazard.sprite.pos(20, 125); hazard.vx = 0; hazard.vy = 0; }
  if (genre === "puzzle") { runtime.stage.emit("keydown", { key: "ArrowRight" }); actions += 1; }
  if (genre === "platformer") {
    runtime.timer.advance(256);
    runtime.stage.emit("keydown", { key: "ArrowUp" });
    runtime.timer.advance(16);
    actions += 2;
  }
  if (genre === "strategy") { runtime.stage.emit("keydown", { key: "Space" }); actions += 1; }
  if (genre === "shooter" && runtime.scene.hazards.length > 0) {
    for (const hazard of [...runtime.scene.hazards]) {
      hazard.sprite.pos(runtime.scene.player.x + 30, runtime.scene.player.y);
      runtime.stage.emit("keydown", { key: "Space" });
      runtime.timer.advance(16);
      actions += 2;
    }
  } else {
    for (const collectible of [...runtime.scene.collectibles]) {
      collectible.pos(runtime.scene.player.x, runtime.scene.player.y);
      runtime.timer.advance(16);
      actions += 1;
    }
  }
  return actions;
}

async function startRuntime(spec: GameSpec): Promise<Runtime> {
  const stage = new FakeStage();
  const timer = new FakeTimer();
  const telemetryHost: { __GAMEFORGE_TEST__?: Telemetry } = {};
  const laya = {
    Scene: FakeScene, Sprite: FakeSprite, Text: FakeText, stage, timer,
    Event: { KEY_DOWN: "keydown", KEY_UP: "keyup", MOUSE_DOWN: "mousedown", MOUSE_MOVE: "mousemove" },
    Loader: { JSON: "json", IMAGE: "image" },
    loader: { load: async (resource: string): Promise<unknown> => {
      if (resource === "resources/game-spec.json") return spec;
      if (resource === "resources/assets/manifest.json") throw new Error("Assets are optional in the logic verifier.");
      return {};
    } },
    SoundManager: { playMusic(): void {}, playSound(): void {} },
    Browser: { window: telemetryHost },
    regClass: () => <T>(target: T): T => target,
  };
  const source = runtimeSourceFor(spec);
  const transpiled = transformSync(source, {
    loader: "ts", format: "cjs", target: "es2020",
    tsconfigRaw: { compilerOptions: { experimentalDecorators: true } },
  });
  const commonJsModule: { exports: Record<string, unknown> } = { exports: {} };
  const context = createContext({ module: commonJsModule, exports: commonJsModule.exports, Laya: laya, GameGlobal: telemetryHost });
  new Script(transpiled.code, { filename: "generated/Main.js" }).runInContext(context, { timeout: 1_000 });
  const Main = commonJsModule.exports.Main as (new () => RuntimeInternals) | undefined;
  if (Main === undefined) throw new Error("Generated runtime did not export Main.");
  const scene = new Main();
  scene.onAwake();
  for (let attempt = 0; attempt < 10 && telemetryHost.__GAMEFORGE_TEST__ === undefined; attempt += 1) await Promise.resolve();
  if (telemetryHost.__GAMEFORGE_TEST__ === undefined) throw new Error("Generated runtime did not publish initial telemetry.");
  return { scene, stage, timer, state: () => {
    const state = telemetryHost.__GAMEFORGE_TEST__;
    if (state === undefined) throw new Error("Generated runtime telemetry disappeared.");
    return state;
  } };
}

async function readManagedInputs(
  projectsRootInput: string,
  projectId: string,
): Promise<{ target: "douyin-mini-game" | "wechat-mini-game"; spec: GameSpec }> {
  const rootInfo = await lstat(projectsRootInput).catch(() => undefined);
  if (rootInfo === undefined || !rootInfo.isDirectory() || rootInfo.isSymbolicLink()) {
    throw new Error("Gameplay verifier projects root must be a real directory.");
  }
  const root = await realpath(projectsRootInput);
  const projectCandidate = path.resolve(root, projectId);
  if (path.dirname(projectCandidate).toLowerCase() !== root.toLowerCase()) throw new Error("Gameplay project escaped the configured root.");
  const projectInfo = await lstat(projectCandidate).catch(() => undefined);
  if (projectInfo === undefined || !projectInfo.isDirectory() || projectInfo.isSymbolicLink()) {
    throw new Error("Managed gameplay project does not exist or is unsafe.");
  }
  const project = await realpath(projectCandidate);
  if (path.dirname(project).toLowerCase() !== root.toLowerCase()) throw new Error("Gameplay project escaped the configured root.");
  const manifest = managedGeneratedProjectManifestSchema.parse(JSON.parse(
    (await readStableFile(project, ".gameforge/manifest.json", 256 * 1024)).toString("utf8"),
  ) as unknown);
  if (manifest.projectId !== projectId || (manifest.target !== "douyin-mini-game" && manifest.target !== "wechat-mini-game")) {
    throw new Error("Gameplay verification requires a managed Laya mini-game project.");
  }
  if (manifest.generatorVersion !== GAMEFORGE_GENERATOR_VERSION) {
    throw new Error("Managed Laya project generator version is not supported by this verifier.");
  }
  const expectedPlanSha256 = createHash("sha256").update(JSON.stringify({
    target: manifest.target,
    files: manifest.files.map(({ path: filePath, bytes, sha256 }) => ({ path: filePath, bytes, sha256 })),
  })).digest("hex");
  if (expectedPlanSha256 !== manifest.planSha256) throw new Error("Managed Laya project plan hash mismatch.");
  const specEntry = manifest.files.find((entry) => entry.path === "assets/resources/game-spec.json");
  if (specEntry === undefined) throw new Error("Managed Laya GameSpec entry is missing.");
  const specBytes = await readStableFile(project, specEntry.path, specEntry.bytes);
  const specSha256 = createHash("sha256").update(specBytes).digest("hex");
  if (specSha256 !== specEntry.sha256 || specSha256 !== manifest.specSha256) {
    throw new Error("Managed Laya GameSpec hash mismatch.");
  }
  const spec = gameSpecSchema.parse(JSON.parse(specBytes.toString("utf8")) as unknown);
  const expectedRuntimeSource = runtimeSourceFor(spec);
  const expectedTemplateSha256 = createHash("sha256").update(expectedRuntimeSource, "utf8").digest("hex");
  const runtimeEntry = manifest.files.find((entry) => entry.path === "src/Main.ts");
  if (runtimeEntry?.sha256 !== expectedTemplateSha256 || runtimeEntry.bytes !== Buffer.byteLength(expectedRuntimeSource, "utf8")) {
    throw new Error("Managed Laya runtime does not match the verified template.");
  }
  const runtime = await readStableFile(project, "src/Main.ts", runtimeEntry.bytes);
  if (createHash("sha256").update(runtime).digest("hex") !== expectedTemplateSha256) {
    throw new Error("Managed Laya runtime hash mismatch.");
  }
  return { target: manifest.target, spec };
}

async function readStableFile(root: string, relativePath: string, maximumBytes: number): Promise<Buffer> {
  const expected = path.resolve(root, ...relativePath.split("/"));
  const before = await lstat(expected).catch(() => undefined);
  if (before === undefined || !before.isFile() || before.isSymbolicLink() || before.size > maximumBytes) {
    throw new Error(`Managed gameplay file is missing or unsafe: ${relativePath}.`);
  }
  const actual = await realpath(expected);
  if (pathKey(actual) !== pathKey(expected)) throw new Error(`Managed gameplay file escaped the project: ${relativePath}.`);
  const handle = await open(actual, "r");
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino || opened.size !== before.size) {
      throw new Error(`Managed gameplay file changed during verification: ${relativePath}.`);
    }
    return await handle.readFile();
  } finally { await handle.close(); }
}

function pathKey(value: string): string {
  const normalized = path.normalize(value);
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}
