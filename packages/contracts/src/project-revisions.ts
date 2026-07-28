import { z } from "zod";
import { projectIdSchema } from "./project-generation.js";

export const revisionIdSchema = z
  .string()
  .trim()
  .regex(
    /^revision-[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/,
    "Revision ID is invalid.",
  );

export const createProjectInputSchema = z.strictObject({});

export const projectSchema = z.strictObject({
  projectId: projectIdSchema,
  currentRevisionId: revisionIdSchema.nullable(),
}).readonly();

export const createCandidateRevisionInputSchema = z.strictObject({
  projectId: projectIdSchema,
});

export const candidateRevisionSchema = z.strictObject({
  projectId: projectIdSchema,
  revisionId: revisionIdSchema,
  state: z.literal("candidate"),
}).readonly();

export type CreateProjectInput = z.infer<typeof createProjectInputSchema>;
export type Project = z.infer<typeof projectSchema>;
export type CreateCandidateRevisionInput = z.infer<typeof createCandidateRevisionInputSchema>;
export type CandidateRevision = z.infer<typeof candidateRevisionSchema>;
