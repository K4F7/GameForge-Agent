import { z } from "zod";
import { runEventSchema, runIdSchema } from "./run-events.js";

export const gameTaskIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .regex(/^task-[a-f0-9-]{36}$/, "Task ID is invalid.");

export const gameTaskPromptSchema = z.string().trim().min(10).max(12_000);
export const gameTaskLanguageSchema = z.enum(["zh-CN", "en-US"]);
export const gameTaskStatusSchema = z.enum(["queued", "claimed", "completed", "failed", "stopped"]);
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
});

export const claimGameTaskRequestSchema = z.strictObject({ agentId: gameTaskAgentIdSchema });

export const listGameTasksRequestSchema = z.strictObject({
  status: gameTaskStatusSchema.optional(),
  limit: z.number().int().min(1).max(100).default(20),
});

export const gameTaskSchema = z.strictObject({
  taskId: gameTaskIdSchema,
  runId: runIdSchema,
  prompt: gameTaskPromptSchema,
  language: gameTaskLanguageSchema,
  status: gameTaskStatusSchema,
  createdAt: z.string().datetime({ offset: true }),
  claimedAt: z.string().datetime({ offset: true }).optional(),
  claimedBy: gameTaskAgentIdSchema.optional(),
  completedAt: z.string().datetime({ offset: true }).optional(),
}).superRefine((task, context) => {
  const claimed = task.claimedAt !== undefined || task.claimedBy !== undefined;
  if ((task.claimedAt === undefined) !== (task.claimedBy === undefined)) {
    context.addIssue({ code: "custom", path: ["claimedBy"], message: "Claim metadata must be complete." });
  }
  if ((task.status === "claimed" || task.status === "completed" || task.status === "failed") && !claimed) {
    context.addIssue({ code: "custom", path: ["status"], message: "Claimed tasks require claim metadata." });
  }
  const terminal = task.status === "completed" || task.status === "failed" || task.status === "stopped";
  if (terminal !== (task.completedAt !== undefined)) {
    context.addIssue({ code: "custom", path: ["completedAt"], message: "Terminal task timestamp is inconsistent." });
  }
  if (task.status === "queued" && claimed) {
    context.addIssue({ code: "custom", path: ["status"], message: "Queued tasks cannot contain claim metadata." });
  }
});

export const createGameTaskResponseSchema = z.strictObject({
  task: gameTaskSchema,
  event: runEventSchema.refine((event) => event.type === "run.started", "Expected run.started event."),
});

export const listGameTasksResponseSchema = z.strictObject({ tasks: z.array(gameTaskSchema).max(100) });

export type CreateGameTaskRequest = z.input<typeof createGameTaskRequestSchema>;
export type ClaimGameTaskRequest = z.infer<typeof claimGameTaskRequestSchema>;
export type ListGameTasksRequest = z.input<typeof listGameTasksRequestSchema>;
export type GameTask = z.infer<typeof gameTaskSchema>;
export type CreateGameTaskResponse = z.infer<typeof createGameTaskResponseSchema>;
