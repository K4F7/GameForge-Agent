import { describe, expect, it } from "vitest";
import { benchmarkDefinitionSchema, benchmarkRecordSchema, fingerprintDefinition } from "./schema.js";
import { compareRecords, formatComparison } from "./report.js";

const definition = benchmarkDefinitionSchema.parse({
  benchmarkId: "client-safety-game-v1",
  prompt: "Build a deterministic browser safety collection game.",
  language: "en-US",
  target: { genre: "collect", durationSeconds: 60, collectibleCount: 2, hazardCount: 1, startingLives: 3, movementSpeed: 200, mediaEnabled: false },
});
const record = (name: "codearts" | "opencode", status: "completed" | "stopped") => benchmarkRecordSchema.parse({
  schemaVersion: 1,
  benchmarkId: definition.benchmarkId,
  definitionFingerprint: fingerprintDefinition(definition),
  client: { name, version: "1.0" },
  taskId: `task-${name}`,
  runId: `run-${name}`,
  terminalStatus: status,
  events: status === "completed"
    ? { count: 6, types: { "run.started": 1, "capabilities.ready": 1, "spec.ready": 1, "verification.ready": 1, "preview.ready": 1, "run.completed": 1 } }
    : { count: 2, types: { "run.started": 1, "run.stopped": 1 } },
  tools: { count: status === "completed" ? 8 : 0, names: [], errors: 0 },
  ...(status === "completed" ? { verification: { passed: true, outcome: "won", score: 2, lives: 3, diagnostics: 0 } } : {}),
  humanInterventions: [],
  failure: status === "completed" ? "none" : "rate-limit",
  evidence: ["result.md"],
});
const miniDefinition = benchmarkDefinitionSchema.parse({
  benchmarkId: "douyin-mini-game-v1",
  prompt: "Build a deterministic Douyin collection mini-game and verify its local package.",
  language: "en-US",
  target: {
    genre: "collect",
    platform: "douyin-mini-game",
    runtimeGenre: "arcade",
    durationSeconds: 45,
    collectibleCount: 3,
    hazardCount: 2,
    startingLives: 3,
    movementSpeed: 220,
    mediaEnabled: false,
  },
});
const miniRecord = (name: "codearts" | "opencode") => benchmarkRecordSchema.parse({
  schemaVersion: 1,
  benchmarkId: miniDefinition.benchmarkId,
  definitionFingerprint: fingerprintDefinition(miniDefinition),
  client: { name, version: "1.0" },
  taskId: `task-${name}`,
  runId: `run-${name}`,
  terminalStatus: "completed",
  events: {
    count: 6,
    types: {
      "run.started": 1,
      "capabilities.ready": 1,
      "spec.ready": 1,
      "gameplay.verified": 1,
      "build.ready": 1,
      "run.completed": 1,
    },
  },
  tools: { count: 8, names: [], errors: 0 },
  minigame: {
    projectId: `${name}-game`,
    target: "douyin-mini-game",
    genre: "arcade",
    gameplay: {
      passed: true,
      scenarios: [
        { name: "genre-win", outcome: "won", actions: 3 },
        { name: "timeout-loss", outcome: "lost", actions: 1 },
      ],
      durationMs: 122,
    },
    build: {
      passed: true,
      cliVersion: "3.4.0",
      fileCount: 14,
      totalBytes: 1_112_075,
      mainPackageBytes: 1_112_075,
      subpackageCount: 0,
      deviceOrientation: "portrait",
      assetManifestRevision: 0,
      assetCount: 0,
      stdoutTruncated: false,
      stderrTruncated: false,
    },
  },
  humanInterventions: [],
  failure: "none",
  evidence: ["result.md"],
});

describe("client benchmark report", () => {
  it("distinguishes task equivalence from workflow comparability", () => {
    const comparison = compareRecords(definition, [record("codearts", "completed"), record("opencode", "stopped")]);
    expect(comparison).toMatchObject({ comparableTask: true, workflowComparable: false });
    expect(formatComparison(definition, comparison)).toContain("不能比较工作流质量");
  });

  it("rejects a record with another task fingerprint", () => {
    const changed = { ...record("opencode", "completed"), definitionFingerprint: "0".repeat(64) };
    expect(compareRecords(definition, [record("codearts", "completed"), changed])).toMatchObject({ comparableTask: false });
  });

  it("rejects internally inconsistent event evidence", () => {
    expect(() => benchmarkRecordSchema.parse({
      ...record("codearts", "completed"),
      events: { count: 2, types: { "run.started": 1 } },
    })).toThrow("Event type counts");
  });

  it("fingerprints semantic definitions independently of input key order", () => {
    const reordered = {
      language: definition.language,
      target: { mediaEnabled: false, movementSpeed: 200, startingLives: 3, hazardCount: 1, collectibleCount: 2, durationSeconds: 60, genre: "collect" as const },
      prompt: definition.prompt,
      benchmarkId: definition.benchmarkId,
    };
    expect(fingerprintDefinition(reordered)).toBe(fingerprintDefinition(definition));
  });

  it("compares completed mini-game workflows using gameplay and build proof", () => {
    const comparison = compareRecords(miniDefinition, [miniRecord("codearts"), miniRecord("opencode")]);
    expect(comparison).toMatchObject({ comparableTask: true, workflowComparable: true });
    expect(formatComparison(miniDefinition, comparison)).toContain("mini:douyin-mini-game/pass");
  });

  it("keeps legacy schemaVersion 1 browser-only records comparable", () => {
    const codearts = record("codearts", "completed");
    const opencode = record("opencode", "completed");
    expect(codearts.schemaVersion).toBe(1);
    expect(codearts.minigame).toBeUndefined();
    expect(definition.target.platform).toBeUndefined();
    expect(compareRecords(definition, [codearts, opencode])).toMatchObject({
      comparableTask: true,
      workflowComparable: true,
    });
  });

  it("does not accept mini-game proof for a legacy definition without a platform", () => {
    const handAuthored = (name: "codearts" | "opencode") => benchmarkRecordSchema.parse({
      ...miniRecord(name),
      benchmarkId: definition.benchmarkId,
      definitionFingerprint: fingerprintDefinition(definition),
    });
    expect(compareRecords(definition, [handAuthored("codearts"), handAuthored("opencode")]))
      .toMatchObject({ comparableTask: true, workflowComparable: false });
  });
});
