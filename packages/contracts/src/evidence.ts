import { createHash } from "node:crypto";
import { z } from "zod";
import { bundleBudgetIssues, webGameBundleLimits } from "./bundle-budget.js";
import { gameTaskIdSchema } from "./game-tasks.js";
import { attemptIdSchema, projectIdSchema, revisionIdSchema } from "./project-identifiers.js";
import { mcpToolAuditSchema } from "./mcp-audit.js";
import { candidateContentManifestSchema } from "./project-generation.js";
import {
  attemptBuildEvidenceSchema,
  attemptVersionEvidenceSchema,
  runEventSchema,
  runIdSchema,
  verificationEvidencePathSchema,
} from "./run-events.js";
import { taskAcceptanceFingerprintSchema } from "./task-acceptance.js";

const digestSchema = z.string().regex(/^[a-f0-9]{64}$/);
// Keeps one complete submission bounded while leaving durable storage room for
// both its authoritative Run history and its immutable Attempt copy.
export const evidenceSubmissionMaxBytes = 16 * 1024 * 1024;
const criterionResultsSchema = z.array(z.strictObject({
  criterionId: z.string().trim().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(120),
  passed: z.boolean(),
})).max(100).superRefine((results, context) => {
  const seen = new Set<string>();
  results.forEach((result, index) => {
    if (seen.has(result.criterionId)) {
      context.addIssue({ code: "custom", path: [index, "criterionId"], message: "Criterion result IDs must be unique." });
    }
    seen.add(result.criterionId);
  });
});

export const evidenceAggregateInputSchema = z.strictObject({
  attemptId: attemptIdSchema,
  taskId: gameTaskIdSchema,
  runId: runIdSchema,
  projectId: projectIdSchema,
  baseRevisionId: revisionIdSchema.nullable(),
  revisionId: revisionIdSchema,
  acceptanceContractFingerprint: taskAcceptanceFingerprintSchema,
  criterionResults: criterionResultsSchema,
  request: z.strictObject({ normalized: z.string().trim().min(1).max(100_000), fingerprint: taskAcceptanceFingerprintSchema }),
  codeArts: z.strictObject({ attemptId: attemptIdSchema, target: z.string().trim().min(1).max(120), clientVersion: z.string().trim().min(1).max(120), durationMs: z.number().int().nonnegative(), interventions: z.array(z.string().trim().min(1).max(2_000)).max(100) }),
  mcpAudit: mcpToolAuditSchema.extend({ attemptId: attemptIdSchema }),
  artifacts: candidateContentManifestSchema.optional(),
  build: attemptBuildEvidenceSchema,
  browserProof: z.strictObject({
    attemptId: attemptIdSchema,
    projectId: projectIdSchema,
    revisionId: revisionIdSchema,
    passed: z.boolean(),
    actions: z.array(z.string().trim().min(1).max(2_000)).min(1).max(10_000),
    outcome: z.enum(["running", "won", "lost"]),
    diagnostics: z.array(z.string().trim().min(1).max(4_096)).max(256),
    screenshots: z.array(verificationEvidencePathSchema).max(1),
    screenshotSha256: digestSchema,
  }),
  authorityEvents: z.array(z.strictObject({ attemptId: attemptIdSchema, event: runEventSchema })).max(100_000),
  versions: attemptVersionEvidenceSchema,
});

const evidenceSubmissionBaseSchema = evidenceAggregateInputSchema.partial({
  criterionResults: true,
  codeArts: true,
  mcpAudit: true,
  artifacts: true,
  build: true,
  browserProof: true,
  authorityEvents: true,
  versions: true,
});
export const evidenceSubmissionSchema = evidenceSubmissionBaseSchema.superRefine((submission, context) => {
  if (new TextEncoder().encode(JSON.stringify(submission)).byteLength > evidenceSubmissionMaxBytes) {
    context.addIssue({ code: "custom", message: "Evidence submission exceeds its byte limit." });
  }
  try {
    validatePresentEvidence(submission);
  } catch (error) {
    context.addIssue({
      code: "custom",
      message: error instanceof Error ? error.message : "Present Evidence is invalid.",
    });
  }
});

export type EvidenceAggregateInput = z.infer<typeof evidenceAggregateInputSchema>;
export type EvidenceSubmission = z.infer<typeof evidenceSubmissionSchema>;
export type EvidenceIncompleteReasonCode = "evidence.missing-required-proof.v1";
type DeepReadonly<T> = T extends ReadonlyArray<infer Item>
  ? ReadonlyArray<DeepReadonly<Item>>
  : T extends object
    ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
    : T;
export type SealedEvidence = DeepReadonly<EvidenceAggregateInput & { digest: string; status: "sealed" }>;
export type EvidenceSealResult =
  | { status: "sealed"; evidence: SealedEvidence }
  | { status: "incomplete"; reasonCode: EvidenceIncompleteReasonCode; attemptId: string };
const evidenceSealResultWireSchema = z.discriminatedUnion("status", [
  z.strictObject({
    status: z.literal("incomplete"),
    reasonCode: z.literal("evidence.missing-required-proof.v1"),
    attemptId: attemptIdSchema,
  }),
  z.strictObject({
    status: z.literal("sealed"),
    evidence: evidenceAggregateInputSchema.extend({
      digest: digestSchema,
      status: z.literal("sealed"),
    }),
  }),
]);
export const evidenceSealResultSchema = evidenceSealResultWireSchema.transform((result): EvidenceSealResult => {
  if (result.status === "incomplete") return freezeDeep(result);
  const { digest, status: _status, ...input } = result.evidence;
  const resealed = sealEvidence(input);
  if (resealed.status !== "sealed" || resealed.evidence.digest !== digest) {
    throw new Error("Sealed Evidence digest does not match its aggregate payload.");
  }
  return freezeDeep(resealed);
});

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function freezeDeep<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value as Record<string, unknown>).forEach(freezeDeep);
    Object.freeze(value);
  }
  return value;
}

export function sealEvidence(input: EvidenceAggregateInput | DeepReadonly<EvidenceAggregateInput>): EvidenceSealResult {
  const parsed = evidenceAggregateInputSchema.parse(input);
  validatePresentEvidence(parsed);
  const expectedBuildIssues = bundleBudgetIssues(parsed.build.report.metrics, webGameBundleLimits);
  const missing = parsed.mcpAudit.truncated || parsed.mcpAudit.calls.length === 0 || parsed.artifacts === undefined || parsed.build.exitCode !== 0 || parsed.build.report.metrics.files.length === 0 || parsed.build.report.metrics.total.raw === 0 || expectedBuildIssues.length > 0 || parsed.criterionResults.length === 0 || parsed.criterionResults.some((result) => !result.passed) || !parsed.browserProof.passed || parsed.browserProof.outcome !== "won" || parsed.browserProof.diagnostics.length > 0 || parsed.browserProof.screenshots.length === 0 || parsed.authorityEvents.length === 0;
  if (missing) return { status: "incomplete", reasonCode: "evidence.missing-required-proof.v1", attemptId: parsed.attemptId };

  const digest = createHash("sha256").update(stableJson(parsed), "utf8").digest("hex");
  const evidence = freezeDeep({ ...parsed, digest, status: "sealed" }) as SealedEvidence;
  return { status: "sealed", evidence };
}

function validatePresentEvidence(parsed: z.infer<typeof evidenceSubmissionBaseSchema>): void {
  const expectedRequestFingerprint = createHash("sha256").update(parsed.request.normalized, "utf8").digest("hex");
  if (parsed.request.fingerprint !== expectedRequestFingerprint) {
    throw new Error("Request fingerprint does not match normalized request.");
  }
  const nestedAttemptIds = [
    parsed.mcpAudit?.attemptId,
    parsed.codeArts?.attemptId,
    parsed.artifacts?.attemptId,
    parsed.build?.attemptId,
    parsed.browserProof?.attemptId,
    parsed.versions?.attemptId,
    ...(parsed.authorityEvents ?? []).flatMap(({ attemptId, event }) => [
      attemptId,
      "attemptId" in event ? event.attemptId : undefined,
    ]),
  ].filter((id): id is string => id !== undefined);
  if (nestedAttemptIds.some((id) => id !== parsed.attemptId)) {
    throw new Error("Evidence records must belong to the same Attempt.");
  }
  if (parsed.artifacts !== undefined &&
      (parsed.artifacts.projectId !== parsed.projectId || parsed.artifacts.revisionId !== parsed.revisionId)) {
    throw new Error("Artifact manifest does not belong to the same Project and Revision.");
  }
  if (parsed.browserProof !== undefined &&
      (parsed.browserProof.projectId !== parsed.projectId || parsed.browserProof.revisionId !== parsed.revisionId)) {
    throw new Error("Browser proof must belong to the same Attempt, Project, and Revision.");
  }
  if (parsed.mcpAudit !== undefined &&
      (parsed.mcpAudit.context?.taskId !== parsed.taskId || parsed.mcpAudit.context.attemptId !== parsed.attemptId)) {
    throw new Error("Evidence records must belong to the same Task.");
  }
  if ((parsed.mcpAudit !== undefined && parsed.mcpAudit.context?.runId !== parsed.runId) ||
      parsed.authorityEvents?.some(({ event }, index) => event.runId !== parsed.runId || event.sequence !== index + 1) === true) {
    throw new Error("Evidence records must belong to the same Run.");
  }

  if (parsed.artifacts !== undefined) {
    const expectedArtifactAggregate = createHash("sha256").update(JSON.stringify(parsed.artifacts.files), "utf8").digest("hex");
    const expectedArtifactBytes = parsed.artifacts.files.reduce((total, file) => total + file.bytes, 0);
    if (parsed.artifacts.aggregateSha256 !== expectedArtifactAggregate || parsed.artifacts.totalBytes !== expectedArtifactBytes) {
      throw new Error("Artifact aggregate does not match its file records.");
    }
  }

  if (parsed.build !== undefined) {
    const expectedBuildIssues = bundleBudgetIssues(parsed.build.report.metrics, webGameBundleLimits);
    if (JSON.stringify(parsed.build.report.limits) !== JSON.stringify(webGameBundleLimits) ||
        JSON.stringify(parsed.build.report.issues) !== JSON.stringify(expectedBuildIssues)) {
      throw new Error("Build report does not match authoritative limits and measurements.");
    }
  }
}
