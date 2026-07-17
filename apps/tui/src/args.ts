export type CliOptions = {
  command: "help" | "submit" | "list" | "task" | "run" | "stop" | "watch";
  baseUrl: string;
  json: boolean;
  language: "zh-CN" | "en-US";
  limit: number;
  status?: "queued" | "claimed" | "completed" | "failed" | "stopped";
  runId?: string;
  taskId?: string;
  prompt?: string;
  projectId?: string;
  after: number;
};

const commands = new Set(["submit", "list", "task", "run", "stop", "watch"]);
const statuses = new Set(["queued", "claimed", "completed", "failed", "stopped"]);

export function parseArgs(argv: readonly string[]): CliOptions {
  const first = argv[0];
  if (first === undefined || first === "help" || first === "--help" || first === "-h") {
    return defaults("help");
  }
  if (!commands.has(first)) throw new Error(`Unknown command: ${first}`);
  const options = defaults(first as CliOptions["command"]);
  const positionals: string[] = [];
  for (let index = 1; index < argv.length; index += 1) {
    const current = argv[index];
    if (current === undefined) continue;
    if (!current.startsWith("--")) {
      positionals.push(current);
      continue;
    }
    if (current === "--json") {
      options.json = true;
      continue;
    }
    const value = argv[++index];
    if (value === undefined || value.startsWith("--")) throw new Error(`Missing value for ${current}`);
    switch (current) {
      case "--base-url": options.baseUrl = value; break;
      case "--language":
        if (value !== "zh-CN" && value !== "en-US") throw new Error("Language must be zh-CN or en-US.");
        options.language = value;
        break;
      case "--limit": options.limit = integer(value, 1, 100, "limit"); break;
      case "--status":
        if (!statuses.has(value)) throw new Error("Task status is invalid.");
        options.status = value as NonNullable<CliOptions["status"]>;
        break;
      case "--run-id": options.runId = value; break;
      case "--task-id": options.taskId = value; break;
      case "--prompt": options.prompt = value; break;
      case "--project-id": options.projectId = value; break;
      case "--after": options.after = integer(value, 0, Number.MAX_SAFE_INTEGER, "after"); break;
      default: throw new Error(`Unknown option: ${current}`);
    }
  }
  if (options.command === "submit") {
    const positionalRunId = positionals[0];
    if (options.runId === undefined && positionalRunId !== undefined) options.runId = positionalRunId;
    const positionalPrompt = positionals.slice(1).join(" ");
    if (options.prompt === undefined && positionalPrompt.length > 0) options.prompt = positionalPrompt;
    if (options.runId === undefined || options.prompt === undefined || options.prompt.trim().length === 0) {
      throw new Error("submit requires --run-id and --prompt.");
    }
  } else if (options.command === "task") {
    const positionalTaskId = positionals[0];
    if (options.taskId === undefined && positionalTaskId !== undefined) options.taskId = positionalTaskId;
    if (options.taskId === undefined) throw new Error("task requires a task ID.");
  } else if (["run", "stop", "watch"].includes(options.command)) {
    const positionalRunId = positionals[0];
    if (options.runId === undefined && positionalRunId !== undefined) options.runId = positionalRunId;
    if (options.runId === undefined) throw new Error(`${options.command} requires a run ID.`);
  } else if (positionals.length > 0) {
    throw new Error(`${options.command} does not accept positional arguments.`);
  }
  return options;
}

function defaults(command: CliOptions["command"]): CliOptions {
  return {
    command,
    baseUrl: process.env.GAMEFORGE_RUN_RELAY_URL?.trim() || "http://127.0.0.1:8787/",
    json: false,
    language: "zh-CN",
    limit: 20,
    after: 0,
  };
}

function integer(value: string, minimum: number, maximum: number, name: string): number {
  if (!/^\d+$/.test(value)) throw new Error(`${name} must be an integer.`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be between ${minimum} and ${maximum}.`);
  }
  return parsed;
}
