import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { GameProjectGenerator } from "@gameforge/generator";
import type { Browser, chromium } from "playwright-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  assertSupportedPlaywrightRuntime,
  GameVerifier,
  PlaywrightVerificationRuntime,
  withTimeoutAndLateCleanup,
  type VerificationAction,
  type VerificationRuntime,
  type VerificationSession,
} from "./verifier.js";

const roots: string[] = [];
const spec = {
  title: "Safety Sprint",
  genre: "arcade" as const,
  objective: "Collect all equipment.",
  controls: ["Arrow keys"],
  winCondition: "Collect everything.",
  loseCondition: "Time expires.",
  targetDurationSeconds: 90,
};

class FakeSession implements VerificationSession {
  readonly actions: VerificationAction[] = [];
  closed = false;
  consoleListener: (message: string) => void = () => undefined;
  pageErrorListener: (message: string) => void = () => undefined;
  requestFailedListener: (message: string) => void = () => undefined;
  state: unknown = {
    status: "won",
    score: 5,
    lives: 3,
    remainingSeconds: 42,
    telemetry: {
      player: { x: 650, y: 390 },
      collectibles: [],
      hazards: [{ x: 400, y: 270 }],
    },
  };
  canvas: { width: number; height: number } | null = { width: 960, height: 540 };

  onConsoleError(listener: (message: string) => void): void { this.consoleListener = listener; }
  onPageError(listener: (message: string) => void): void { this.pageErrorListener = listener; }
  onRequestFailed(listener: (message: string) => void): void { this.requestFailedListener = listener; }
  async goto(): Promise<void> { return undefined; }
  async waitUntilReady(_timeoutMs: number): Promise<void> { return undefined; }
  async perform(action: VerificationAction): Promise<void> { this.actions.push(action); }
  async readState(): Promise<unknown> { return this.state; }
  async readCanvas(): Promise<{ width: number; height: number } | null> { return this.canvas; }
  async screenshot(): Promise<void> { return undefined; }
  async close(): Promise<void> { this.closed = true; }
}

class FakeRuntime implements VerificationRuntime {
  readonly session = new FakeSession();
  serverClosed = false;
  async startServer(): Promise<{ url: string; close(): Promise<void> }> {
    return {
      url: "http://127.0.0.1:4173/",
      close: async () => { this.serverClosed = true; },
    };
  }
  async startSession(): Promise<VerificationSession> { return this.session; }
}

async function fixture(): Promise<{ root: string; runtime: FakeRuntime; verifier: GameVerifier }> {
  const temporary = await mkdtemp(path.join(tmpdir(), "gameforge-verifier-test-"));
  roots.push(temporary);
  const root = path.join(temporary, "projects");
  await new GameProjectGenerator({ outputRoot: root }).execute({ projectId: "safety-sprint", spec, mode: "apply" });
  const runtime = new FakeRuntime();
  return { root, runtime, verifier: new GameVerifier({ projectsRoot: root, runtime }) };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("GameVerifier", () => {
  it("cleans a resource that resolves after its timeout", async () => {
    const cleanup = vi.fn(async () => undefined);
    const operation = new Promise<{ close(): Promise<void> }>((resolve) => {
      setTimeout(() => resolve({ close: async () => undefined }), 20);
    });
    await expect(withTimeoutAndLateCleanup(operation, 1, "late resource", cleanup)).rejects.toThrow("late resource");
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(cleanup).toHaveBeenCalledOnce();
  });
  it("rejects Bun before starting system Chrome", async () => {
    expect(() => assertSupportedPlaywrightRuntime({ bun: "1.3.14" })).toThrow("requires the Node runtime");
    const launch = vi.fn();
    const runtime = new PlaywrightVerificationRuntime(undefined, {
      launch: launch as unknown as typeof chromium.launch,
      runtimeVersions: { bun: "1.3.14" },
    });
    await expect(runtime.startSession("http://127.0.0.1:4173")).rejects.toThrow("requires the Node runtime");
    expect(launch).not.toHaveBeenCalled();
  });

  it("closes a launched browser when session setup fails", async () => {
    const close = vi.fn(async () => undefined);
    const launch = vi.fn(async () => ({
      newContext: async () => { throw new Error("context failed"); },
      close,
    }) as unknown as Browser);
    const runtime = new PlaywrightVerificationRuntime(undefined, {
      launch: launch as unknown as typeof chromium.launch,
      runtimeVersions: {},
    });
    await expect(runtime.startSession("http://127.0.0.1:4173")).rejects.toThrow("context failed");
    expect(launch).toHaveBeenCalledWith(expect.objectContaining({ channel: "chrome", timeout: 30_000 }));
    expect(close).toHaveBeenCalledOnce();
  });

  it("reports an inaccessible configured Chrome path before launch", async () => {
    const launch = vi.fn();
    const missing = path.join(tmpdir(), `missing-chrome-${crypto.randomUUID()}.exe`);
    const runtime = new PlaywrightVerificationRuntime(missing, {
      launch: launch as unknown as typeof chromium.launch,
      runtimeVersions: {},
    });
    await expect(runtime.startSession("http://127.0.0.1:4173")).rejects.toThrow("regular file");
    expect(launch).not.toHaveBeenCalled();
  });
  it("runs a bounded action script and returns deterministic evidence", async () => {
    const { runtime, verifier } = await fixture();
    const actions = [
      { type: "click" as const, x: 480, y: 270 },
      { type: "hold" as const, key: "ArrowRight", durationMs: 500 },
      { type: "press" as const, key: "Space" },
    ];
    const result = await verifier.verify({
      projectId: "safety-sprint",
      actions,
      expectedOutcome: "won",
    });
    expect(result).toMatchObject({
      projectId: "safety-sprint",
      passed: true,
      state: { status: "won", score: 5, telemetry: { collectibles: [] } },
      canvas: { width: 960, height: 540 },
      actionsExecuted: 3,
    });
    expect(result.screenshotPath).toMatch(/[\\/]\.gameforge[\\/]verification[\\/].+\.png$/);
    expect(result.evidencePath).toMatch(/^\.gameforge\/verification\/.+\.png$/);
    expect(runtime.session.actions).toEqual(actions);
    expect(runtime.session.closed).toBe(true);
    expect(runtime.serverClosed).toBe(true);
  });

  it("fails the report on browser diagnostics or outcome mismatch", async () => {
    const { runtime, verifier } = await fixture();
    runtime.session.state = { status: "running", score: 0, lives: 3, remainingSeconds: 90 };
    const originalWait = runtime.session.waitUntilReady.bind(runtime.session);
    runtime.session.waitUntilReady = async (timeoutMs: number) => {
      await originalWait(timeoutMs);
      runtime.session.consoleListener("bad\nconsole message");
      runtime.session.requestFailedListener("GET https://blocked.example — blocked");
    };
    const result = await verifier.verify({ projectId: "safety-sprint", expectedOutcome: "won" });
    expect(result.passed).toBe(false);
    expect(result.consoleErrors).toEqual(["bad console message"]);
    expect(result.failedRequests).toHaveLength(1);
  });

  it("preserves bounded browser diagnostics when readiness fails", async () => {
    const { runtime, verifier } = await fixture();
    runtime.session.waitUntilReady = async () => {
      runtime.session.pageErrorListener("missing default export");
      throw new Error("readiness timed out");
    };
    await expect(verifier.verify({ projectId: "safety-sprint" }))
      .rejects.toThrow("readiness timed out Diagnostics: page: missing default export");
    expect(runtime.session.closed).toBe(true);
    expect(runtime.serverClosed).toBe(true);
  });

  it("rejects unmanaged projects before starting a browser", async () => {
    const temporary = await mkdtemp(path.join(tmpdir(), "gameforge-verifier-unmanaged-"));
    roots.push(temporary);
    const projects = path.join(temporary, "projects");
    await mkdir(path.join(projects, "unmanaged"), { recursive: true });
    const runtime = new FakeRuntime();
    const verifier = new GameVerifier({ projectsRoot: projects, runtime });
    await expect(verifier.verify({ projectId: "unmanaged" })).rejects.toThrow();
    expect(runtime.serverClosed).toBe(false);
  });

  it("serves a real generated project through the Vite runtime", async () => {
    const { root } = await fixture();
    const server = await stage("start", new PlaywrightVerificationRuntime().startServer(path.join(root, "safety-sprint")));
    try {
      const response = await stage("fetch", fetch(server.url, {
        headers: { Connection: "close" },
        signal: AbortSignal.timeout(10_000),
      }));
      expect(response.ok).toBe(true);
      expect(await response.text()).toContain("GameForge Generated Game");
      const loader = await stage("loader", fetch(new URL("src/main.ts", server.url), {
        headers: { Connection: "close", Origin: "null" },
        signal: AbortSignal.timeout(10_000),
      }));
      expect(loader.headers.get("access-control-allow-origin")).toBe("*");
      expect(await loader.text()).toContain('import("/src/game.ts")');
      const game = await stage("game", fetch(new URL("src/game.ts", server.url), {
        headers: { Connection: "close" },
        signal: AbortSignal.timeout(10_000),
      }));
      expect(await game.text()).toContain("phaser.esm.js");
    } finally {
      await stage("close", server.close());
    }
  });
});

async function stage<T>(name: string, operation: Promise<T>): Promise<T> {
  return Promise.race([
    operation,
    new Promise<never>((_resolve, reject) => setTimeout(() => reject(new Error(`stage timed out: ${name}`)), 10_000)),
  ]);
}
