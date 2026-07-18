import { createHash } from "node:crypto";
import { gameSpecSchema, projectIdSchema } from "@gameforge/contracts";
import { z } from "zod";

export const benchmarkDefinitionSchema = z.strictObject({
  benchmarkId: z.string().regex(/^[a-z0-9][a-z0-9._-]{2,79}$/),
  prompt: z.string().trim().min(10).max(12_000),
  language: z.enum(["zh-CN", "en-US"]),
  target: z.strictObject({
    genre: z.enum(["collect", "dodge", "survival", "shooter", "platform"]),
    platform: z.enum(["web", "douyin-mini-game", "wechat-mini-game"]).optional(),
    runtimeGenre: gameSpecSchema.shape.genre.optional(),
    durationSeconds: z.number().int().min(30).max(600),
    collectibleCount: z.number().int().min(1).max(10),
    hazardCount: z.number().int().min(0).max(6),
    startingLives: z.number().int().min(1).max(9),
    movementSpeed: z.number().int().min(100).max(360),
    mediaEnabled: z.boolean(),
  }).superRefine((target, context) => {
    if ((target.platform === "douyin-mini-game" || target.platform === "wechat-mini-game") &&
        target.runtimeGenre === undefined) {
      context.addIssue({
        code: "custom",
        path: ["runtimeGenre"],
        message: "Mini-game benchmark targets require an explicit runtime genre.",
      });
    }
  }),
});

const eventSummarySchema = z.strictObject({
  count: z.number().int().nonnegative(),
  types: z.record(z.string().min(1), z.number().int().nonnegative()),
});

export const toolSummarySchema = z.strictObject({
  count: z.number().int().nonnegative().nullable(),
  names: z.array(z.string().trim().min(1)).max(200),
  errors: z.number().int().nonnegative().nullable(),
});

export const benchmarkClientSchema = z.strictObject({
  name: z.enum(["codearts", "opencode"]),
  version: z.string().trim().min(1).max(100).regex(/^[^\r\n|]+$/),
  model: z.string().trim().min(1).max(200).regex(/^[^\r\n|]+$/).optional(),
  provider: z.string().trim().min(1).max(200).regex(/^[^\r\n|]+$/).optional(),
});

export const benchmarkFailureSchema = z.enum([
  "none", "rate-limit", "authentication", "provider", "tool", "timeout", "stopped", "unknown",
]);

const miniGameScenarioSchema = z.strictObject({
  name: z.enum(["genre-win", "timeout-loss"]),
  outcome: z.enum(["won", "lost"]),
  actions: z.number().int().positive().max(100),
});

export const miniGameEvidenceSchema = z.strictObject({
  projectId: projectIdSchema,
  target: z.enum(["douyin-mini-game", "wechat-mini-game"]),
  genre: gameSpecSchema.shape.genre,
  gameplay: z.strictObject({
    passed: z.literal(true),
    scenarios: z.tuple([
      miniGameScenarioSchema.extend({ name: z.literal("genre-win"), outcome: z.literal("won") }),
      miniGameScenarioSchema.extend({ name: z.literal("timeout-loss"), outcome: z.literal("lost") }),
    ]),
    durationMs: z.number().int().nonnegative().max(30_000),
  }),
  build: z.strictObject({
    passed: z.literal(true),
    cliVersion: z.literal("3.4.0"),
    fileCount: z.number().int().positive().max(100_000),
    totalBytes: z.number().int().nonnegative().max(20 * 1024 * 1024),
    mainPackageBytes: z.number().int().nonnegative().max(4 * 1024 * 1024),
    subpackageCount: z.number().int().nonnegative().max(100),
    deviceOrientation: z.enum(["portrait", "landscape"]),
    assetManifestRevision: z.number().int().nonnegative(),
    assetCount: z.number().int().nonnegative().max(1_000),
    stdoutTruncated: z.boolean(),
    stderrTruncated: z.boolean(),
  }),
}).superRefine((evidence, context) => {
  if (evidence.build.mainPackageBytes > evidence.build.totalBytes) {
    context.addIssue({
      code: "custom",
      path: ["build", "mainPackageBytes"],
      message: "Main package bytes cannot exceed total build bytes.",
    });
  }
});

export const benchmarkRecordSchema = z.strictObject({
  schemaVersion: z.literal(1),
  benchmarkId: benchmarkDefinitionSchema.shape.benchmarkId,
  definitionFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  client: benchmarkClientSchema,
  taskId: z.string().trim().min(1).max(120),
  runId: z.string().trim().min(1).max(120),
  terminalStatus: z.enum(["completed", "failed", "stopped", "queued", "claimed"]),
  durationMs: z.number().int().nonnegative().optional(),
  events: eventSummarySchema,
  tools: toolSummarySchema,
  toolAudit: z.strictObject({
    sessionId: z.string().uuid(),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    taskId: z.string().trim().min(1).max(120).optional(),
    runId: z.string().trim().min(1).max(120).optional(),
  }).optional(),
  verification: z.strictObject({
    passed: z.boolean(),
    outcome: z.enum(["running", "won", "lost"]),
    score: z.number().int().nonnegative(),
    lives: z.number().int().nonnegative(),
    diagnostics: z.number().int().nonnegative(),
  }).optional(),
  minigame: miniGameEvidenceSchema.optional(),
  humanInterventions: z.array(z.string().trim().min(1).max(500)).max(50),
  failure: benchmarkFailureSchema,
  evidence: z.array(z.string().trim().min(1).max(500)).min(1).max(50),
}).superRefine((record, context) => {
  const eventCount = Object.values(record.events.types).reduce((total, count) => total + count, 0);
  if (eventCount !== record.events.count) {
    context.addIssue({ code: "custom", path: ["events", "types"], message: "Event type counts must equal the event total." });
  }
  if (record.tools.count !== null && record.tools.names.length > record.tools.count) {
    context.addIssue({ code: "custom", path: ["tools", "names"], message: "Observed tool names cannot exceed the tool call total." });
  }
  if (record.tools.count !== null && record.tools.errors !== null && record.tools.errors > record.tools.count) {
    context.addIssue({ code: "custom", path: ["tools", "errors"], message: "Tool errors cannot exceed the tool call total." });
  }
  if (record.terminalStatus === "completed" &&
      (record.failure !== "none" || !hasSuccessfulWorkflowEvidence(record))) {
    context.addIssue({
      code: "custom",
      path: ["terminalStatus"],
      message: "Completed records require no failure and passed browser or mini-game workflow evidence.",
    });
  }
  if (record.terminalStatus !== "completed" && record.failure === "none") {
    context.addIssue({ code: "custom", path: ["failure"], message: "Incomplete records require a failure classification." });
  }
});

export type BenchmarkDefinition = z.infer<typeof benchmarkDefinitionSchema>;
export type BenchmarkRecord = z.infer<typeof benchmarkRecordSchema>;

export function hasSuccessfulWorkflowEvidence(record: {
  verification?: { passed: boolean } | undefined;
  minigame?: { gameplay: { passed: true }; build: { passed: true } } | undefined;
}): boolean {
  return record.verification?.passed === true ||
    (record.minigame?.gameplay.passed === true && record.minigame.build.passed === true);
}

export function fingerprintDefinition(input: BenchmarkDefinition): string {
  const definition = benchmarkDefinitionSchema.parse(input);
  return createHash("sha256").update(JSON.stringify(canonicalize(definition))).digest("hex");
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, canonicalize(child)]));
  }
  return value;
}
