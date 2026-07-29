import { z } from "zod";

export const taskAcceptanceFingerprintSchema = z
  .string()
  .regex(/^[a-f0-9]{64}$/, "Acceptance fingerprint must be a lowercase SHA-256 digest.");

const criterionTextSchema = z.string().trim().min(1).max(2_000);
const locatorSchema = z.string().trim().min(1).max(500);
const assertionValueSchema = z.union([z.string().max(2_000), z.number().finite(), z.boolean(), z.null()]);
const taskAcceptanceAssertionSchema = z.strictObject({
  schemaVersion: z.literal(1),
  comparator: z.enum(["equals", "includes", "changed-to"]),
  value: assertionValueSchema,
}).superRefine((assertion, context) => {
  if (assertion.comparator === "includes" &&
      (typeof assertion.value !== "string" || assertion.value.length === 0)) {
    context.addIssue({ code: "custom", path: ["value"], message: "Includes assertions require a non-empty string value." });
  }
});

const publicTelemetryExpectationSchema = z.strictObject({
  kind: z.literal("public-telemetry"),
  path: locatorSchema,
  assertion: taskAcceptanceAssertionSchema,
});
const domOutputExpectationSchema = z.strictObject({
  kind: z.literal("dom-output"),
  selector: locatorSchema,
  assertion: taskAcceptanceAssertionSchema,
});
const observableEffectSchema = z.discriminatedUnion("kind", [
  publicTelemetryExpectationSchema,
  domOutputExpectationSchema,
]);

export const taskAcceptanceVerificationSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("browser-action"), action: locatorSchema, observableEffect: observableEffectSchema }),
  publicTelemetryExpectationSchema,
  domOutputExpectationSchema,
  z.strictObject({ kind: z.literal("screenshot"), checkpoint: locatorSchema }),
  z.strictObject({ kind: z.literal("human-review"), prompt: criterionTextSchema }),
]);

export const taskAcceptanceCriterionSchema = z.strictObject({
  criterionId: z.string().trim().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(120),
  sourceRequirement: criterionTextSchema,
  expected: criterionTextSchema,
  applicableScenarios: z.array(z.enum(["won", "lost"])).min(1).max(2).optional(),
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
