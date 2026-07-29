import { mkdtemp, mkdir, rename, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { GameProjectGenerator } from "@gameforge/generator";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GamePreviewManager, type GamePreviewRuntime } from "./preview.js";

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

class FakePreviewRuntime implements GamePreviewRuntime {
  starts = 0;
  closes = 0;
  nextUrl = "http://127.0.0.1:4173/";

  async startServer(): Promise<{ url: string; close(): Promise<void> }> {
    this.starts += 1;
    return {
      url: this.nextUrl,
      close: async () => { this.closes += 1; },
    };
  }
}

async function fixture(maxSessions = 5): Promise<{
  manager: GamePreviewManager;
  projects: string;
  runtime: FakePreviewRuntime;
}> {
  const temporary = await mkdtemp(path.join(tmpdir(), "gameforge-preview-test-"));
  roots.push(temporary);
  const projects = path.join(temporary, "projects");
  const id = randomUUID();
  const generated = await new GameProjectGenerator({ outputRoot: projects }).execute({
    projectId: "safety-sprint",
    spec,
    mode: "apply",
    attemptId: `attempt-${id}`,
    revisionId: `revision-${id}`,
    acceptanceContractFingerprint: "a".repeat(64),
  });
  await rename(generated.outputPath!, path.join(projects, "safety-sprint"));
  const runtime = new FakePreviewRuntime();
  return { projects, runtime, manager: new GamePreviewManager({ projectsRoot: projects, maxSessions, runtime }) };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("GamePreviewManager", () => {
  it("starts one managed preview, reuses it, and stops it idempotently", async () => {
    const { manager, runtime } = await fixture();
    await expect(manager.start({ projectId: "safety-sprint" })).resolves.toEqual({
      projectId: "safety-sprint",
      url: "http://127.0.0.1:4173/",
      reused: false,
    });
    await expect(manager.start({ projectId: "safety-sprint" })).resolves.toMatchObject({ reused: true });
    expect(runtime.starts).toBe(1);
    await expect(manager.stop({ projectId: "safety-sprint" })).resolves.toEqual({
      projectId: "safety-sprint",
      stopped: true,
    });
    await expect(manager.stop({ projectId: "safety-sprint" })).resolves.toMatchObject({ stopped: false });
    expect(runtime.closes).toBe(1);
  });

  it("coalesces concurrent starts for the same project", async () => {
    const { manager, runtime } = await fixture();
    const [first, second] = await Promise.all([
      manager.start({ projectId: "safety-sprint" }),
      manager.start({ projectId: "safety-sprint" }),
    ]);
    expect(first).toMatchObject({ reused: false });
    expect(second).toMatchObject({ reused: true, url: first.url });
    expect(runtime.starts).toBe(1);
    await manager.closeAll();
    expect(runtime.closes).toBe(1);
  });

  it("rejects unmanaged projects before starting a server", async () => {
    const { manager, projects, runtime } = await fixture();
    await mkdir(path.join(projects, "unmanaged"));
    await expect(manager.start({ projectId: "unmanaged" })).rejects.toThrow();
    expect(runtime.starts).toBe(0);
  });

  it("closes a server that reports an unsafe public HTTP URL", async () => {
    const { manager, runtime } = await fixture();
    runtime.nextUrl = "http://preview.example.com/game/";
    await expect(manager.start({ projectId: "safety-sprint" })).rejects.toThrow("loopback HTTP");
    expect(runtime.closes).toBe(1);
  });

  it("closes a server that resolves after startup times out", async () => {
    const { projects } = await fixture();
    let resolveServer = (_server: { url: string; close(): Promise<void> }): void => undefined;
    let markStarted = (): void => undefined;
    const started = new Promise<void>((resolve) => { markStarted = resolve; });
    const close = vi.fn(async () => undefined);
    const runtime: GamePreviewRuntime = {
      startServer: async () => {
        markStarted();
        return await new Promise((resolve) => { resolveServer = resolve; });
      },
    };
    const manager = new GamePreviewManager({ projectsRoot: projects, runtime });
    vi.useFakeTimers();
    try {
      const start = manager.start({ projectId: "safety-sprint" });
      const rejected = expect(start).rejects.toThrow("Preview server startup timed out.");
      await started;
      await vi.advanceTimersByTimeAsync(30_000);
      await rejected;

      resolveServer({ url: "http://127.0.0.1:4173/", close });
      await Promise.resolve();
      await Promise.resolve();

      expect(close).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it("serves and stops a real generated project through the managed preview", async () => {
    const { projects } = await fixture();
    const manager = new GamePreviewManager({ projectsRoot: projects });
    const preview = await manager.start({ projectId: "safety-sprint" });
    try {
      const response = await fetch(preview.url, {
        headers: { Connection: "close" },
        signal: AbortSignal.timeout(10_000),
      });
      expect(response.ok).toBe(true);
      expect(await response.text()).toContain("GameForge Generated Game");
    } finally {
      await manager.stop({ projectId: "safety-sprint" });
    }
  });
});
