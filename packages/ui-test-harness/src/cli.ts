#!/usr/bin/env bun

import { randomUUID } from "node:crypto";
import { readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { RunRelayClient } from "@gameforge/run-relay/client";
import { ConPtyCodeArtsDriver } from "./adapters/conpty-codearts.js";
import { PlaywrightOpenChamberDriver } from "./adapters/playwright-openchamber.js";
import { RelayAuthorityDriver } from "./adapters/relay-authority.js";
import { XtermTuiObserverDriver } from "./adapters/xterm-observer.js";
import { projectFingerprint } from "./adapters/project-fingerprint.js";
import { safeCodeArtsServerUrl, safeEvidenceSegment, safeOpenChamberUrl, safeRelayUrl } from "./cli-safety.js";
import type { HarnessResult } from "./contracts.js";
import { UiTestController } from "./controller.js";
import { diagnose, renderDiagnosisMarkdown, renderDiagnosisTerminal } from "./diagnosis.js";
import { evaluatePreflight } from "./preflight.js";
import { probeRunDependencies } from "./preflight-probes.js";
import { prepareHarnessSession } from "./session-bootstrap.js";
import { READINESS_PROJECT_PREFIX, buildScenario, tierBanner, type HarnessTier } from "./tiers.js";
import { DEFAULT_OPENCHAMBER_URL, DEFAULT_RELAY_URL } from "./testenv-config.js";
import { renderPhaseTimings } from "./timing.js";

const reportedFailures = new Set<string>();

const repoRoot = path.resolve(import.meta.dirname, "../../..");
const options = parseArguments(process.argv.slice(2));
const relay = new RunRelayClient({
  baseUrl: options.relayUrl,
  timeoutMilliseconds: 10_000,
  ...(process.env.GAMEFORGE_RUN_RELAY_TOKEN === undefined ? {} : { authToken: process.env.GAMEFORGE_RUN_RELAY_TOKEN }),
});
const runId = options.runId ?? `ui-harness-${Date.now()}-${randomUUID().slice(0, 8)}`;
const projectId = options.projectId
  ?? (options.tier === "readiness" ? `${READINESS_PROJECT_PREFIX}${randomUUID().slice(0, 8)}` : `ui-harness-${randomUUID().slice(0, 8)}`);
const sessionId = options.sessionId ?? randomUUID();
const sessionRoot = path.join(repoRoot, ".gameforge-validation", options.experiment, "sessions", sessionId);
process.stderr.write(`${tierBanner(options.tier)}\n`);

const prepared = await prepareHarnessSession({
  sessionRoot,
  session: { sessionId, startedAt: new Date().toISOString(), mode: options.mode, tier: options.tier },
  scenario: buildScenario(options.tier, { openChamberUrl: options.openChamberUrl, instruction: "", totalTimeoutMs: options.totalTimeoutMs }).name,
  correlate: async () => {
    // Preflight runs after the Evidence session exists, so a missing
    // dependency is a named, on-disk failure instead of a bare stack trace.
    const preflight = evaluatePreflight(await probeRunDependencies({
      relayUrl: options.relayUrl,
      openChamberUrl: options.openChamberUrl,
      ...(options.codeartsServerUrl === undefined ? {} : {
        codeArtsAttach: { serverUrl: options.codeartsServerUrl, sessionId: options.codeartsSession! },
      }),
    }));
    if (!preflight.ready) {
      const blocking = preflight.entries
        .filter((entry) => !entry.available)
        .map((entry) => `${entry.dependency}${entry.remediation === undefined ? "" : ` (fix: ${entry.remediation})`}`);
      throw new Error(`Preflight failed: ${blocking.join(", ")}`);
    }
    const created = options.taskId === undefined
      ? await relay.createTask({ runId, projectId, language: "zh-CN", prompt: options.taskPrompt })
      : { task: await relay.getTask(options.taskId) };
    if (created.task.runId !== runId || created.task.projectId !== projectId) throw new Error("Existing Task correlation does not match --run-id/--project-id.");
    // Read the Task back independently: the write path is only proven usable
    // once the created Task is observable through the read path too.
    const readBack = await relay.getTask(created.task.taskId);
    if (readBack.taskId !== created.task.taskId) throw new Error("Authority read-back returned a different Task.");
    return created.task;
  },
}).catch(async (error: unknown) => {
  await reportFailure(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
const task = prepared.correlated;
const instruction = [
  `执行 GameForge 队列任务 ${task.taskId}。`,
  `使用固定 agentId ${options.agentId} 认领任务，绑定 MCP Audit 到 taskId=${task.taskId} 和 runId=${runId}。`,
  "调用至少一个确定性只读 MCP 工具，发布必要 RunEvent，然后调用 complete_game_run。",
  "不要部署、发布、上传或调用任何外部媒体 Provider。",
].join("\n");

const final = await runAttempt();
process.stdout.write(`${JSON.stringify({ tier: options.tier, taskId: task.taskId, runId, projectId, attempt: final.attempt, result: final.result, evidence: sessionRoot }, null, 2)}\n`);
process.stderr.write(`${tierBanner(options.tier)}\n`);
if (final.result.phases !== undefined) process.stderr.write(renderPhaseTimings(final.result.phases, options.softBudgetMs));
if (final.result.status === "failed" && final.result.failure !== undefined) await reportFailure(final.result.failure);
process.exitCode = final.result.status === "completed" ? 0 : 1;

async function runAttempt(): Promise<{ attempt: "baseline"; result: HarnessResult }> {
  const attempt = "baseline" as const;
  const evidence = prepared.evidence;
  const tui = new ConPtyCodeArtsDriver({
    repoRoot, sessionRoot, environment: {},
    ...(options.codeartsServerUrl === undefined ? {} : {
      attach: { serverUrl: options.codeartsServerUrl, sessionId: options.codeartsSession! },
    }),
  });
  const authority = new RelayAuthorityDriver({
    baseUrl: options.relayUrl, taskId: task.taskId, runId, projectId,
    ...(process.env.GAMEFORGE_RUN_RELAY_TOKEN === undefined ? {} : { authToken: process.env.GAMEFORGE_RUN_RELAY_TOKEN }),
  });
  const controller = new UiTestController({
    tui, authority, evidence,
    projectFingerprint: () => projectFingerprint(path.join(options.projectsRoot, projectId)),
    tuiObserver: new XtermTuiObserverDriver(),
    gui: new PlaywrightOpenChamberDriver({ sessionRoot, baseUrl: options.openChamberUrl, ...(options.browserChannel === undefined ? {} : { browserChannel: options.browserChannel }) }),
  }, {
    sessionId,
    mode: options.mode,
    tier: options.tier,
    taskId: task.taskId, runId, projectId,
    terminal: { columns: 120, rows: 36 },
    tuiObserverViewport: { width: 1280, height: 800 },
    viewport: { width: 1440, height: 900 },
    observationHoldMs: options.mode === "headed/watch" ? options.observationHoldMs : 0,
    failureHoldMs: options.mode === "headed/watch" ? options.failureHoldMs : 0,
    // Guidance reaches the terminal before the failure hold, so the operator
    // knows where to look while the windows are still on screen.
    onFailureObserved: (failureMessage) => reportFailure(failureMessage),
    activityPollMs: 2_000,
    inactivityTimeoutMs: options.inactivityTimeoutMs,
  });
  const result = await controller.run(buildScenario(options.tier, { openChamberUrl: options.openChamberUrl, instruction, totalTimeoutMs: options.totalTimeoutMs }));
  return { attempt, result };
}

/**
 * Diagnoses a failure against the evidence actually on disk, prints the
 * guidance, and writes diagnosis.md next to the evidence. The file is
 * navigation over recorded evidence, not new evidence, so writing it after
 * finalize() does not violate the result.json commit barrier. Repeated calls
 * for the same failure message only print once.
 */
async function reportFailure(failureMessage: string): Promise<void> {
  try {
    const files = await listSessionFiles(sessionRoot);
    const diagnosis = diagnose({ failure: failureMessage, files });
    // diagnosis.md is always rewritten against the current directory listing:
    // the mid-run copy (printed during the headed hold) predates result.json
    // and the final screen, and must not shadow the complete post-run one.
    const diagnosisPath = path.join(sessionRoot, "diagnosis.md");
    await writeFile(diagnosisPath, renderDiagnosisMarkdown({ failure: failureMessage, sessionRoot, diagnosis }), "utf8");
    // Only the terminal print is deduplicated, so the operator reads the
    // guidance once - during the hold in headed mode.
    if (reportedFailures.has(failureMessage)) return;
    reportedFailures.add(failureMessage);
    process.stderr.write(renderDiagnosisTerminal({ failure: failureMessage, sessionRoot, diagnosis }));
    process.stderr.write(`诊断已写入：${diagnosisPath}\n`);
  } catch (error) {
    // Diagnosis must never mask the original failure.
    process.stderr.write(`失败：${failureMessage}\n证据：${sessionRoot}\n（诊断生成失败：${error instanceof Error ? error.message : String(error)}）\n`);
  }
}

async function listSessionFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  const files: string[] = [];
  for (const entry of entries) {
    if (entry.isFile()) { files.push(entry.name); continue; }
    if (!entry.isDirectory()) continue;
    const nested = await readdir(path.join(root, entry.name)).catch(() => []);
    files.push(...nested.map((name) => `${entry.name}/${name}`));
  }
  return files;
}

function parseArguments(args: string[]): {
  experiment: string; relayUrl: string; taskPrompt: string; agentId: string; projectsRoot: string;
  inactivityTimeoutMs: number; totalTimeoutMs: number; mode: "headed/watch" | "headless";
  openChamberUrl: string; browserChannel?: string; observationHoldMs: number; failureHoldMs: number; softBudgetMs: number; tier: HarnessTier;
  sessionId?: string; taskId?: string; runId?: string; projectId?: string;
  codeartsServerUrl?: string; codeartsSession?: string;
} {
  const knownOptions = new Set([
    "--headless", "--headed", "--tier", "--experiment", "--relay-url", "--task-prompt", "--agent-id",
    "--projects-root", "--inactivity-timeout-ms", "--total-timeout-ms", "--openchamber-url", "--browser-channel",
    "--observation-hold-ms", "--failure-hold-ms", "--soft-budget-ms", "--session-id", "--task-id", "--run-id",
    "--project-id", "--codearts-server-url", "--codearts-session",
  ]);
  const unknownOption = args.find((argument) => argument.startsWith("--") && !knownOptions.has(argument));
  if (unknownOption !== undefined) throw new Error(`Unknown option: ${unknownOption}`);
  const headless = args.includes("--headless"); const headed = args.includes("--headed");
  if (headless === headed) throw new Error("Choose exactly one of --headless or --headed.");
  const tierInput = optionalValue(args, "--tier") ?? "acceptance";
  if (tierInput !== "readiness" && tierInput !== "acceptance") throw new Error("--tier must be readiness or acceptance.");
  if (tierInput === "readiness" && headless) throw new Error("The readiness tier requires --headed.");
  const value = (name: string, fallback: string): string => {
    const index = args.indexOf(name);
    return index < 0 ? fallback : args[index + 1] ?? (() => { throw new Error(`${name} requires a value.`); })();
  };
  const taskId = optionalValue(args, "--task-id"); const existingRunId = optionalValue(args, "--run-id"); const existingProjectId = optionalValue(args, "--project-id");
  const browserChannel = optionalValue(args, "--browser-channel") ?? process.env.GAMEFORGE_BROWSER_CHANNEL?.trim();
  const sessionId = optionalValue(args, "--session-id");
  const codeartsServerUrl = optionalValue(args, "--codearts-server-url");
  const codeartsSession = optionalValue(args, "--codearts-session");
  if ([taskId, existingRunId, existingProjectId].filter((entry) => entry !== undefined).length % 3 !== 0) throw new Error("--task-id, --run-id and --project-id must be provided together.");
  if (tierInput === "readiness" && taskId !== undefined) throw new Error("The readiness tier must create a fresh Authority task; omit --task-id, --run-id and --project-id.");
  if ((codeartsServerUrl === undefined) !== (codeartsSession === undefined)) throw new Error("--codearts-server-url and --codearts-session must be provided together.");
  return {
    experiment: safeEvidenceSegment(value("--experiment", `ui-harness-${new Date().toISOString().replace(/[:.]/g, "-")}`), "--experiment"),
    relayUrl: safeRelayUrl(value("--relay-url", process.env.GAMEFORGE_RUN_RELAY_URL?.trim() ?? DEFAULT_RELAY_URL)),
    taskPrompt: value("--task-prompt", "执行一次最小确定性 MCP 验收，不生成游戏，不调用外部 Provider，然后完成 Run。"),
    agentId: value("--agent-id", "codearts"),
    projectsRoot: value("--projects-root", process.env.GAMEFORGE_PROJECT_OUTPUT_ROOT?.trim() ?? path.join(repoRoot, ".gameforge-validation", "integrations", "projects")),
    inactivityTimeoutMs: positiveInteger(value("--inactivity-timeout-ms", "120000")),
    totalTimeoutMs: positiveInteger(value("--total-timeout-ms", "900000")),
    mode: headed ? "headed/watch" : "headless",
    openChamberUrl: safeOpenChamberUrl(value("--openchamber-url", process.env.GAMEFORGE_OPENCHAMBER_URL?.trim() ?? DEFAULT_OPENCHAMBER_URL)),
    ...(browserChannel === undefined ? {} : { browserChannel }),
    observationHoldMs: positiveInteger(value("--observation-hold-ms", "10000")),
    // Bounded at parse time: the controller enforces the same cap, but a
    // rejection there would land after the evidence lock is already held.
    failureHoldMs: boundedInteger(value("--failure-hold-ms", "30000"), 300_000, "--failure-hold-ms"),
    softBudgetMs: positiveInteger(value("--soft-budget-ms", "60000")),
    tier: tierInput,
    ...(sessionId === undefined ? {} : { sessionId: safeEvidenceSegment(sessionId, "--session-id") }),
    ...(codeartsServerUrl === undefined ? {} : {
      codeartsServerUrl: safeCodeArtsServerUrl(codeartsServerUrl),
      codeartsSession: safeEvidenceSegment(codeartsSession!, "--codearts-session"),
    }),
    ...(taskId === undefined ? {} : { taskId, runId: existingRunId!, projectId: safeEvidenceSegment(existingProjectId!, "--project-id") }),
  };
}

function optionalValue(args: string[], name: string): string | undefined { const index = args.indexOf(name); if (index < 0) return undefined; const result = args[index + 1]; if (result === undefined || result.startsWith("--")) throw new Error(`${name} requires a value.`); return result; }

function positiveInteger(value: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error("Timeout values must be positive integers.");
  return parsed;
}

function boundedInteger(value: string, max: number, name: string): number {
  const parsed = positiveInteger(value);
  if (parsed > max) throw new Error(`${name} must not exceed ${max}.`);
  return parsed;
}
