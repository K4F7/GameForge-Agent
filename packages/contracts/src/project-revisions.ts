import { z } from "zod";
import { gameTaskIdSchema } from "./game-tasks.js";
import { attemptIdSchema, projectIdSchema, revisionIdSchema } from "./project-identifiers.js";
import { taskAcceptanceFingerprintSchema } from "./task-acceptance.js";
import { evidenceAggregateInputSchema, evidenceSubmissionSchema, sealEvidence } from "./evidence.js";
import { runIdSchema } from "./run-events.js";

export { attemptIdSchema, revisionIdSchema } from "./project-identifiers.js";

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

const attemptIdentitySchema = z.strictObject({
  attemptId: attemptIdSchema,
  taskId: gameTaskIdSchema,
  runId: runIdSchema,
  projectId: projectIdSchema,
  revisionId: revisionIdSchema,
  baseRevisionId: revisionIdSchema.optional(),
  acceptanceContractFingerprint: taskAcceptanceFingerprintSchema,
});
type DeepReadonly<T> = T extends ReadonlyArray<infer Item>
  ? ReadonlyArray<DeepReadonly<Item>>
  : T extends object
    ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
    : T;
const immutableEvidenceAggregateInputSchema = evidenceAggregateInputSchema
  .transform((value) => freezeDeep(value));
const immutableEvidenceSubmissionSchema = evidenceSubmissionSchema
  .transform((value) => freezeDeep(value));
const missingCriterionIdsSchema = z.array(
  z.string().trim().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(120),
).min(1).max(100).superRefine((criterionIds, context) => {
  const seen = new Set<string>();
  criterionIds.forEach((criterionId, index) => {
    if (seen.has(criterionId)) {
      context.addIssue({ code: "custom", path: [index], message: "Missing criterion IDs must be unique." });
    }
    seen.add(criterionId);
  });
}).transform((value) => freezeDeep(value));
const sealedEvidenceSchema = evidenceAggregateInputSchema.extend({
  digest: z.string().regex(/^[a-f0-9]{64}$/),
  status: z.literal("sealed"),
}).transform((value) => freezeDeep(value));
export const attemptSchema = z.discriminatedUnion("state", [
  attemptIdentitySchema.extend({ state: z.literal("running") }).readonly(),
  attemptIdentitySchema.extend({
    state: z.literal("incomplete"),
    incompleteReasonCode: z.literal("evidence.missing-required-proof.v1"),
    incompleteEvidence: immutableEvidenceSubmissionSchema,
    missingCriterionIds: missingCriterionIdsSchema.optional(),
  }).readonly(),
  attemptIdentitySchema.extend({
    state: z.literal("passed"),
    sealedDigest: z.string().regex(/^[a-f0-9]{64}$/),
    sealedEvidence: sealedEvidenceSchema,
  }).readonly(),
]).superRefine((attempt, context) => {
  const evidence = attempt.state === "passed"
    ? attempt.sealedEvidence
    : attempt.state === "incomplete"
      ? attempt.incompleteEvidence
      : undefined;
  if (evidence !== undefined) {
    const evidencePath = attempt.state === "passed" ? "sealedEvidence" : "incompleteEvidence";
    for (const key of ["attemptId", "taskId", "runId", "projectId", "revisionId", "acceptanceContractFingerprint"] as const) {
      if (attempt[key] !== evidence[key]) {
        context.addIssue({ code: "custom", path: [evidencePath, key], message: "Attempt and Evidence identities must match." });
      }
    }
    if ((attempt.baseRevisionId ?? null) !== evidence.baseRevisionId) {
      context.addIssue({ code: "custom", path: [evidencePath, "baseRevisionId"], message: "Attempt and Evidence identities must match." });
    }
  }

  if (attempt.state === "incomplete") {
    const complete = evidenceAggregateInputSchema.safeParse(attempt.incompleteEvidence);
    if (complete.success) {
      try {
        const result = sealEvidence(complete.data);
        const submittedCriterionIds = new Set(
          complete.data.criterionResults.map((criterion) => criterion.criterionId),
        );
        if (attempt.missingCriterionIds?.some((criterionId) => submittedCriterionIds.has(criterionId)) === true) {
          context.addIssue({ code: "custom", path: ["missingCriterionIds"], message: "Missing criteria cannot have submitted results." });
        }
        if (result.status === "sealed" && attempt.missingCriterionIds === undefined) {
          context.addIssue({ code: "custom", path: ["missingCriterionIds"], message: "Complete Evidence requires explicit contract-relative criterion gaps to remain incomplete." });
        }
      } catch {
        context.addIssue({ code: "custom", path: ["incompleteEvidence"], message: "Incomplete Attempt Evidence associations and integrity must be valid." });
      }
    }
  }

  if (attempt.state === "passed") {
    if (attempt.sealedDigest !== attempt.sealedEvidence.digest) {
      context.addIssue({ code: "custom", path: ["sealedDigest"], message: "Passed Attempt sealed digests must match." });
    }
    const { digest: _digest, status: _status, ...aggregate } = attempt.sealedEvidence;
    try {
      const validation = sealEvidence(aggregate);
      if (validation.status !== "sealed" || validation.evidence.digest !== attempt.sealedEvidence.digest) {
        context.addIssue({ code: "custom", path: ["sealedEvidence"], message: "Passed Attempt requires complete sealed proof with a matching digest." });
      }
    } catch {
      context.addIssue({ code: "custom", path: ["sealedEvidence"], message: "Passed Attempt requires complete sealed proof with a matching digest." });
    }
  }
});

export type CreateProjectInput = z.infer<typeof createProjectInputSchema>;
export type Project = z.infer<typeof projectSchema>;
export type CreateCandidateRevisionInput = z.infer<typeof createCandidateRevisionInputSchema>;
export type CandidateRevision = z.infer<typeof candidateRevisionSchema>;
export type CandidateAcceptanceValidity = z.infer<typeof candidateAcceptanceValiditySchema>;
export type StartAttemptInput = z.infer<typeof startAttemptInputSchema>;
export type RetryAttemptInput = z.infer<typeof retryAttemptInputSchema>;
export type Attempt = z.infer<typeof attemptSchema>;

function freezeDeep<T>(value: T): DeepReadonly<T> {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value as Record<string, unknown>).forEach(freezeDeep);
    Object.freeze(value);
  }
  return value as DeepReadonly<T>;
}
