import { z } from "zod";
import { gameSpecSchema } from "./game-spec.js";

export const projectIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9][a-z0-9._-]*$/, "Project ID contains unsupported characters.");

export const projectGenerationModeSchema = z.enum(["dry-run", "apply"]);

export const projectGenerationRequestSchema = z.strictObject({
  projectId: projectIdSchema,
  spec: gameSpecSchema,
  mode: projectGenerationModeSchema.default("dry-run"),
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
  specSha256: z.string().regex(/^[a-f0-9]{64}$/),
  planSha256: z.string().regex(/^[a-f0-9]{64}$/),
  files: z.array(generatedProjectFileSchema).min(1).max(30),
});

export const projectGenerationResultSchema = z.strictObject({
  mode: projectGenerationModeSchema,
  plan: generatedProjectPlanSchema,
  outputPath: z.string().min(1).optional(),
});

export type ProjectGenerationRequest = z.input<typeof projectGenerationRequestSchema>;
export type GeneratedProjectPlan = z.infer<typeof generatedProjectPlanSchema>;
export type ProjectGenerationResult = z.infer<typeof projectGenerationResultSchema>;
