import { createContext, Script } from "node:vm";
import { transformSync } from "esbuild";
import { afterEach, describe, expect, it } from "vitest";
import { douyinRuntimeSource } from "./douyin-template.js";

type Genre = "arcade" | "platformer" | "puzzle" | "shooter" | "strategy";
type TestSpec = {
  title: string;
  objective: string;
  genre: Genre;
  targetDurationSeconds: number;
  gameplay: { collectibleCount: number; hazardCount: number; startingLives: number; movementSpeed: number };
};
type Telemetry = {
  status: "running" | "won" | "lost";
  genre: Genre;
  score: number;
  lives: number;
  player: { x: number; y: number };
  collectibles: Array<{ x: number; y: number }>;
  hazards: Array<{ x: number; y: number }>;
};

class FakeGraphics {
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
  addChild<T extends FakeNode>(child: T): T {
    child.parent = this;
    this.children.push(child);
    return child;
  }
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
class FakeText extends FakeSprite {
  text = "";
  color = "";
  fontSize = 0;
  bold = false;
}

type Listener = { caller: object; callback: (event: { key: string }) => void };
class FakeStage extends FakeNode {
  mouseX = 0;
  mouseY = 0;
  private readonly listeners = new Map<string, Listener[]>();

  on(type: string, caller: object, callback: Listener["callback"]): void {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push({ caller, callback });
    this.listeners.set(type, listeners);
  }
  emit(type: string, event: { key: string } = { key: "" }): void {
    for (const listener of [...(this.listeners.get(type) ?? [])]) listener.callback.call(listener.caller, event);
  }
  offAllCaller(caller: object): void {
    for (const [type, listeners] of this.listeners) {
      this.listeners.set(type, listeners.filter((listener) => listener.caller !== caller));
    }
  }
}

type TimerJob = { caller: object; callback: () => void; interval: number; elapsed: number };
class FakeTimer {
  currTimer = 0;
  private readonly frameJobs: TimerJob[] = [];
  private readonly loopJobs: TimerJob[] = [];

  frameLoop(_frames: number, caller: object, callback: () => void): void {
    this.frameJobs.push({ caller, callback, interval: 0, elapsed: 0 });
  }
  loop(interval: number, caller: object, callback: () => void): void {
    this.loopJobs.push({ caller, callback, interval, elapsed: 0 });
  }
  clearAll(caller: object): void {
    this.removeCaller(this.frameJobs, caller);
    this.removeCaller(this.loopJobs, caller);
  }
  advance(milliseconds: number, frameMilliseconds = 16): void {
    let remaining = milliseconds;
    while (remaining > 0) {
      const elapsed = Math.min(frameMilliseconds, remaining);
      remaining -= elapsed;
      this.currTimer += elapsed;
      for (const job of [...this.frameJobs]) job.callback.call(job.caller);
      for (const job of [...this.loopJobs]) {
        job.elapsed += elapsed;
        while (job.elapsed >= job.interval) {
          job.elapsed -= job.interval;
          job.callback.call(job.caller);
        }
      }
    }
  }
  private removeCaller(jobs: TimerJob[], caller: object): void {
    for (let index = jobs.length - 1; index >= 0; index -= 1) {
      if (jobs[index]?.caller === caller) jobs.splice(index, 1);
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

const activeScenes: RuntimeInternals[] = [];

afterEach(() => {
  for (const scene of activeScenes.splice(0)) scene.onDestroy();
});

async function startRuntime(spec: TestSpec): Promise<{
  scene: RuntimeInternals;
  stage: FakeStage;
  timer: FakeTimer;
  state(): Telemetry;
}> {
  const stage = new FakeStage();
  const timer = new FakeTimer();
  const telemetryHost: { __GAMEFORGE_TEST__?: Telemetry } = {};
  const laya = {
    Scene: FakeScene,
    Sprite: FakeSprite,
    Text: FakeText,
    stage,
    timer,
    Event: { KEY_DOWN: "keydown", KEY_UP: "keyup", MOUSE_DOWN: "mousedown" },
    Loader: { JSON: "json", IMAGE: "image" },
    loader: {
      load: async (resource: string): Promise<unknown> => {
        if (resource === "resources/game-spec.json") return spec;
        if (resource === "resources/assets/manifest.json") throw new Error("No assets in logic harness");
        return {};
      },
    },
    SoundManager: { playMusic(): void {}, playSound(): void {} },
    Browser: { window: telemetryHost },
    regClass: () => <T>(target: T): T => target,
  };
  const transpiled = transformSync(douyinRuntimeSource, {
    loader: "ts",
    format: "cjs",
    target: "es2020",
    tsconfigRaw: { compilerOptions: { experimentalDecorators: true } },
  });
  const commonJsModule: { exports: Record<string, unknown> } = { exports: {} };
  const context = createContext({ module: commonJsModule, exports: commonJsModule.exports, Laya: laya, GameGlobal: telemetryHost });
  new Script(transpiled.code, { filename: "generated/Main.js" }).runInContext(context, { timeout: 1_000 });
  const Main = commonJsModule.exports.Main as (new () => RuntimeInternals) | undefined;
  if (Main === undefined) throw new Error("Generated runtime did not export Main.");
  const scene = new Main();
  activeScenes.push(scene);
  scene.onAwake();
  for (let attempt = 0; attempt < 10 && telemetryHost.__GAMEFORGE_TEST__ === undefined; attempt += 1) await Promise.resolve();
  if (telemetryHost.__GAMEFORGE_TEST__ === undefined) throw new Error("Generated runtime did not reach its initial telemetry state.");
  return {
    scene,
    stage,
    timer,
    state: () => {
      const state = telemetryHost.__GAMEFORGE_TEST__;
      if (state === undefined) throw new Error("Runtime telemetry disappeared.");
      return state;
    },
  };
}

const specFor = (genre: Genre, overrides: Partial<TestSpec["gameplay"]> = {}): TestSpec => ({
  title: `${genre} logic proof`,
  objective: "Reach a deterministic terminal state.",
  genre,
  targetDurationSeconds: 60,
  gameplay: { collectibleCount: 1, hazardCount: 0, startingLives: 3, movementSpeed: 220, ...overrides },
});

describe("generated Douyin Laya runtime logic harness", () => {
  it("collects an arcade target and publishes a win", async () => {
    const runtime = await startRuntime(specFor("arcade"));
    runtime.scene.collectibles[0]?.pos(runtime.scene.player.x, runtime.scene.player.y);
    runtime.timer.advance(16);
    expect(runtime.state()).toMatchObject({ genre: "arcade", status: "won", score: 1, collectibles: [] });
  });

  it("moves puzzle input on the grid and wins", async () => {
    const runtime = await startRuntime(specFor("puzzle"));
    runtime.stage.emit("keydown", { key: "ArrowRight" });
    runtime.stage.emit("keydown", { key: "ArrowRight" });
    runtime.timer.advance(16);
    expect(runtime.state()).toMatchObject({ genre: "puzzle", status: "won", score: 1, player: { x: 192, y: 192 } });
  });

  it("applies platform gravity, jumps, and reaches a win", async () => {
    const runtime = await startRuntime(specFor("platformer"));
    runtime.timer.advance(256);
    const groundedY = runtime.state().player.y;
    runtime.stage.emit("keydown", { key: "ArrowUp" });
    runtime.timer.advance(16);
    expect(runtime.state().player.y).toBeLessThan(groundedY);
    runtime.scene.collectibles[0]?.pos(runtime.scene.player.x, runtime.scene.player.y);
    runtime.timer.advance(16);
    expect(runtime.state()).toMatchObject({ genre: "platformer", status: "won", score: 1 });
  });

  it("fires a shooter bullet and removes the final hazard", async () => {
    const runtime = await startRuntime(specFor("shooter", { hazardCount: 1 }));
    runtime.scene.hazards[0]?.sprite.pos(runtime.scene.player.x + 30, runtime.scene.player.y);
    runtime.stage.emit("keydown", { key: "Space" });
    runtime.timer.advance(16);
    expect(runtime.state()).toMatchObject({ genre: "shooter", status: "won", score: 1, hazards: [] });
  });

  it("uses the aggressive strategy stance for double damage", async () => {
    const runtime = await startRuntime(specFor("strategy", { hazardCount: 1, startingLives: 2 }));
    runtime.stage.emit("keydown", { key: "Space" });
    runtime.scene.hazards[0]?.sprite.pos(runtime.scene.player.x, runtime.scene.player.y);
    runtime.timer.advance(16);
    expect(runtime.state()).toMatchObject({ genre: "strategy", status: "lost", lives: 0 });
  });
});
