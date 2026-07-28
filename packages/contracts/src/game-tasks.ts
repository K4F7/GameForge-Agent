import { z } from "zod";
import { runEventSchema, runIdSchema } from "./run-events.js";
import { projectIdSchema } from "./project-generation.js";

export const gameTaskIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .regex(/^task-[a-f0-9-]{36}$/, "Task ID is invalid.");

export const gameTaskPromptSchema = z.string().trim().min(10).max(12_000);
export const gameTaskLanguageSchema = z.enum(["zh-CN", "en-US"]);
export const gameTaskStatusSchema = z.enum([
  "queued",
  "needs-info",
  "claimed",
  "in-progress",
  "retryable",
  "completed",
  "failed",
  "canceled",
  "conflicted",
]);
// reasonCode 是独立版本化值；字面量逐项对应 #56 的需求歧义、可重试与不可重试分类。
// 未知值刻意不在枚举中，Authority 必须返回 invalid，不能从 message 推断生命周期。
export const gameTaskReasonCodeSchema = z.strictObject({
  schemaVersion: z.literal("1.0"),
  code: z.enum([
    "requirements-ambiguous",
    "infrastructure-unavailable",
    "rate-limited",
    "unexpected-process-exit",
    "bounded-timeout",
    "browser-startup-failed",
    "evidence-write-interrupted",
    "build-failed",
    "gameplay-failed",
    "browser-diagnostic-failed",
    "task-criterion-failed",
    "schema-violation",
    "security-violation",
    "stale-base-conflict",
    "unchanged-human-rejection",
    "cancellation",
    "capability-removed",
  ]),
});
export const gameTaskAgentIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/, "Agent ID contains unsupported characters.");

export const createGameTaskRequestSchema = z.strictObject({
  runId: runIdSchema,
  prompt: gameTaskPromptSchema,
  language: gameTaskLanguageSchema.default("zh-CN"),
  projectId: projectIdSchema.optional(),
});

export const claimGameTaskRequestSchema = z.strictObject({ agentId: gameTaskAgentIdSchema });

export const listGameTasksRequestSchema = z.strictObject({
  status: gameTaskStatusSchema.optional(),
  limit: z.number().int().min(1).max(100).default(20),
});

export const gameTaskTransitionRequestSchema = z.strictObject({
  status: gameTaskStatusSchema,
  reasonCode: gameTaskReasonCodeSchema.optional(),
});

export const gameTaskSchema = z.strictObject({
  taskId: gameTaskIdSchema,
  runId: runIdSchema,
  prompt: gameTaskPromptSchema,
  language: gameTaskLanguageSchema,
  projectId: projectIdSchema.optional(),
  status: gameTaskStatusSchema,
  reasonCode: gameTaskReasonCodeSchema.optional(),
  createdAt: z.string().datetime({ offset: true }),
  claimedAt: z.string().datetime({ offset: true }).optional(),
  claimedBy: gameTaskAgentIdSchema.optional(),
  completedAt: z.string().datetime({ offset: true }).optional(),
}).superRefine((task, context) => {
  const claimed = task.claimedAt !== undefined || task.claimedBy !== undefined;
  if ((task.claimedAt === undefined) !== (task.claimedBy === undefined)) {
    context.addIssue({ code: "custom", path: ["claimedBy"], message: "Claim metadata must be complete." });
  }
  if (["claimed", "in-progress", "retryable", "completed", "failed", "conflicted"].includes(task.status) && !claimed) {
    context.addIssue({ code: "custom", path: ["status"], message: "Claimed tasks require claim metadata." });
  }
  const terminal = ["completed", "failed", "canceled", "conflicted"].includes(task.status);
  if (terminal !== (task.completedAt !== undefined)) {
    context.addIssue({ code: "custom", path: ["completedAt"], message: "Terminal task timestamp is inconsistent." });
  }
  if ((task.status === "queued" || task.status === "needs-info") && claimed) {
    context.addIssue({ code: "custom", path: ["status"], message: "Pre-work tasks cannot contain claim metadata." });
  }
  const expectedReason: readonly string[] = task.status === "needs-info" ? ["requirements-ambiguous"]
    : task.status === "retryable" ? RETRYABLE_REASON_CODES
    : task.status === "failed" ? FAILED_REASON_CODES
    : task.status === "canceled" ? ["cancellation"]
    : task.status === "conflicted" ? ["stale-base-conflict"]
    : [];
  if (expectedReason.length === 0 && task.reasonCode !== undefined) {
    context.addIssue({ code: "custom", path: ["reasonCode"], message: "This Task state cannot contain a reason code." });
  } else if (expectedReason.length > 0 && !expectedReason.includes(task.reasonCode?.code ?? "")) {
    context.addIssue({ code: "custom", path: ["reasonCode"], message: "Task reason code does not classify this state." });
  }
});

export const gameTaskTransitionResultSchema = z.discriminatedUnion("outcome", [
  z.strictObject({
    schemaVersion: z.literal("1.0"),
    outcome: z.literal("accepted"),
    task: gameTaskSchema,
  }),
  z.strictObject({
    schemaVersion: z.literal("1.0"),
    outcome: z.literal("rejected"),
    code: z.enum(["illegal-transition", "reason-code-mismatch"]),
    task: gameTaskSchema,
  }),
  z.strictObject({
    schemaVersion: z.literal("1.0"),
    outcome: z.literal("invalid"),
    code: z.literal("invalid-transition-request"),
    task: gameTaskSchema,
  }),
]);

export const createGameTaskResponseSchema = z.strictObject({
  task: gameTaskSchema,
  event: runEventSchema.refine((event) => event.type === "run.started", "Expected run.started event."),
});

export const listGameTasksResponseSchema = z.strictObject({ tasks: z.array(gameTaskSchema).max(100) });

export type CreateGameTaskRequest = z.input<typeof createGameTaskRequestSchema>;
export type ClaimGameTaskRequest = z.infer<typeof claimGameTaskRequestSchema>;
export type ListGameTasksRequest = z.input<typeof listGameTasksRequestSchema>;
export type GameTask = z.infer<typeof gameTaskSchema>;
export type GameTaskReasonCode = z.infer<typeof gameTaskReasonCodeSchema>;
export type GameTaskTransitionRequest = z.infer<typeof gameTaskTransitionRequestSchema>;
export type GameTaskTransitionResult = z.infer<typeof gameTaskTransitionResultSchema>;
export type CreateGameTaskResponse = z.infer<typeof createGameTaskResponseSchema>;

const RETRYABLE_REASON_CODES = [
  "infrastructure-unavailable",
  "rate-limited",
  "unexpected-process-exit",
  "bounded-timeout",
  "browser-startup-failed",
  "evidence-write-interrupted",
  "build-failed",
  "gameplay-failed",
  "browser-diagnostic-failed",
  "task-criterion-failed",
] as const;

const FAILED_REASON_CODES = [
  "schema-violation",
  "security-violation",
  "unchanged-human-rejection",
  "capability-removed",
] as const;
