import path from "node:path";
import { safeEvidenceSegment, safeRelayUrl } from "./cli-safety.js";

export type CliOptions = {
  experiment: string; relayUrl: string; taskPrompt: string; agentId: string; projectsRoot: string;
  inactivityTimeoutMs: number; totalTimeoutMs: number; mode: "headed/watch" | "headless";
  openChamberUrl: string; browserChannel?: string; observationHoldMs: number;
  sessionId?: string; taskId?: string; runId?: string; projectId?: string;
};

export function parseCliArguments(
  args: string[],
  repoRoot: string,
  environment: NodeJS.ProcessEnv = process.env,
): CliOptions {
  const headless = args.includes("--headless"); const headed = args.includes("--headed");
  if (headless === headed) throw new Error("Choose exactly one of --headless or --headed.");
  const value = (name: string, fallback: string): string => {
    const index = args.indexOf(name);
    return index < 0 ? fallback : args[index + 1] ?? (() => { throw new Error(`${name} requires a value.`); })();
  };
  const taskId = optionalValue(args, "--task-id"); const existingRunId = optionalValue(args, "--run-id"); const existingProjectId = optionalValue(args, "--project-id");
  const browserChannel = optionalValue(args, "--browser-channel") ?? environment.GAMEFORGE_BROWSER_CHANNEL?.trim();
  const sessionId = optionalValue(args, "--session-id");
  if ([taskId, existingRunId, existingProjectId].filter((entry) => entry !== undefined).length % 3 !== 0) throw new Error("--task-id, --run-id and --project-id must be provided together.");
  return {
    experiment: safeEvidenceSegment(value("--experiment", `ui-harness-${new Date().toISOString().replace(/[:.]/g, "-")}`), "--experiment"),
    relayUrl: safeRelayUrl(value("--relay-url", environment.GAMEFORGE_RUN_RELAY_URL?.trim() ?? "http://127.0.0.1:8787/")),
    taskPrompt: value("--task-prompt", "执行一次最小确定性 MCP 验收，不生成游戏，不调用外部 Provider，然后完成 Run。"),
    agentId: value("--agent-id", "codearts"),
    projectsRoot: value("--projects-root", environment.GAMEFORGE_PROJECT_OUTPUT_ROOT?.trim() || path.join(repoRoot, ".gameforge-validation", "integrations", "projects")),
    inactivityTimeoutMs: positiveInteger(value("--inactivity-timeout-ms", "120000")),
    totalTimeoutMs: positiveInteger(value("--total-timeout-ms", "900000")),
    mode: headed ? "headed/watch" : "headless",
    openChamberUrl: value("--openchamber-url", environment.GAMEFORGE_OPENCHAMBER_URL?.trim() ?? "http://127.0.0.1:5173/"),
    ...(browserChannel === undefined ? {} : { browserChannel }),
    observationHoldMs: positiveInteger(value("--observation-hold-ms", "10000")),
    ...(sessionId === undefined ? {} : { sessionId: safeEvidenceSegment(sessionId, "--session-id") }),
    ...(taskId === undefined ? {} : { taskId, runId: existingRunId!, projectId: safeEvidenceSegment(existingProjectId!, "--project-id") }),
  };
}

function optionalValue(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  const result = args[index + 1];
  if (result === undefined || result.startsWith("--")) throw new Error(`${name} requires a value.`);
  return result;
}

function positiveInteger(value: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error("Timeout values must be positive integers.");
  return parsed;
}
