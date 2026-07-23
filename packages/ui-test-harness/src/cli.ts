#!/usr/bin/env bun

import { randomUUID } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { RunRelayClient } from "@gameforge/run-relay/client";
import { ConPtyCodeArtsDriver } from "./adapters/conpty-codearts.js";
import { FileEvidenceSink } from "./adapters/file-evidence.js";
import { PlaywrightOpenChamberDriver } from "./adapters/playwright-openchamber.js";
import { RelayAuthorityDriver } from "./adapters/relay-authority.js";
import { XtermTuiObserverDriver } from "./adapters/xterm-observer.js";
import type { HarnessResult } from "./contracts.js";
import { UiTestController } from "./controller.js";
import { shouldFallback } from "./fallback.js";

const options = parseArguments(process.argv.slice(2));
const repoRoot = path.resolve(import.meta.dirname, "../../..");
const relay = new RunRelayClient({
  baseUrl: options.relayUrl,
  timeoutMilliseconds: 10_000,
  ...(process.env.GAMEFORGE_RUN_RELAY_TOKEN === undefined ? {} : { authToken: process.env.GAMEFORGE_RUN_RELAY_TOKEN }),
});
const runId = options.runId ?? `ui-harness-${Date.now()}-${randomUUID().slice(0, 8)}`;
const projectId = options.projectId ?? `ui-harness-${randomUUID().slice(0, 8)}`;
const created = options.taskId === undefined
  ? await relay.createTask({ runId, projectId, language: "zh-CN", prompt: options.taskPrompt })
  : { task: await relay.getTask(options.taskId) };
if (created.task.runId !== runId || created.task.projectId !== projectId) throw new Error("Existing Task correlation does not match --run-id/--project-id.");
const instruction = [
  `执行 GameForge 队列任务 ${created.task.taskId}。`,
  `使用固定 agentId ${options.agentId} 认领任务，绑定 MCP Audit 到 taskId=${created.task.taskId} 和 runId=${runId}。`,
  "调用至少一个确定性只读 MCP 工具，发布必要 RunEvent，然后调用 complete_game_run。",
  "不要部署、发布、上传或调用任何外部媒体 Provider。",
].join("\n");

const baseline = await runAttempt("baseline", undefined, {});
let final = baseline;
if (baseline.result.status === "failed" && shouldFallback(baseline.diagnostic)) {
  if (!options.fallbackEnabled) {
    process.stderr.write("Explicit rate-limit/quota detected, but fallback environment is incomplete.\n");
  } else {
    final = await runAttempt("fallback", `gameforge-fallback/${options.fallbackModel}`, {
      GAMEFORGE_CODEARTS_FALLBACK_BASE_URL: options.fallbackBaseUrl,
      GAMEFORGE_CODEARTS_FALLBACK_MODEL: options.fallbackModel,
      GAMEFORGE_FALLBACK_API_KEY: process.env.GAMEFORGE_FALLBACK_API_KEY!,
    });
  }
}
process.stdout.write(`${JSON.stringify({ taskId: created.task.taskId, runId, projectId, attempt: final.attempt, result: final.result, evidence: final.sessionRoot }, null, 2)}\n`);
process.exitCode = final.result.status === "completed" ? 0 : 1;

async function runAttempt(attempt: string, model: string | undefined, environment: Record<string, string>): Promise<{ attempt: string; result: HarnessResult; diagnostic: string; sessionRoot: string }> {
  const sessionId = options.sessionId === undefined
    ? randomUUID()
    : attempt === "baseline" ? options.sessionId : `${options.sessionId}-${attempt}`;
  const sessionRoot = path.join(repoRoot, ".gameforge-validation", options.experiment, "sessions", sessionId);
  await mkdir(sessionRoot, { recursive: true });
  const evidence = new FileEvidenceSink(sessionRoot);
  const tui = new ConPtyCodeArtsDriver({ repoRoot, sessionRoot, ...(model === undefined ? {} : { model }), environment });
  const authority = new RelayAuthorityDriver({
    baseUrl: options.relayUrl, taskId: created.task.taskId, runId, projectId,
    ...(process.env.GAMEFORGE_RUN_RELAY_TOKEN === undefined ? {} : { authToken: process.env.GAMEFORGE_RUN_RELAY_TOKEN }),
  });
  const controller = new UiTestController({
    tui, authority, evidence,
    tuiObserver: new XtermTuiObserverDriver(),
    gui: new PlaywrightOpenChamberDriver({ sessionRoot, baseUrl: options.openChamberUrl, ...(options.browserChannel === undefined ? {} : { browserChannel: options.browserChannel }) }),
  }, {
    sessionId,
    mode: options.mode,
    taskId: created.task.taskId, runId, projectId,
    terminal: { columns: 120, rows: 36 },
    tuiObserverViewport: { width: 1280, height: 800 },
    viewport: { width: 1440, height: 900 },
    observationHoldMs: options.mode === "headed/watch" ? options.observationHoldMs : 0,
    activityPollMs: 2_000,
    inactivityTimeoutMs: options.inactivityTimeoutMs,
  });
  const result = await controller.run({ name: `codearts-minimal-closure:${attempt}`, steps: [
    { kind: "gui.navigate", url: options.openChamberUrl },
    { kind: "tui.text", text: instruction, appendEnter: true },
    { kind: "authority.wait", gate: { description: "Task and Run completed", timeoutMs: options.totalTimeoutMs, accepts: (snapshot) => snapshot.taskStatus === "completed" && snapshot.runStatus === "completed" } },
    { kind: "capture", label: "completed" },
  ] });
  const vt = await readFile(path.join(sessionRoot, "output.vtlog"), "utf8").catch(() => "");
  return { attempt, result, diagnostic: `${result.failure ?? ""}\n${vt}`, sessionRoot };
}

function parseArguments(args: string[]): {
  experiment: string; relayUrl: string; taskPrompt: string; agentId: string;
  inactivityTimeoutMs: number; totalTimeoutMs: number; fallbackEnabled: boolean;
  fallbackBaseUrl: string; fallbackModel: string; mode: "headed/watch" | "headless";
  openChamberUrl: string; browserChannel?: string; observationHoldMs: number;
  sessionId?: string; taskId?: string; runId?: string; projectId?: string;
} {
  const headless = args.includes("--headless"); const headed = args.includes("--headed");
  if (headless === headed) throw new Error("Choose exactly one of --headless or --headed.");
  const value = (name: string, fallback: string): string => {
    const index = args.indexOf(name);
    return index < 0 ? fallback : args[index + 1] ?? (() => { throw new Error(`${name} requires a value.`); })();
  };
  const fallbackBaseUrl = process.env.GAMEFORGE_CODEARTS_FALLBACK_BASE_URL?.trim() ?? "https://newapi.mikumiku.love/v1";
  const fallbackModel = process.env.GAMEFORGE_CODEARTS_FALLBACK_MODEL?.trim() ?? "grok-4.5";
  const taskId = optionalValue(args, "--task-id"); const existingRunId = optionalValue(args, "--run-id"); const existingProjectId = optionalValue(args, "--project-id");
  const browserChannel = optionalValue(args, "--browser-channel") ?? process.env.GAMEFORGE_BROWSER_CHANNEL?.trim();
  const sessionId = optionalValue(args, "--session-id");
  if ([taskId, existingRunId, existingProjectId].filter((entry) => entry !== undefined).length % 3 !== 0) throw new Error("--task-id, --run-id and --project-id must be provided together.");
  return {
    experiment: value("--experiment", `ui-harness-${new Date().toISOString().replace(/[:.]/g, "-")}`),
    relayUrl: value("--relay-url", process.env.GAMEFORGE_RUN_RELAY_URL?.trim() ?? "http://127.0.0.1:8787/"),
    taskPrompt: value("--task-prompt", "执行一次最小确定性 MCP 验收，不生成游戏，不调用外部 Provider，然后完成 Run。"),
    agentId: value("--agent-id", "codearts-ui-harness"),
    inactivityTimeoutMs: positiveInteger(value("--inactivity-timeout-ms", "120000")),
    totalTimeoutMs: positiveInteger(value("--total-timeout-ms", "900000")),
    fallbackEnabled: Boolean(process.env.GAMEFORGE_FALLBACK_API_KEY?.trim()),
    fallbackBaseUrl,
    fallbackModel,
    mode: headed ? "headed/watch" : "headless",
    openChamberUrl: value("--openchamber-url", process.env.GAMEFORGE_OPENCHAMBER_URL?.trim() ?? "http://127.0.0.1:5173/"),
    ...(browserChannel === undefined ? {} : { browserChannel }),
    observationHoldMs: positiveInteger(value("--observation-hold-ms", "10000")),
    ...(sessionId === undefined ? {} : { sessionId }),
    ...(taskId === undefined ? {} : { taskId, runId: existingRunId!, projectId: existingProjectId! }),
  };
}

function optionalValue(args: string[], name: string): string | undefined { const index = args.indexOf(name); if (index < 0) return undefined; const result = args[index + 1]; if (result === undefined || result.startsWith("--")) throw new Error(`${name} requires a value.`); return result; }

function positiveInteger(value: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error("Timeout values must be positive integers.");
  return parsed;
}
