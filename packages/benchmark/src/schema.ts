import { createHash } from "node:crypto";
import { z } from "zod";

export const benchmarkDefinitionSchema = z.strictObject({
  benchmarkId: z.string().regex(/^[a-z0-9][a-z0-9._-]{2,79}$/),
  prompt: z.string().trim().min(10).max(12_000),
  language: z.enum(["zh-CN", "en-US"]),
  target: z.strictObject({
    genre: z.enum(["collect", "dodge", "survival", "shooter", "platform"]),
    durationSeconds: z.number().int().min(30).max(600),
    collectibleCount: z.number().int().min(1).max(10),
    hazardCount: z.number().int().min(0).max(6),
    startingLives: z.number().int().min(1).max(9),
    movementSpeed: z.number().int().min(100).max(360),
    mediaEnabled: z.boolean(),
  }),
});

const eventSummarySchema = z.strictObject({
  count: z.number().int().nonnegative(),
  types: z.record(z.string().min(1), z.number().int().nonnegative()),
});

const toolSummarySchema = z.strictObject({
  count: z.number().int().nonnegative().nullable(),
  names: z.array(z.string().trim().min(1)).max(200),
  errors: z.number().int().nonnegative().nullable(),
});

export const benchmarkRecordSchema = z.strictObject({
  schemaVersion: z.literal(1),
  benchmarkId: benchmarkDefinitionSchema.shape.benchmarkId,
  definitionFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  client: z.strictObject({
    name: z.enum(["codearts", "opencode"]),
    version: z.string().trim().min(1).max(100).regex(/^[^\r\n|]+$/),
    model: z.string().trim().min(1).max(200).regex(/^[^\r\n|]+$/).optional(),
    provider: z.string().trim().min(1).max(200).regex(/^[^\r\n|]+$/).optional(),
  }),
  taskId: z.string().trim().min(1).max(120),
  runId: z.string().trim().min(1).max(120),
  terminalStatus: z.enum(["completed", "failed", "stopped", "queued", "claimed"]),
  durationMs: z.number().int().nonnegative().optional(),
  events: eventSummarySchema,
  tools: toolSummarySchema,
  verification: z.strictObject({
    passed: z.boolean(),
    outcome: z.enum(["running", "won", "lost"]),
    score: z.number().int().nonnegative(),
    lives: z.number().int().nonnegative(),
    diagnostics: z.number().int().nonnegative(),
  }).optional(),
  humanInterventions: z.array(z.string().trim().min(1).max(500)).max(50),
  failure: z.enum(["none", "rate-limit", "authentication", "provider", "tool", "timeout", "stopped", "unknown"]),
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
  if (record.terminalStatus === "completed" && (record.failure !== "none" || record.verification?.passed !== true)) {
    context.addIssue({ code: "custom", path: ["terminalStatus"], message: "Completed records require no failure and a passed verification." });
  }
  if (record.terminalStatus !== "completed" && record.failure === "none") {
    context.addIssue({ code: "custom", path: ["failure"], message: "Incomplete records require a failure classification." });
  }
});

export type BenchmarkDefinition = z.infer<typeof benchmarkDefinitionSchema>;
export type BenchmarkRecord = z.infer<typeof benchmarkRecordSchema>;

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
