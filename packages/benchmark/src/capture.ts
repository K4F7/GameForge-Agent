import {
  mcpToolAuditSchema,
  type McpToolAudit,
  type GameTask,
  type ReplayRunEventsRequest,
  type RunEventBatch,
  type WireRunEvent,
} from "@gameforge/contracts";
import { createHash } from "node:crypto";
import { z } from "zod";
import {
  benchmarkClientSchema,
  benchmarkDefinitionSchema,
  benchmarkFailureSchema,
  benchmarkFailureForReasonCode,
  benchmarkRecordSchema,
  fingerprintDefinition,
  toolSummarySchema,
  type BenchmarkDefinition,
  type BenchmarkRecord,
} from "./schema.js";

const safeInterventionSchema = benchmarkRecordSchema.shape.humanInterventions.element.superRefine((value, context) => {
  if (/(?:api[_-]?key|secret|token|authorization)\s*[:=]\s*\S+/i.test(value) ||
      /(?:[A-Za-z]:\\|\\\\|\/(?:home|Users|tmp|var)\/)/.test(value) ||
      /https?:\/\//i.test(value)) {
    context.addIssue({ code: "custom", message: "Human intervention text cannot contain credentials, URLs, or absolute paths." });
  }
});
const safeEvidencePathSchema = benchmarkRecordSchema.shape.evidence.element.refine(
  (value) => /^[A-Za-z0-9._/-]+$/.test(value) && !value.startsWith("/") &&
    !value.split("/").includes("..") && !value.includes("//"),
  "Evidence must be a normalized relative path.",
);

export const evidenceCaptureMetadataSchema = z.strictObject({
  client: benchmarkClientSchema,
  tools: toolSummarySchema,
  humanInterventions: z.array(safeInterventionSchema).max(50),
  failure: benchmarkFailureSchema,
  evidence: z.array(safeEvidencePathSchema).max(50).default([]),
}).superRefine((metadata, context) => {
  metadata.tools.names.forEach((name, index) => {
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(name)) {
      context.addIssue({ code: "custom", path: ["tools", "names", index], message: "Tool names must be identifiers." });
    }
  });
});

export type EvidenceCaptureMetadata = z.input<typeof evidenceCaptureMetadataSchema>;

export type EvidenceRelayClient = {
  getTask(taskId: string): Promise<GameTask>;
  replayEvents(input: ReplayRunEventsRequest): Promise<RunEventBatch>;
};

const PAGE_SIZE = 1_000;
// RunStore permits at most 100,000 retained events. One extra page confirms
// the end when the retained count is an exact multiple of PAGE_SIZE.
const MAX_PAGES = 101;

export async function captureBenchmarkEvidence(input: {
  definition: BenchmarkDefinition;
  metadata: EvidenceCaptureMetadata;
  taskId: string;
  relay: EvidenceRelayClient;
  mcpAudit?: McpToolAudit;
}): Promise<BenchmarkRecord> {
  const definition = benchmarkDefinitionSchema.parse(input.definition);
  const metadata = evidenceCaptureMetadataSchema.parse(input.metadata);
  const mcpAudit = input.mcpAudit === undefined ? undefined : mcpToolAuditSchema.parse(input.mcpAudit);
  if (mcpAudit?.truncated === true) throw new Error("Truncated MCP tool audit cannot produce a benchmark summary.");
  if (mcpAudit !== undefined &&
      (metadata.tools.count !== null || metadata.tools.errors !== null || metadata.tools.names.length > 0)) {
    throw new Error("MCP audit import requires unknown tools in manual metadata.");
  }
  const task = await input.relay.getTask(input.taskId);
  if (task.taskId !== input.taskId) throw new Error("Relay returned a different Task ID.");
  if (mcpAudit !== undefined &&
      (mcpAudit.context?.taskId !== task.taskId || mcpAudit.context.runId !== task.runId)) {
    throw new Error("MCP tool audit is not bound to the requested Task and Run.");
  }
  if (task.prompt !== definition.prompt || task.language !== definition.language) {
    throw new Error("Task prompt or language does not match the benchmark definition.");
  }
  const events = await replayAll(input.relay, task.runId);
  validateSequence(events, task.runId);
  validateCompletedTaskEvidence(task, events);
  const verificationEvent = [...events].reverse().find((event) => event.type === "verification.ready");
  const evidence = [...new Set([
    ...metadata.evidence,
    ...(verificationEvent === undefined ? [] : [verificationEvent.evidencePath]),
  ])];
  const firstTime = Date.parse(events[0]!.emittedAt);
  const lastTime = Date.parse(events.at(-1)!.emittedAt);
  const types: Record<string, number> = {};
  for (const event of events) types[event.type] = (types[event.type] ?? 0) + 1;

  return benchmarkRecordSchema.parse({
    schemaVersion: 1,
    benchmarkId: definition.benchmarkId,
    definitionFingerprint: fingerprintDefinition(definition),
    client: metadata.client,
    taskId: task.taskId,
    runId: task.runId,
    terminalStatus: task.status,
    ...(task.reasonCode === undefined ? {} : { reasonCode: task.reasonCode }),
    durationMs: Math.max(0, lastTime - firstTime),
    events: { count: events.length, types },
    tools: mcpAudit === undefined ? metadata.tools : {
      count: mcpAudit.calls.length,
      names: [...new Set(mcpAudit.calls.map((call) => call.tool))],
      errors: mcpAudit.calls.filter((call) => call.outcome === "error").length,
    },
    ...(mcpAudit === undefined ? {} : {
      toolAudit: {
        sessionId: mcpAudit.sessionId,
        sha256: createHash("sha256").update(JSON.stringify(mcpAudit)).digest("hex"),
        taskId: mcpAudit.context!.taskId,
        runId: mcpAudit.context!.runId,
      },
    }),
    ...(verificationEvent === undefined ? {} : {
      verification: {
        passed: verificationEvent.passed,
        outcome: verificationEvent.outcome,
        score: verificationEvent.score,
        lives: verificationEvent.lives,
        diagnostics: verificationEvent.diagnostics.consoleErrors +
          verificationEvent.diagnostics.pageErrors + verificationEvent.diagnostics.failedRequests,
      },
    }),
    humanInterventions: metadata.humanInterventions,
    failure: task.reasonCode === undefined ? metadata.failure : benchmarkFailureForReasonCode(task.reasonCode),
    evidence,
  });
}

async function replayAll(relay: EvidenceRelayClient, runId: string): Promise<WireRunEvent[]> {
  const events: WireRunEvent[] = [];
  let after = 0;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const batch = await relay.replayEvents({ runId, after });
    if (batch.runId !== runId || batch.after !== after) throw new Error("Relay replay page does not match its request.");
    events.push(...batch.events);
    const last = batch.events.at(-1);
    if (batch.events.length < PAGE_SIZE || last === undefined) return events;
    after = last.sequence;
  }
  throw new Error("Run evidence exceeded the supported retained event window.");
}

function validateSequence(events: ReadonlyArray<WireRunEvent>, runId: string): void {
  if (events.length === 0 || events[0]?.type !== "run.started" || events[0].sequence !== 1) {
    throw new Error("Run evidence must start with sequence 1 run.started.");
  }
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index]!;
    if (event.runId !== runId || event.sequence !== index + 1) {
      throw new Error("Run evidence must contain one contiguous run sequence.");
    }
  }
}

function validateCompletedTaskEvidence(task: GameTask, events: ReadonlyArray<WireRunEvent>): void {
  if (task.status === "completed" && events.at(-1)?.type !== "run.completed") {
    throw new Error("Completed Task evidence must end with run.completed.");
  }
}
