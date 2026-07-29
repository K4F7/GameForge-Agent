import { mkdtemp, mkdir, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { GameProjectGenerator } from "@gameforge/generator";
import type { TaskAcceptanceContract } from "@gameforge/contracts";
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
const candidateAcceptanceContract: TaskAcceptanceContract = {
  schemaVersion: "1.0",
  contractVersion: 1,
  fingerprint: "20b2123ccf0987194f72d75353e8aba67c95a5205a28f8ea188eb655c26fb199",
  criteria: [{
    criterionId: "candidate-outcome",
    sourceRequirement: "The candidate exposes its winning outcome.",
    expected: "The game reports won.",
    applicableScenarios: ["won"],
    verification: {
      kind: "public-telemetry",
      path: "$.status",
      assertion: { schemaVersion: 1, comparator: "equals", value: "won" },
    },
  }],
};
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
    schemaVersion: 1,
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
  async perform(action: VerificationAction): Promise<void> {
    this.actions.push(action);
    if (action.type === "press" && action.key === "KeyQ") {
      this.state = { schemaVersion: 1, status: "lost", score: 0, lives: 0, remainingSeconds: 0 };
    }
  }
  async readState(): Promise<unknown> { return this.state; }
  async readCanvas(): Promise<{ width: number; height: number } | null> { return this.canvas; }
  async readDom(selector: string): Promise<string | null> { return selector === "[data-status]" ? "won" : null; }
  async screenshot(): Promise<void> { return undefined; }
  async close(): Promise<void> { this.closed = true; }
}

class FakeRuntime implements VerificationRuntime {
  readonly session = new FakeSession();
  serverPath: string | undefined;
  serverClosed = false;
  async startServer(projectPath: string): Promise<{ url: string; close(): Promise<void> }> {
    this.serverPath = projectPath;
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
  const id = randomUUID();
  const generated = await new GameProjectGenerator({ outputRoot: root }).execute({
    projectId: "safety-sprint",
    spec,
    mode: "apply",
    attemptId: `attempt-${id}`,
    revisionId: `revision-${id}`,
    acceptanceContractFingerprint: candidateAcceptanceContract.fingerprint,
  });
  await rename(generated.outputPath!, path.join(root, "safety-sprint"));
  const canonicalRoot = await realpath(root);
  const runtime = new FakeRuntime();
  return { root: canonicalRoot, runtime, verifier: new GameVerifier({ projectsRoot: canonicalRoot, runtime }) };
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

  it("verifies an Attempt-owned candidate instead of the accepted project", async () => {
    const { root, runtime, verifier } = await fixture();
    const id = randomUUID();
    await new GameProjectGenerator({ outputRoot: root }).execute({
      projectId: "candidate-game",
      spec,
      mode: "apply",
      attemptId: `attempt-${id}`,
      revisionId: `revision-${id}`,
      acceptanceContractFingerprint: candidateAcceptanceContract.fingerprint,
    });
    const report = await verifier.verify({
      projectId: "candidate-game",
      attemptId: `attempt-${id}`,
      revisionId: `revision-${id}`,
      acceptanceContract: candidateAcceptanceContract,
    });
    expect(report).toMatchObject({ projectId: "candidate-game", passed: true });
    expect(report.scenarioResults).toEqual([
      expect.objectContaining({ scenario: "won", evidencePath: expect.stringMatching(/\.png$/) }),
      expect.objectContaining({ scenario: "lost", evidencePath: expect.stringMatching(/\.png$/) }),
    ]);
    expect(runtime.serverPath).toContain(`${path.sep}.gameforge${path.sep}candidates${path.sep}attempt-${id}`);
  });

  it("rejects candidate verification without the frozen acceptance contract", async () => {
    const { root, verifier } = await fixture();
    const id = randomUUID();
    await new GameProjectGenerator({ outputRoot: root }).execute({
      projectId: "unbound-verification",
      spec,
      mode: "apply",
      attemptId: `attempt-${id}`,
      revisionId: `revision-${id}`,
      acceptanceContractFingerprint: candidateAcceptanceContract.fingerprint,
    });

    await expect(verifier.verify({
      projectId: "unbound-verification",
      attemptId: `attempt-${id}`,
      revisionId: `revision-${id}`,
    })).rejects.toThrow("acceptance contract");
  });

  it("shares one total timeout across both candidate scenarios", async () => {
    const { root, runtime, verifier } = await fixture();
    const id = randomUUID();
    await new GameProjectGenerator({ outputRoot: root }).execute({
      projectId: "bounded-candidate",
      spec: {
        ...spec,
        gameplay: { collectibleCount: 1, hazardCount: 1, startingLives: 3, movementSpeed: 220 },
      },
      mode: "apply",
      attemptId: `attempt-${id}`,
      revisionId: `revision-${id}`,
      acceptanceContractFingerprint: candidateAcceptanceContract.fingerprint,
    });
    const originalPerform = runtime.session.perform.bind(runtime.session);
    runtime.session.perform = async (action) => {
      await new Promise((resolve) => setTimeout(resolve, 600));
      await originalPerform(action);
    };

    await expect(verifier.verify({
      projectId: "bounded-candidate",
      attemptId: `attempt-${id}`,
      revisionId: `revision-${id}`,
      acceptanceContract: candidateAcceptanceContract,
      timeoutMs: 1_000,
    })).rejects.toThrow("total timeout");
  });

  it("rejects a candidate missing its manifested public scenario plan", async () => {
    const { root, verifier } = await fixture();
    const id = randomUUID();
    await new GameProjectGenerator({ outputRoot: root }).execute({
      projectId: "missing-plan",
      spec,
      mode: "apply",
      attemptId: `attempt-${id}`,
      revisionId: `revision-${id}`,
      acceptanceContractFingerprint: candidateAcceptanceContract.fingerprint,
    });
    await rm(path.join(root, ".gameforge", "candidates", `attempt-${id}`, "missing-plan", ".gameforge", "verification-scenarios.json"));
    await expect(verifier.verify({ projectId: "missing-plan", attemptId: `attempt-${id}`, revisionId: `revision-${id}` }))
      .rejects.toThrow("content does not match its manifest");
  });

  it("rejects a candidate whose content no longer matches its bounded digest manifest", async () => {
    const { root, verifier } = await fixture();
    const id = randomUUID();
    const generated = await new GameProjectGenerator({ outputRoot: root }).execute({
      projectId: "tampered-game",
      spec,
      mode: "apply",
      attemptId: `attempt-${id}`,
      revisionId: `revision-${id}`,
      acceptanceContractFingerprint: candidateAcceptanceContract.fingerprint,
    });
    await writeFile(path.join(generated.outputPath!, "game-spec.json"), "{}\n");

    await expect(verifier.verify({
      projectId: "tampered-game",
      attemptId: `attempt-${id}`,
      revisionId: `revision-${id}`,
    })).rejects.toThrow("content does not match its manifest");
  });

  it("rejects a candidate whose public scenario plan changed after manifesting", async () => {
    const { root, verifier } = await fixture();
    const id = randomUUID();
    const generated = await new GameProjectGenerator({ outputRoot: root }).execute({
      projectId: "tampered-plan",
      spec,
      mode: "apply",
      attemptId: `attempt-${id}`,
      revisionId: `revision-${id}`,
      acceptanceContractFingerprint: candidateAcceptanceContract.fingerprint,
    });
    await writeFile(path.join(generated.outputPath!, ".gameforge", "verification-scenarios.json"), JSON.stringify({
      schemaVersion: 1,
      scenarios: { won: [{ type: "press", key: "Space" }], lost: [{ type: "wait", durationMs: 1_000 }] },
    }), "utf8");

    await expect(verifier.verify({
      projectId: "tampered-plan",
      attemptId: `attempt-${id}`,
      revisionId: `revision-${id}`,
    })).rejects.toThrow("content does not match its manifest");
  });

  it("rejects a caller contract that is easier than the authoritative Attempt contract", async () => {
    const { root, runtime } = await fixture();
    const id = randomUUID();
    const attemptId = `attempt-${id}`;
    const revisionId = `revision-${id}`;
    const taskId = `task-${id}`;
    const authoritativeContract: TaskAcceptanceContract = {
      schemaVersion: "1.0",
      contractVersion: 1,
      fingerprint: "255a1883471eec2f550bd03f0760be2ed95c724b98e0e3cfc68b5f5902055003",
      criteria: [{
        criterionId: "high-score",
        sourceRequirement: "Reach the authoritative target score.",
        expected: "The score reaches 999.",
        applicableScenarios: ["won"],
        verification: {
          kind: "public-telemetry",
          path: "$.score",
          assertion: { schemaVersion: 1, comparator: "equals", value: 999 },
        },
      }],
    };
    const generated = await new GameProjectGenerator({ outputRoot: root }).execute({
      projectId: "authority-bound",
      spec,
      mode: "apply",
      attemptId,
      revisionId,
      acceptanceContractFingerprint: authoritativeContract.fingerprint,
    });
    const manifestPath = path.join(generated.outputPath!, ".gameforge", "candidate.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Record<string, unknown>;
    await writeFile(manifestPath, JSON.stringify({
      ...manifest,
      acceptanceContractFingerprint: authoritativeContract.fingerprint,
    }, null, 2));
    const verifier = new GameVerifier({
      projectsRoot: root,
      runtime,
    });

    await expect(verifier.verify({
      projectId: "authority-bound",
      attemptId,
      revisionId,
      acceptanceContract: {
        schemaVersion: "1.0",
        contractVersion: 1,
        fingerprint: authoritativeContract.fingerprint,
        criteria: [{
          criterionId: "advisory-only",
          sourceRequirement: "Review the game.",
          expected: "review",
          verification: { kind: "human-review", prompt: "Review the game." },
        }],
      },
    })).rejects.toThrow("contract contents do not match its fingerprint");
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

  it("reports independent proof for each task acceptance criterion", async () => {
    const { verifier } = await fixture();
    const result = await verifier.verify({
      projectId: "safety-sprint",
      actions: [{ type: "press", key: "Space" }],
      expectedOutcome: "won",
      acceptanceContract: {
        schemaVersion: "1.0",
        contractVersion: 1,
        fingerprint: "a".repeat(64),
        criteria: [
          {
            criterionId: "press-space",
            sourceRequirement: "Press Space to activate the objective.",
            expected: "The game reports a win after Space is pressed.",
            verification: {
              kind: "browser-action",
              action: "press Space",
              observableEffect: {
                kind: "public-telemetry",
                path: "$.status",
                assertion: { schemaVersion: 1, comparator: "equals", value: "won" },
              },
            },
          },
          {
            criterionId: "game-won",
            sourceRequirement: "The game reports a win.",
            expected: "The game reports a win.",
            verification: { kind: "public-telemetry", path: "$.status", assertion: { schemaVersion: 1, comparator: "equals", value: "won" } },
          },
        ],
      },
    });
    expect(result.passed).toBe(true);
    expect(result.criteria).toEqual([
      expect.objectContaining({ criterionId: "press-space", passed: true }),
      expect.objectContaining({ criterionId: "game-won", passed: true }),
    ]);
  });

  it("does not treat browser input dispatch as proof without its observable effect", async () => {
    const { verifier } = await fixture();
    const result = await verifier.verify({
      projectId: "safety-sprint",
      actions: [{ type: "press", key: "Enter" }],
      acceptanceContract: {
        schemaVersion: "1.0",
        contractVersion: 1,
        fingerprint: "f".repeat(64),
        criteria: [{
          criterionId: "activate-objective",
          sourceRequirement: "Press Enter to activate the objective.",
          expected: "The score changes to 6.",
          verification: {
            kind: "browser-action",
            action: "press Enter",
            observableEffect: {
              kind: "public-telemetry",
              path: "$.score",
              assertion: { schemaVersion: 1, comparator: "changed-to", value: 6 },
            },
          },
        }],
      },
    });
    expect(result.criteria).toEqual([
      expect.objectContaining({ criterionId: "activate-objective", passed: false }),
    ]);
    expect(result.passed).toBe(false);
  });

  it("requires changed-to proof to observe a transition from the public baseline", async () => {
    const { runtime, verifier } = await fixture();
    runtime.session.state = {
      schemaVersion: 1,
      status: "won",
      score: 6,
      lives: 3,
      remainingSeconds: 42,
    };
    const result = await verifier.verify({
      projectId: "safety-sprint",
      actions: [{ type: "press", key: "Enter" }],
      acceptanceContract: {
        schemaVersion: "1.0",
        contractVersion: 1,
        fingerprint: "9".repeat(64),
        criteria: [{
          criterionId: "score-transition",
          sourceRequirement: "Press Enter to change the score to 6.",
          expected: "The score changes to 6.",
          verification: {
            kind: "browser-action",
            action: "press Enter",
            observableEffect: {
              kind: "public-telemetry",
              path: "$.score",
              assertion: { schemaVersion: 1, comparator: "changed-to", value: 6 },
            },
          },
        }],
      },
    });

    expect(result.criteria).toEqual([
      expect.objectContaining({ criterionId: "score-transition", passed: false }),
    ]);
    expect(result.passed).toBe(false);
  });

  it("normalizes existing public contract locators without exposing private state", async () => {
    const { verifier } = await fixture();
    const result = await verifier.verify({
      projectId: "safety-sprint",
      acceptanceContract: {
        schemaVersion: "1.0",
        contractVersion: 1,
        fingerprint: "e".repeat(64),
        criteria: [
          { criterionId: "legacy-status", sourceRequirement: "Report the public outcome.", expected: "The game reports won.", verification: { kind: "public-telemetry", path: "game.status", assertion: { schemaVersion: 1, comparator: "equals", value: "won" } } },
          { criterionId: "legacy-dom", sourceRequirement: "Expose the public status marker.", expected: "The status attribute reports won.", verification: { kind: "dom-output", selector: "[data-game-status]", assertion: { schemaVersion: 1, comparator: "equals", value: "won" } } },
        ],
      },
    });
    expect(result.passed).toBe(true);
    expect(result.criteria).toEqual([
      expect.objectContaining({ criterionId: "legacy-status", passed: true }),
      expect.objectContaining({ criterionId: "legacy-dom", passed: true }),
    ]);
  });

  it("evaluates DOM, screenshot, and human-review criteria without private game access", async () => {
    const { verifier } = await fixture();
    const result = await verifier.verify({
      projectId: "safety-sprint",
      acceptanceContract: {
        schemaVersion: "1.0",
        contractVersion: 1,
        fingerprint: "b".repeat(64),
        criteria: [
          { criterionId: "dom-status", sourceRequirement: "Show the victory status.", expected: "The status attribute reports won.", verification: { kind: "dom-output", selector: "[data-status]", assertion: { schemaVersion: 1, comparator: "equals", value: "won" } } },
          { criterionId: "visual-checkpoint", sourceRequirement: "Capture the completed board.", expected: "completed board", verification: { kind: "screenshot", checkpoint: "completed-board" } },
          { criterionId: "human-art-review", sourceRequirement: "Review the completed appearance.", expected: "review", verification: { kind: "human-review", prompt: "Review the completed appearance." } },
        ],
      },
    });
    expect(result.criteria).toEqual([
      expect.objectContaining({ criterionId: "dom-status", passed: true, proof: expect.objectContaining({ kind: "dom-output" }) }),
      expect.objectContaining({ criterionId: "visual-checkpoint", passed: false, advisory: true, proof: expect.objectContaining({ kind: "screenshot" }) }),
      expect.objectContaining({ criterionId: "human-art-review", passed: false, advisory: true, proof: expect.objectContaining({ kind: "human-review" }) }),
    ]);
    expect(result.passed).toBe(true);
  });

  it("rejects non-player operations at the public request boundary", async () => {
    const { verifier } = await fixture();
    for (const action of [
      { type: "set-state", path: "status", value: "won" },
      { type: "call-outcome", outcome: "won" },
      { type: "skip", durationMs: 1 },
    ]) {
      await expect(verifier.verify({ projectId: "safety-sprint", actions: [action as never] }))
        .rejects.toThrow();
    }
    await expect(verifier.verify({
      projectId: "safety-sprint",
      acceptanceContract: {
        schemaVersion: "1.0",
        contractVersion: 1,
        fingerprint: "c".repeat(64),
        criteria: [{
          criterionId: "private-scene",
          sourceRequirement: "Inspect Phaser internals.",
          expected: "x",
          verification: { kind: "public-telemetry", path: "$.scene.player.x", assertion: { schemaVersion: 1, comparator: "equals", value: "x" } },
        }],
      },
    })).rejects.toThrow();
    await expect(verifier.verify({
      projectId: "safety-sprint",
      acceptanceContract: {
        schemaVersion: "1.0",
        contractVersion: 1,
        fingerprint: "d".repeat(64),
        criteria: [{
          criterionId: "hidden-marker",
          sourceRequirement: "Inspect an undocumented DOM marker.",
          expected: "won",
          verification: { kind: "dom-output", selector: "[data-internal-result]", assertion: { schemaVersion: 1, comparator: "equals", value: "won" } },
        }],
      },
    })).rejects.toThrow("public output seam");
  });

  it("requires the public verification state schema version", async () => {
    const { runtime, verifier } = await fixture();
    runtime.session.state = { status: "won", score: 5, lives: 3, remainingSeconds: 42 };
    await expect(verifier.verify({ projectId: "safety-sprint" })).rejects.toThrow();
  });

  it("accepts unversioned public state from a legacy generated project", async () => {
    const { root, runtime, verifier } = await fixture();
    const manifestPath = path.join(root, "safety-sprint", ".gameforge", "manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Record<string, unknown>;
    delete manifest.verificationStateSchemaVersion;
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    runtime.session.state = { status: "won", score: 5, lives: 3, remainingSeconds: 42 };

    await expect(verifier.verify({ projectId: "safety-sprint", expectedOutcome: "won" })).resolves.toMatchObject({
      passed: true,
      state: { schemaVersion: 1, status: "won", score: 5 },
    });
  });

  it("supports concurrent first verification of the same project", async () => {
    const { verifier } = await fixture();

    const [first, second] = await Promise.all([
      verifier.verify({ projectId: "safety-sprint", actions: [], expectedOutcome: "won" }),
      verifier.verify({ projectId: "safety-sprint", actions: [], expectedOutcome: "won" }),
    ]);

    expect(first.passed).toBe(true);
    expect(second.passed).toBe(true);
    expect(second.screenshotPath).not.toBe(first.screenshotPath);
  });

  it("loads one bounded named scenario from the managed project", async () => {
    const { root, runtime, verifier } = await fixture();
    const actions = [
      { type: "press" as const, key: "Space" },
      { type: "hold" as const, key: "ArrowRight", durationMs: 500 },
    ];
    await writeFile(path.join(root, "safety-sprint", ".gameforge", "verification-scenarios.json"), JSON.stringify({
      schemaVersion: 1,
      scenarios: { won: actions, lost: [{ type: "wait", durationMs: 1_000 }] },
    }), "utf8");
    const result = await verifier.verify({ projectId: "safety-sprint", scenario: "won" });
    expect(result.passed).toBe(true);
    expect(result.actionsExecuted).toBe(2);
    expect(runtime.session.actions).toEqual(actions);
  });

  it("rejects ambiguous inline and named actions", async () => {
    const { verifier } = await fixture();
    await expect(verifier.verify({
      projectId: "safety-sprint",
      scenario: "won",
      actions: [{ type: "press", key: "Space" }],
    })).rejects.toThrow("mutually exclusive");
  });

  it("fails the report on browser diagnostics or outcome mismatch", async () => {
    const { runtime, verifier } = await fixture();
    runtime.session.state = { schemaVersion: 1, status: "running", score: 0, lives: 3, remainingSeconds: 90 };
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
      expect(await loader.text()).toMatch(/import\("[^"\n]*\/src\/game\.ts"\)/);
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
