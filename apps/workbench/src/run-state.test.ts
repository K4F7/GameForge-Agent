import { describe, expect, it } from "vitest";
import { createInitialRunState, runReducer, type RunEvent } from "./run-state.js";

describe("runReducer", () => {
  it("restores the requested language from the authoritative start event", () => {
    expect(runReducer(createInitialRunState(), {
      type: "run.started",
      runId: "run-english",
      sequence: 1,
      language: "en-US",
    })).toMatchObject({ runId: "run-english", language: "en-US" });
  });

  it("resets a terminal run before preparing a new task", () => {
    const stopped = runReducer(
      runReducer(createInitialRunState(), { type: "run.started", runId: "run-old", sequence: 1 }),
      { type: "run.stopped", runId: "run-old", sequence: 2 },
    );
    expect(runReducer(stopped, { type: "ui.reset" })).toEqual(createInitialRunState());
  });

  it("tracks voice job status without retaining the signed handle", () => {
    const jobHandle = `${"a".repeat(80)}.${"b".repeat(43)}`;
    const state = runReducer(
      runReducer(createInitialRunState(), { type: "run.started", runId: "run-1", sequence: 1 }),
      {
        type: "voice.job.updated",
        runId: "run-1",
        sequence: 2,
        projectId: "safety-sprint",
        assetId: "voices/guide",
        jobHandle,
        status: "processing",
      },
    );
    expect(state.voiceJobs).toEqual([{
      projectId: "safety-sprint",
      assetId: "voices/guide",
      status: "processing",
    }]);
    expect(JSON.stringify(state)).not.toContain(jobHandle);
  });

  it("retains the latest structured browser verification evidence", () => {
    const state = runReducer(
      runReducer(createInitialRunState(), { type: "run.started", runId: "run-1", sequence: 1 }),
      {
        type: "verification.ready",
        runId: "run-1",
        sequence: 2,
        projectId: "safety-sprint",
        passed: true,
        outcome: "won",
        score: 5,
        lives: 2,
        remainingSeconds: 30,
        evidencePath: ".gameforge/verification/proof.png",
        canvas: { width: 960, height: 540 },
        diagnostics: { consoleErrors: 0, pageErrors: 0, failedRequests: 0 },
        actionsExecuted: 8,
        durationMs: 1_500,
      },
    );
    expect(state.verification).toMatchObject({ passed: true, outcome: "won", score: 5 });
  });

  it("tracks the MCP capability snapshot without inferring readiness", () => {
    const snapshot = {
      providers: {
        spec: { provider: "bailian-qwen" as const, ready: true },
        image: { provider: "volcengine-ark" as const, ready: false },
        tts: { provider: "volcengine-speech" as const, ready: false },
        sound: { provider: "freesound" as const, ready: true },
      },
      engineering: { assetStore: true, generator: true, douyinBuild: true, verifier: true, preview: true, runRelay: true, taskInbox: true },
    };
    const state = runReducer(
      runReducer(createInitialRunState(), { type: "run.started", runId: "run-1", sequence: 1 }),
      { type: "capabilities.ready", runId: "run-1", sequence: 2, snapshot },
    );
    expect(state.capabilities).toEqual(snapshot);
  });

  it("starts a run and ignores stale events", () => {
    const started = runReducer(createInitialRunState(), {
      type: "run.started",
      runId: "run-1",
      sequence: 1,
    });
    const stale = runReducer(started, {
      type: "run.stopped",
      runId: "run-1",
      sequence: 1,
    });

    expect(started.status).toBe("running");
    expect(stale).toBe(started);
  });

  it("marks repairable failures and tracks the next attempt", () => {
    const events: RunEvent[] = [
      { type: "run.started", runId: "run-1", sequence: 1 },
      {
        type: "phase.started",
        runId: "run-1",
        sequence: 2,
        phase: "build",
        detail: "Checking",
      },
      {
        type: "phase.failed",
        runId: "run-1",
        sequence: 3,
        phase: "build",
        message: "Type error",
        repairable: true,
      },
      {
        type: "phase.started",
        runId: "run-1",
        sequence: 4,
        phase: "build",
        detail: "Retrying",
      },
    ];
    const state = events.reduce(runReducer, createInitialRunState());
    const buildPhase = state.phases.find((phase) => phase.id === "build");

    expect(state.status).toBe("running");
    expect(buildPhase).toMatchObject({ status: "running", attempt: 2, detail: "Retrying" });
  });

  it("does not accept events from a different active run", () => {
    const started = runReducer(createInitialRunState(), {
      type: "run.started",
      runId: "run-1",
      sequence: 1,
    });
    const foreign = runReducer(started, {
      type: "run.completed",
      runId: "run-2",
      sequence: 2,
    });

    expect(foreign).toBe(started);
  });

  it("accepts a new run whose event sequence restarts at one", () => {
    const previous = runReducer(
      runReducer(createInitialRunState(), {
        type: "run.started",
        runId: "run-1",
        sequence: 1,
      }),
      {
        type: "run.completed",
        runId: "run-1",
        sequence: 20,
      },
    );
    const restarted = runReducer(previous, {
      type: "run.started",
      runId: "run-2",
      sequence: 1,
    });

    expect(restarted).toMatchObject({ runId: "run-2", status: "running", lastSequence: 1 });
  });

  it("does not reset state when run.started is replayed", () => {
    const withLog = runReducer(
      runReducer(createInitialRunState(), {
        type: "run.started",
        runId: "run-1",
        sequence: 1,
      }),
      {
        type: "log.appended",
        runId: "run-1",
        sequence: 2,
        source: "agent",
        level: "info",
        message: "Already running",
      },
    );

    const replayed = runReducer(withLog, {
      type: "run.started",
      runId: "run-1",
      sequence: 1,
    });

    expect(replayed).toBe(withLog);
    expect(replayed.logs).toHaveLength(1);
  });

  it("does not replace an active run with a foreign start event", () => {
    const active = runReducer(createInitialRunState(), {
      type: "run.started",
      runId: "run-1",
      sequence: 1,
    });
    const foreign = runReducer(active, {
      type: "run.started",
      runId: "run-2",
      sequence: 1,
    });

    expect(foreign).toBe(active);
  });

  it("caps logs to the most recent 200 entries", () => {
    let state = runReducer(createInitialRunState(), {
      type: "run.started",
      runId: "run-1",
      sequence: 1,
    });

    for (let sequence = 2; sequence <= 211; sequence += 1) {
      state = runReducer(state, {
        type: "log.appended",
        runId: "run-1",
        sequence,
        source: "agent",
        level: "info",
        message: `Log ${sequence}`,
      });
    }

    expect(state.logs).toHaveLength(200);
    expect(state.logs[0]?.sequence).toBe(12);
  });

  it("switches to a validated preview artifact and clears it for a new run", () => {
    const withPreview = runReducer(
      runReducer(createInitialRunState(), {
        type: "run.started",
        runId: "run-1",
        sequence: 1,
      }),
      {
        type: "preview.ready",
        runId: "run-1",
        sequence: 2,
        projectId: "safety-sprint",
        url: "http://127.0.0.1:5173/",
      },
    );
    expect(withPreview.preview).toEqual({
      projectId: "safety-sprint",
      url: "http://127.0.0.1:5173/",
    });

    const completed = runReducer(withPreview, {
      type: "run.completed",
      runId: "run-1",
      sequence: 3,
    });
    const nextRun = runReducer(completed, {
      type: "run.started",
      runId: "run-2",
      sequence: 1,
    });
    expect(nextRun).toMatchObject({ preview: null, spec: null, assets: [] });
  });

  it("renders structured spec and asset events without inferring from logs", () => {
    const spec = {
      title: "Safety Sprint",
      genre: "arcade" as const,
      objective: "Collect all equipment before time expires.",
      controls: ["Arrow keys"],
      winCondition: "Collect every item.",
      loseCondition: "Time expires.",
      targetDurationSeconds: 90,
    };
    const entry = {
      assetId: "jump",
      kind: "sound" as const,
      role: "hit-sound" as const,
      path: "assets/jump.wav",
      mimeType: "audio/wav" as const,
      bytes: 128,
      sha256: "a".repeat(64),
      provenance: {
        assetId: "jump",
        kind: "sound" as const,
        origin: "retrieved" as const,
        provider: "freesound",
        sourceUrl: "https://freesound.org/s/42/",
        license: "CC0",
        sha256: "a".repeat(64),
      },
    };
    const events: RunEvent[] = [
      { type: "run.started", runId: "run-1", sequence: 1 },
      { type: "spec.ready", runId: "run-1", sequence: 2, spec },
      {
        type: "asset.ready",
        runId: "run-1",
        sequence: 3,
        projectId: "safety-sprint",
        manifestRevision: 1,
        entry,
      },
    ];
    const state = events.reduce(runReducer, createInitialRunState());
    expect(state.spec).toEqual(spec);
    expect(state.assets).toEqual([entry]);
  });
});
