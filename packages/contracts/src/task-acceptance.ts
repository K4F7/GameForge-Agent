import { z } from "zod";

export const taskAcceptanceFingerprintSchema = z
  .string()
  .regex(/^[a-f0-9]{64}$/, "Acceptance fingerprint must be a lowercase SHA-256 digest.");

const criterionTextSchema = z.string().trim().min(1).max(2_000);
const locatorSchema = z.string().trim().min(1).max(500);

export const taskAcceptanceVerificationSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("browser-action"), action: locatorSchema }),
  z.strictObject({ kind: z.literal("public-telemetry"), path: locatorSchema }),
  z.strictObject({ kind: z.literal("dom-output"), selector: locatorSchema }),
  z.strictObject({ kind: z.literal("screenshot"), checkpoint: locatorSchema }),
  z.strictObject({ kind: z.literal("human-review"), prompt: criterionTextSchema }),
]);

export const taskAcceptanceCriterionSchema = z.strictObject({
  criterionId: z.string().trim().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(120),
  sourceRequirement: criterionTextSchema,
  expected: criterionTextSchema,
  verification: taskAcceptanceVerificationSchema,
});

export const taskAcceptanceRequirementIssueSchema = z.strictObject({
  code: z.enum(["missing", "conflicting", "unverifiable", "assumption-dependent"]),
  detail: criterionTextSchema,
});

export const compileTaskAcceptanceContractInputSchema = z.strictObject({
  contractVersion: z.number().int().positive().max(1_000_000),
  criteria: z.array(taskAcceptanceCriterionSchema).max(100),
  requirementIssues: z.array(taskAcceptanceRequirementIssueSchema).max(100).default([]),
});

export const taskAcceptanceContractSchema = z.strictObject({
  schemaVersion: z.literal("1.0"),
  contractVersion: z.number().int().positive().max(1_000_000),
  criteria: z.array(taskAcceptanceCriterionSchema).min(1).max(100),
  fingerprint: taskAcceptanceFingerprintSchema,
}).readonly();

export type CompileTaskAcceptanceContractInput = z.input<typeof compileTaskAcceptanceContractInputSchema>;
export type TaskAcceptanceContract = z.infer<typeof taskAcceptanceContractSchema>;
export type TaskAcceptanceRequirementIssue = z.infer<typeof taskAcceptanceRequirementIssueSchema>;
