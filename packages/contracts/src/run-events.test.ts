import { describe, expect, it } from "vitest";
import {
  replayRunEventsRequestSchema,
  runEventBatchSchema,
  runEventSchema,
  toRunEvent,
} from "./run-events.js";

const emittedAt = "2026-07-16T06:00:00+08:00";

describe("run event contracts", () => {
  it("validates and converts a wire event", () => {
    const event = runEventSchema.parse({
      type: "phase.started",
      runId: "run-1",
      sequence: 2,
      emittedAt,
      phase: "assets",
      detail: "Searching licensed sounds",
    });

    expect(toRunEvent(event)).toEqual({
      type: "phase.started",
      runId: "run-1",
      sequence: 2,
      phase: "assets",
      detail: "Searching licensed sounds",
    });
  });

  it("rejects invalid sequence numbers and unknown fields", () => {
    expect(runEventSchema.safeParse({
      type: "run.started",
      runId: "run-1",
      sequence: 0,
      emittedAt,
    }).success).toBe(false);

    expect(runEventSchema.safeParse({
      type: "run.started",
      runId: "run-1",
      sequence: 1,
      emittedAt,
      secret: "must-not-pass",
    }).success).toBe(false);
  });

  it("preserves an optional task language on the authoritative start event", () => {
    expect(toRunEvent(runEventSchema.parse({
      type: "run.started",
      runId: "run-english",
      sequence: 1,
      emittedAt,
      language: "en-US",
    }))).toMatchObject({ type: "run.started", language: "en-US" });
    expect(runEventSchema.safeParse({
      type: "run.started",
      runId: "run-invalid",
      sequence: 1,
      emittedAt,
      language: "fr-FR",
    }).success).toBe(false);
  });

  it("requires replay batches to be same-run and contiguous", () => {
    const result = runEventBatchSchema.safeParse({
      runId: "run-1",
      after: 1,
      events: [
        { type: "run.completed", runId: "run-2", sequence: 3, emittedAt },
      ],
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((issue) => issue.path.join("."))).toEqual([
        "events.0.runId",
        "events.0.sequence",
      ]);
    }
  });

  it("defaults a strict replay request to the beginning of a run", () => {
    expect(replayRunEventsRequestSchema.parse({ runId: "run-1" })).toEqual({
      runId: "run-1",
      after: 0,
    });
    expect(replayRunEventsRequestSchema.safeParse({ runId: "run-1", extra: true }).success).toBe(false);
  });

  it("accepts HTTPS and loopback previews while rejecting unsafe URLs", () => {
    expect(runEventSchema.safeParse({
      type: "preview.ready",
      runId: "run-1",
      sequence: 2,
      emittedAt,
      projectId: "safety-sprint",
      url: "http://127.0.0.1:5173/",
    }).success).toBe(true);
    expect(runEventSchema.safeParse({
      type: "preview.ready",
      runId: "run-1",
      sequence: 2,
      emittedAt,
      projectId: "safety-sprint",
      url: "https://preview.example.com/games/safety-sprint/",
    }).success).toBe(true);
    for (const url of [
      "http://preview.example.com/game/",
      "file:///D:/generated/index.html",
      "https://user:secret@preview.example.com/game/",
      "https://preview.example.com/game/#payload",
    ]) {
      expect(runEventSchema.safeParse({
        type: "preview.ready",
        runId: "run-1",
        sequence: 2,
        emittedAt,
        projectId: "safety-sprint",
        url,
      }).success).toBe(false);
    }
  });

  it("validates structured specification and runtime asset events", () => {
    expect(runEventSchema.safeParse({
      type: "spec.ready",
      runId: "run-1",
      sequence: 2,
      emittedAt,
      spec: {
        title: "Safety Sprint",
        genre: "arcade",
        objective: "Collect all equipment before time expires.",
        controls: ["Arrow keys"],
        winCondition: "Collect every item.",
        loseCondition: "Time expires.",
        targetDurationSeconds: 90,
      },
    }).success).toBe(true);
    expect(runEventSchema.safeParse({
      type: "asset.ready",
      runId: "run-1",
      sequence: 3,
      emittedAt,
      projectId: "safety-sprint",
      manifestRevision: 1,
      entry: {
        assetId: "jump",
        kind: "sound",
        role: "hit-sound",
        path: "assets/jump.wav",
        mimeType: "audio/wav",
        bytes: 128,
        sha256: "a".repeat(64),
        provenance: {
          assetId: "jump",
          kind: "sound",
          origin: "retrieved",
          provider: "freesound",
          sourceUrl: "https://freesound.org/s/42/",
          license: "CC0",
          sha256: "a".repeat(64),
        },
      },
    }).success).toBe(true);
  });

  it("validates a recoverable signed voice job event without accepting arbitrary handles", () => {
    const jobHandle = `${"a".repeat(80)}.${"b".repeat(43)}`;
    expect(runEventSchema.safeParse({
      type: "voice.job.updated",
      runId: "run-1",
      sequence: 2,
      emittedAt,
      projectId: "safety-sprint",
      assetId: "voices/guide",
      jobHandle,
      status: "processing",
    }).success).toBe(true);
    expect(runEventSchema.safeParse({
      type: "voice.job.updated",
      runId: "run-1",
      sequence: 2,
      emittedAt,
      projectId: "safety-sprint",
      assetId: "voices/guide",
      jobHandle: "not-signed",
      status: "processing",
    }).success).toBe(false);
  });

  it("accepts a bounded verification summary without exposing an absolute evidence path", () => {
    const event = {
      type: "verification.ready",
      runId: "run-1",
      sequence: 4,
      emittedAt,
      projectId: "safety-sprint",
      passed: true,
      outcome: "won",
      score: 5,
      lives: 2,
      remainingSeconds: 31.5,
      evidencePath: ".gameforge/verification/proof-1.png",
      canvas: { width: 960, height: 540 },
      diagnostics: { consoleErrors: 0, pageErrors: 0, failedRequests: 0 },
      actionsExecuted: 12,
      durationMs: 2_500,
    } as const;
    expect(runEventSchema.safeParse(event).success).toBe(true);
    expect(runEventSchema.safeParse({
      ...event,
      evidencePath: "D:/projects/safety-sprint/.gameforge/verification/proof.png",
    }).success).toBe(false);
  });

  it("accepts a secret-free MCP capability snapshot event", () => {
    expect(runEventSchema.safeParse({
      type: "capabilities.ready",
      runId: "run-1",
      sequence: 2,
      emittedAt,
      snapshot: {
        providers: {
          spec: { provider: "bailian-qwen", ready: true },
          image: { provider: "volcengine-ark", ready: true },
          tts: { provider: "volcengine-speech", ready: false },
          sound: { provider: "freesound", ready: false },
        },
        engineering: { assetStore: true, generator: true, verifier: true, preview: true, runRelay: true, taskInbox: true },
      },
    }).success).toBe(true);
  });
});
