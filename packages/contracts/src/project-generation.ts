import { z } from "zod";
import { gameSpecSchema } from "./game-spec.js";
import { attemptIdSchema, projectIdSchema, revisionIdSchema } from "./project-identifiers.js";

export { projectIdSchema } from "./project-identifiers.js";

export const projectGenerationModeSchema = z.enum(["dry-run", "apply"]);
export const projectGenerationOperationSchema = z.enum(["create", "update"]);
export const gamePlatformTargetSchema = z.enum(["web"]);

export const projectGenerationRequestSchema = z.strictObject({
  projectId: projectIdSchema,
  spec: gameSpecSchema,
  mode: projectGenerationModeSchema.default("dry-run"),
  operation: projectGenerationOperationSchema.default("create"),
  target: gamePlatformTargetSchema.default("web"),
  expectedPlanSha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  attemptId: attemptIdSchema,
  revisionId: revisionIdSchema,
});

export const generatedProjectFileSchema = z.strictObject({
  path: z.string().regex(
    /^(?:\.npmrc|\.gameforge\/manifest\.json|(?:[a-z0-9][a-z0-9._-]*\/)*[a-z0-9][a-z0-9._-]*)$/i,
    "Generated file path must be normalized and relative.",
  ),
  bytes: z.number().int().nonnegative().max(2 * 1024 * 1024),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
});

export const generatedProjectPlanSchema = z.strictObject({
  generatorVersion: z.string().regex(/^\d+\.\d+\.\d+$/),
  projectId: projectIdSchema,
  target: gamePlatformTargetSchema.default("web"),
  specSha256: z.string().regex(/^[a-f0-9]{64}$/),
  planSha256: z.string().regex(/^[a-f0-9]{64}$/),
  files: z.array(generatedProjectFileSchema).min(1).max(30),
});

export const managedGeneratedProjectManifestSchema = z.strictObject({
  schemaVersion: z.literal("1.0"),
  generatorVersion: z.string().regex(/^\d+\.\d+\.\d+$/),
  projectId: projectIdSchema,
  target: gamePlatformTargetSchema.default("web"),
  specSha256: z.string().regex(/^[a-f0-9]{64}$/),
  planSha256: z.string().regex(/^[a-f0-9]{64}$/),
  files: z.array(generatedProjectFileSchema).min(1).max(30),
});

export const candidateContentFileSchema = z.strictObject({
  path: z.string().min(1).max(512).refine(
    (value) => !value.includes("\\") && value.split("/").every((segment) => segment !== "" && segment !== "." && segment !== ".."),
    "Candidate file path must be normalized and relative.",
  ),
  bytes: z.number().int().nonnegative().max(20 * 1024 * 1024),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
});

export const candidateContentManifestSchema = z.strictObject({
  schemaVersion: z.literal(1),
  projectId: projectIdSchema,
  attemptId: attemptIdSchema,
  revisionId: revisionIdSchema,
  totalBytes: z.number().int().nonnegative().max(20 * 1024 * 1024),
  aggregateSha256: z.string().regex(/^[a-f0-9]{64}$/),
  files: z.array(candidateContentFileSchema).min(1).max(4_096),
});

export const projectUpdateSummarySchema = z.strictObject({
  currentPlanSha256: z.string().regex(/^[a-f0-9]{64}$/),
  updatedPaths: z.array(generatedProjectFileSchema.shape.path).max(30),
  unchangedPaths: z.array(generatedProjectFileSchema.shape.path).max(30),
  preservedPaths: z.array(generatedProjectFileSchema.shape.path).max(30),
  deletedPaths: z.array(generatedProjectFileSchema.shape.path).max(30),
  conflicts: z.array(generatedProjectFileSchema.shape.path).max(30),
});

export const projectGenerationResultSchema = z.strictObject({
  mode: projectGenerationModeSchema,
  operation: projectGenerationOperationSchema,
  plan: generatedProjectPlanSchema,
  outputPath: z.string().min(1).optional(),
  update: projectUpdateSummarySchema.optional(),
  candidate: candidateContentManifestSchema.optional(),
});

export type ProjectGenerationRequest = z.input<typeof projectGenerationRequestSchema>;
export type GamePlatformTarget = z.infer<typeof gamePlatformTargetSchema>;
export type GeneratedProjectPlan = z.infer<typeof generatedProjectPlanSchema>;
export type ProjectGenerationResult = z.infer<typeof projectGenerationResultSchema>;
export type ManagedGeneratedProjectManifest = z.infer<typeof managedGeneratedProjectManifestSchema>;
export type ProjectUpdateSummary = z.infer<typeof projectUpdateSummarySchema>;
export type CandidateContentManifest = z.infer<typeof candidateContentManifestSchema>;
