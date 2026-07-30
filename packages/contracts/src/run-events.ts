import { z } from "zod";
import { gameSpecSchema } from "./game-spec.js";
import {
  candidateContentManifestSchema,
  generatedProjectPlanSchema,
  projectIdSchema,
  projectUpdateSummarySchema,
} from "./project-generation.js";
import { runtimeAssetEntrySchema } from "./runtime-assets.js";
import { assetIdSchema } from "./assets.js";
import { signedJobHandleSchema } from "./providers.js";
import { gameforgeCapabilitySnapshotSchema } from "./capabilities.js";
import { attemptIdSchema, revisionIdSchema } from "./project-identifiers.js";
import { bundleBudgetReportSchema } from "./bundle-budget.js";

export const runIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/, "Run ID contains unsupported characters.");

export const runPhaseSchema = z.enum([
  "spec",
  "template",
  "assets",
  "code",
  "build",
  "test",
  "visual",
]);

export const runStatusSchema = z.enum([
  "idle",
  "running",
  "repair",
  "succeeded",
  "failed",
  "stopped",
]);

export const runLogSourceSchema = z.enum(["agent", "tool", "build", "test", "visual"]);
export const runLogLevelSchema = z.enum(["info", "success", "warning", "error"]);

export const gamePreviewUrlSchema = z.string().trim().max(2_048).url().superRefine((value, context) => {
  const url = new URL(value);
  const isLoopbackHttp = url.protocol === "http:" &&
    (url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "[::1]");
  if (url.protocol !== "https:" && !isLoopbackHttp) {
    context.addIssue({ code: "custom", message: "Preview URL must use HTTPS or loopback HTTP." });
  }
  if (url.username.length > 0 || url.password.length > 0) {
    context.addIssue({ code: "custom", message: "Preview URL must not contain credentials." });
  }
  if (url.hash.length > 0) {
    context.addIssue({ code: "custom", message: "Preview URL must not contain a fragment." });
  }
});

export const verificationEvidencePathSchema = z.string().regex(
  /^\.gameforge\/verification\/[a-zA-Z0-9._-]+\.png$/,
  "Verification evidence must be a project-relative PNG path.",
);
export const verificationDiagnosticMessageLimit = 256;

export const attemptBuildEvidenceSchema = z.strictObject({
  attemptId: attemptIdSchema,
  command: z.literal("vite.build"),
  exitCode: z.literal(0),
  report: bundleBudgetReportSchema,
});

export const attemptVersionEvidenceSchema = z.strictObject({
  attemptId: attemptIdSchema,
  contractVersion: z.number().int().positive().max(1_000_000),
  templateVersion: z.string().regex(/^\d+\.\d+\.\d+$/),
});
export type AttemptBuildEvidence = z.infer<typeof attemptBuildEvidenceSchema>;
export type AttemptVersionEvidence = z.infer<typeof attemptVersionEvidenceSchema>;

const verificationDiagnosticCountsSchema = z.strictObject({
  consoleErrors: z.number().int().min(0).max(100),
  pageErrors: z.number().int().min(0).max(100),
  failedRequests: z.number().int().min(0).max(100),
});

const verificationCriterionResultSchema = z.strictObject({
  criterionId: z.string().trim().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(120),
  passed: z.boolean(),
});
const verificationCriteriaSchema = z.array(verificationCriterionResultSchema).max(100).superRefine((criteria, context) => {
  const seen = new Set<string>();
  criteria.forEach((criterion, index) => {
    if (seen.has(criterion.criterionId)) {
      context.addIssue({ code: "custom", path: [index, "criterionId"], message: "Criterion IDs must be unique." });
    }
    seen.add(criterion.criterionId);
  });
});

const mcpAuditCallSummarySchema = z.strictObject({
  sequence: z.number().int().positive().max(10_000),
  tool: z.string().min(1).max(120).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/),
  durationMs: z.number().int().nonnegative().max(86_400_000),
  outcome: z.enum(["success", "error"]),
});
const sha256DigestSchema = z.string().regex(/^[a-f0-9]{64}$/);

const eventBaseShape = {
  runId: runIdSchema,
  sequence: z.number().int().positive(),
  emittedAt: z.string().datetime({ offset: true }),
};

const runEventSchemaBase = z.discriminatedUnion("type", [
  z.strictObject({
    ...eventBaseShape,
    type: z.literal("run.started"),
    language: z.enum(["zh-CN", "en-US"]).optional(),
  }),
  z.strictObject({ ...eventBaseShape, type: z.literal("run.stopped") }),
  z.strictObject({ ...eventBaseShape, type: z.literal("run.completed") }),
  z.strictObject({
    ...eventBaseShape,
    type: z.literal("spec.ready"),
    spec: gameSpecSchema,
  }),
  z.strictObject({
    ...eventBaseShape,
    type: z.literal("capabilities.ready"),
    snapshot: gameforgeCapabilitySnapshotSchema,
  }),
  z.strictObject({
    ...eventBaseShape,
    type: z.literal("asset.ready"),
    projectId: projectIdSchema,
    manifestRevision: z.number().int().positive(),
    entry: runtimeAssetEntrySchema,
  }),
  z.strictObject({
    ...eventBaseShape,
    type: z.literal("project.generated"),
    attemptId: attemptIdSchema.optional(),
    revisionId: revisionIdSchema.optional(),
    mode: z.enum(["dry-run", "apply"]),
    operation: z.enum(["create", "update"]),
    plan: generatedProjectPlanSchema,
    update: projectUpdateSummarySchema.optional(),
    candidate: candidateContentManifestSchema.optional(),
  }),
  z.strictObject({
    ...eventBaseShape,
    type: z.literal("mcp.audit.ready"),
    attemptId: attemptIdSchema.optional(),
    auditDigest: sha256DigestSchema.optional(),
    truncated: z.boolean(),
    totalCalls: z.number().int().nonnegative().max(10_000),
    calls: z.array(mcpAuditCallSummarySchema).max(10_000),
  }),
  z.strictObject({
    ...eventBaseShape,
    type: z.literal("preview.ready"),
    projectId: projectIdSchema,
    url: gamePreviewUrlSchema,
  }),
  z.strictObject({
    ...eventBaseShape,
    type: z.literal("verification.ready"),
    attemptId: attemptIdSchema.optional(),
    revisionId: revisionIdSchema.optional(),
    projectId: projectIdSchema,
    passed: z.boolean(),
    outcome: z.enum(["running", "won", "lost"]),
    score: z.number().int().nonnegative(),
    lives: z.number().int(),
    remainingSeconds: z.number().nonnegative(),
    evidencePath: verificationEvidencePathSchema,
    evidenceSha256: sha256DigestSchema,
    canvas: z.strictObject({
      width: z.number().int().positive().max(16_384),
      height: z.number().int().positive().max(16_384),
    }),
    diagnostics: verificationDiagnosticCountsSchema,
    actionsExecuted: z.number().int().min(0).max(100),
    durationMs: z.number().int().nonnegative().max(300_000),
    actions: z.array(z.string().trim().min(1).max(2_000)).max(100).optional(),
    diagnosticMessages: z.array(z.string().trim().min(1).max(4_096)).max(verificationDiagnosticMessageLimit).optional(),
    evidencePaths: z.array(verificationEvidencePathSchema).max(1).optional(),
    criteria: verificationCriteriaSchema.optional(),
    build: attemptBuildEvidenceSchema.optional(),
    versions: attemptVersionEvidenceSchema.optional(),
  }),
  z.strictObject({
    ...eventBaseShape,
    type: z.literal("voice.job.updated"),
    projectId: projectIdSchema,
    assetId: assetIdSchema,
    jobHandle: signedJobHandleSchema,
    status: z.enum(["processing", "succeeded", "failed"]),
  }),
  z.strictObject({
    ...eventBaseShape,
    type: z.literal("phase.started"),
    phase: runPhaseSchema,
    detail: z.string().trim().min(1).max(1_000),
  }),
  z.strictObject({
    ...eventBaseShape,
    type: z.literal("phase.failed"),
    phase: runPhaseSchema,
    message: z.string().trim().min(1).max(2_000),
    repairable: z.boolean(),
  }),
  z.strictObject({
    ...eventBaseShape,
    type: z.literal("phase.completed"),
    phase: runPhaseSchema,
    detail: z.string().trim().min(1).max(1_000),
  }),
  z.strictObject({
    ...eventBaseShape,
    type: z.literal("log.appended"),
    source: runLogSourceSchema,
    level: runLogLevelSchema,
    message: z.string().trim().min(1).max(4_000),
  }),
]);
export const runEventSchema = runEventSchemaBase.superRefine((event, context) => {
  if (event.type !== "verification.ready" || !event.passed) return;
  if (event.diagnostics.consoleErrors > 0 || event.diagnostics.pageErrors > 0 ||
      event.diagnostics.failedRequests > 0 || (event.diagnosticMessages?.length ?? 0) > 0) {
    context.addIssue({
      code: "custom",
      path: ["passed"],
      message: "Successful verification cannot report diagnostic failures.",
    });
  }
});

export type WireRunEvent = z.infer<typeof runEventSchema>;
export type RunEvent = WireRunEvent extends infer Event
  ? Event extends { emittedAt: string }
    ? Omit<Event, "emittedAt">
    : never
  : never;
export type RunPhase = z.infer<typeof runPhaseSchema>;
export type RunStatus = z.infer<typeof runStatusSchema>;

export const runEventBatchSchema = z
  .strictObject({
    runId: runIdSchema,
    after: z.number().int().nonnegative(),
    events: z.array(runEventSchema).max(1_000),
  })
  .superRefine((batch, context) => {
    batch.events.forEach((event, index) => {
      if (event.runId !== batch.runId) {
        context.addIssue({
          code: "custom",
          path: ["events", index, "runId"],
          message: "Event run ID must match the batch run ID.",
        });
      }

      const expectedSequence = batch.after + index + 1;
      if (event.sequence !== expectedSequence) {
        context.addIssue({
          code: "custom",
          path: ["events", index, "sequence"],
          message: `Expected contiguous sequence ${expectedSequence}.`,
        });
      }
    });
  });

export type RunEventBatch = z.infer<typeof runEventBatchSchema>;

export const replayRunEventsRequestSchema = z.strictObject({
  runId: runIdSchema,
  after: z.number().int().nonnegative().default(0),
});

export type ReplayRunEventsRequest = z.infer<typeof replayRunEventsRequestSchema>;

export function toRunEvent(event: WireRunEvent): RunEvent {
  const { emittedAt: _emittedAt, ...payload } = event;
  return payload;
}
