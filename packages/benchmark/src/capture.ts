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
  validateTerminal(task, events);
  const verificationEvent = [...events].reverse().find((event) => event.type === "verification.ready");
  const minigame = summarizeMiniGameEvidence(definition, task, events);
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
    ...(minigame === undefined ? {} : { minigame }),
    humanInterventions: metadata.humanInterventions,
    failure: metadata.failure,
    evidence,
  });
}

function summarizeMiniGameEvidence(
  definition: BenchmarkDefinition,
  task: GameTask,
  events: ReadonlyArray<WireRunEvent>,
): BenchmarkRecord["minigame"] {
  const gameplay = latestEvent(events, "gameplay.verified");
  const build = latestEvent(events, "build.ready");
  const miniGamePlatform = definition.target.platform === "douyin-mini-game" ||
    definition.target.platform === "wechat-mini-game";

  if (gameplay === undefined || build === undefined) {
    if (task.status === "completed" && miniGamePlatform) {
      throw new Error("Completed mini-game evidence requires both gameplay.verified and build.ready events.");
    }
    return undefined;
  }
  if (!miniGamePlatform || definition.target.runtimeGenre === undefined) {
    throw new Error("Mini-game evidence requires an explicit mini-game platform and runtime genre in the benchmark definition.");
  }
  if (gameplay.projectId !== build.projectId ||
      (task.projectId !== undefined && gameplay.projectId !== task.projectId)) {
    throw new Error("Mini-game evidence project IDs must match each other and any Task project ID.");
  }
  if (gameplay.target !== build.target || gameplay.target !== definition.target.platform) {
    throw new Error("Mini-game evidence targets must match the benchmark platform.");
  }
  const spec = latestEvent(events, "spec.ready");
  const capabilities = latestEvent(events, "capabilities.ready");
  if (spec === undefined || capabilities === undefined) {
    throw new Error("Mini-game evidence requires capabilities.ready and spec.ready events.");
  }
  if (!(capabilities.sequence < spec.sequence && spec.sequence < gameplay.sequence && gameplay.sequence < build.sequence)) {
    throw new Error("Mini-game evidence must follow capabilities, specification, gameplay, and build order.");
  }
  const targetBuildReady = gameplay.target === "douyin-mini-game"
    ? capabilities.snapshot.engineering.douyinBuild
    : capabilities.snapshot.engineering.wechatBuild;
  if (!capabilities.snapshot.engineering.generator ||
      !capabilities.snapshot.engineering.gameplayVerifier ||
      !targetBuildReady) {
    throw new Error("Mini-game capability evidence does not cover generation, gameplay verification, and target build.");
  }
  if (spec.spec.genre !== definition.target.runtimeGenre || gameplay.genre !== spec.spec.genre) {
    throw new Error("Mini-game runtime genres must match the benchmark definition and specification.");
  }
  if (spec.spec.locale !== definition.language ||
      spec.spec.targetDurationSeconds !== definition.target.durationSeconds ||
      spec.spec.gameplay === undefined ||
      spec.spec.gameplay.collectibleCount !== definition.target.collectibleCount ||
      spec.spec.gameplay.hazardCount !== definition.target.hazardCount ||
      spec.spec.gameplay.startingLives !== definition.target.startingLives ||
      spec.spec.gameplay.movementSpeed !== definition.target.movementSpeed) {
    throw new Error("Mini-game specification parameters must match the benchmark definition.");
  }

  return {
    projectId: gameplay.projectId,
    target: gameplay.target,
    genre: gameplay.genre,
    gameplay: {
      passed: true,
      scenarios: gameplay.scenarios,
      durationMs: gameplay.durationMs,
    },
    build: {
      passed: true,
      cliVersion: build.cliVersion,
      fileCount: build.fileCount,
      totalBytes: build.totalBytes,
      mainPackageBytes: build.mainPackageBytes,
      subpackageCount: build.subpackages.length,
      deviceOrientation: build.deviceOrientation,
      assetManifestRevision: build.assetManifestRevision,
      assetCount: build.assetCount,
      stdoutTruncated: build.stdoutTruncated,
      stderrTruncated: build.stderrTruncated,
    },
  };
}

function latestEvent<Type extends WireRunEvent["type"]>(
  events: ReadonlyArray<WireRunEvent>,
  type: Type,
): Extract<WireRunEvent, { type: Type }> | undefined {
  return [...events].reverse().find(
    (event): event is Extract<WireRunEvent, { type: Type }> => event.type === type,
  );
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

function validateTerminal(task: GameTask, events: ReadonlyArray<WireRunEvent>): void {
  const last = events.at(-1)!;
  if (task.status === "completed" && last.type !== "run.completed") {
    throw new Error("Completed Task evidence must end with run.completed.");
  }
  if (task.status === "stopped" && last.type !== "run.stopped") {
    throw new Error("Stopped Task evidence must end with run.stopped.");
  }
  if (task.status === "failed" && !events.some((event) => event.type === "phase.failed" && !event.repairable)) {
    throw new Error("Failed Task evidence requires an unrecoverable phase.failed event.");
  }
  if ((task.status === "queued" || task.status === "claimed") &&
      events.some((event) => event.type === "run.completed" || event.type === "run.stopped")) {
    throw new Error("Nonterminal Task evidence cannot contain a terminal Run event.");
  }
}
