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

  it("accepts path-safe generation context and bounded redacted MCP audit events", () => {
    const generationEvent = {
      type: "project.generated",
      runId: "run-1",
      sequence: 4,
      emittedAt,
      mode: "apply",
      operation: "update",
      plan: {
        generatorVersion: "0.12.0",
        projectId: "safety-sprint",
        target: "web",
        specSha256: "a".repeat(64),
        planSha256: "b".repeat(64),
        files: [{ path: "src/main.ts", bytes: 128, sha256: "c".repeat(64) }],
      },
      update: {
        currentPlanSha256: "d".repeat(64),
        updatedPaths: ["src/main.ts"],
        unchangedPaths: [],
        preservedPaths: [],
        deletedPaths: [],
        conflicts: [],
      },
    } as const;
    expect(runEventSchema.safeParse(generationEvent).success).toBe(true);
    expect(runEventSchema.safeParse({ ...generationEvent, outputPath: "D:/generated/safety-sprint" }).success).toBe(false);

    const auditEvent = {
      type: "mcp.audit.ready",
      runId: "run-1",
      sequence: 5,
      emittedAt,
      truncated: false,
      totalCalls: 2,
      calls: [
        { sequence: 1, tool: "claim_game_task", durationMs: 12, outcome: "success" },
        { sequence: 2, tool: "generate_game_project", durationMs: 48, outcome: "success" },
      ],
    } as const;
    expect(runEventSchema.safeParse(auditEvent).success).toBe(true);
    expect(runEventSchema.safeParse({ ...auditEvent, sessionId: "00000000-0000-0000-0000-000000000000" }).success).toBe(false);
    expect(runEventSchema.safeParse({ ...auditEvent, calls: [{ ...auditEvent.calls[0], arguments: { secret: true } }] }).success).toBe(false);
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

  it("accepts a secret-free Douyin build summary and rejects host paths or oversized packages", () => {
    const event = {
      type: "build.ready",
      runId: "run-1",
      sequence: 4,
      emittedAt,
      projectId: "safety-sprint",
      target: "douyin-mini-game",
      cliVersion: "3.4.0",
      passed: true,
      fileCount: 16,
      totalBytes: 1_108_438,
      mainPackageBytes: 1_108_438,
      subpackages: [],
      deviceOrientation: "portrait",
      capabilities: { network: false, login: false, share: false, ads: false, payments: false },
      allowedNetworkHosts: [],
      assetManifestRevision: 2,
      assetCount: 2,
      artifactSha256: "d".repeat(64),
      remoteOperations: "forbidden",
      devToolVerification: "not-run",
      stdoutTruncated: false,
      stderrTruncated: false,
    } as const;
    expect(runEventSchema.safeParse(event).success).toBe(true);
    expect(runEventSchema.safeParse({ ...event, target: "wechat-mini-game" }).success).toBe(true);
    expect(runEventSchema.safeParse({ ...event, outputPath: "D:/generated/safety-sprint/release" }).success).toBe(false);
    expect(runEventSchema.safeParse({ ...event, remoteOperations: "allowed" }).success).toBe(false);
    expect(runEventSchema.safeParse({ ...event, devToolVerification: "passed" }).success).toBe(false);
    expect(runEventSchema.safeParse({ ...event, mainPackageBytes: 4 * 1024 * 1024 + 1 }).success).toBe(false);
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
          music: { provider: "minimax", ready: false },
        },
        engineering: { assetStore: true, generator: true, douyinBuild: true, wechatBuild: true, verifier: true, preview: true, runRelay: true, taskInbox: true },
      },
    }).success).toBe(true);
  });

  it("keeps Laya logic proof distinct from browser and platform evidence", () => {
    const event = {
      type: "gameplay.verified",
      runId: "run-1",
      sequence: 5,
      emittedAt,
      projectId: "wechat-arcade",
      target: "wechat-mini-game",
      genre: "arcade",
      passed: true,
      scenarios: [
        { name: "genre-win", outcome: "won", actions: 2 },
        { name: "timeout-loss", outcome: "lost", actions: 1 },
      ],
      durationMs: 50,
      templateSha256: "a".repeat(64),
    } as const;
    expect(runEventSchema.safeParse(event).success).toBe(true);
    expect(runEventSchema.safeParse({ ...event, evidencePath: ".gameforge/verification/fake.png" }).success).toBe(false);
    expect(runEventSchema.safeParse({ ...event, target: "web" }).success).toBe(false);
  });
});
