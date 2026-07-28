import { z } from "zod";
import { gameTaskIdSchema } from "./game-tasks.js";
import { projectIdSchema } from "./project-generation.js";
import { taskAcceptanceFingerprintSchema } from "./task-acceptance.js";

export const revisionIdSchema = z
  .string()
  .trim()
  .regex(
    /^revision-[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/,
    "Revision ID is invalid.",
  );

export const attemptIdSchema = z
  .string()
  .trim()
  .regex(
    /^attempt-[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/,
    "Attempt ID is invalid.",
  );

export const createProjectInputSchema = z.strictObject({});

export const projectSchema = z.strictObject({
  projectId: projectIdSchema,
  currentRevisionId: revisionIdSchema.nullable(),
}).readonly();

export const createCandidateRevisionInputSchema = z.strictObject({
  projectId: projectIdSchema,
  taskId: gameTaskIdSchema,
});

export const candidateRevisionSchema = z.strictObject({
  projectId: projectIdSchema,
  taskId: gameTaskIdSchema,
  revisionId: revisionIdSchema,
  state: z.literal("candidate"),
  acceptanceContractFingerprint: taskAcceptanceFingerprintSchema,
}).readonly();

export const candidateAcceptanceValiditySchema = z.strictObject({
  revisionId: revisionIdSchema,
  taskId: gameTaskIdSchema,
  acceptanceContractFingerprint: taskAcceptanceFingerprintSchema,
  valid: z.boolean(),
}).readonly();

export const startAttemptInputSchema = z.strictObject({
  taskId: gameTaskIdSchema,
  projectId: projectIdSchema,
});

export const retryAttemptInputSchema = z.strictObject({
  attemptId: attemptIdSchema,
});

export const attemptSchema = z.strictObject({
  attemptId: attemptIdSchema,
  taskId: gameTaskIdSchema,
  projectId: projectIdSchema,
  revisionId: revisionIdSchema,
  baseRevisionId: revisionIdSchema.optional(),
  acceptanceContractFingerprint: taskAcceptanceFingerprintSchema,
  state: z.literal("running"),
}).readonly();

export type CreateProjectInput = z.infer<typeof createProjectInputSchema>;
export type Project = z.infer<typeof projectSchema>;
export type CreateCandidateRevisionInput = z.infer<typeof createCandidateRevisionInputSchema>;
export type CandidateRevision = z.infer<typeof candidateRevisionSchema>;
export type CandidateAcceptanceValidity = z.infer<typeof candidateAcceptanceValiditySchema>;
export type StartAttemptInput = z.infer<typeof startAttemptInputSchema>;
export type RetryAttemptInput = z.infer<typeof retryAttemptInputSchema>;
export type Attempt = z.infer<typeof attemptSchema>;
