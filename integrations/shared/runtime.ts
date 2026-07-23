import { access, lstat, mkdir, writeFile } from "node:fs/promises";
import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";

export type IntegrationRuntime = {
  repoRoot: string;
  outputRoot: string;
  relayUrl: string;
  auditDirectory: string;
  configPath: string;
  dataDirectory: string;
};

const disabledExternalProviderCredentials = {
  DASHSCOPE_API_KEY: "",
  FREESOUND_API_KEY: "",
  MINIMAX_API_KEY: "",
  VOLCENGINE_ARK_API_KEY: "",
  VOLCENGINE_SPEECH_API_TOKEN: "",
} as const;

export async function resolveRuntime(startDirectory: string, integration: "codearts" | "opencode"): Promise<IntegrationRuntime> {
  const repoRoot = await findRepoRoot(startDirectory);
  try {
    await access(path.join(repoRoot, "packages", "mcp-server", "dist", "index.js"));
  } catch {
    throw new Error("GameForge MCP is not built. Run `bun run build` before launching an integration.");
  }
  const outputRoot = path.resolve(
    process.env.GAMEFORGE_PROJECT_OUTPUT_ROOT?.trim() ||
      path.join(repoRoot, ".gameforge-validation", "integrations", "projects"),
  );
  const relayUrl = safeRelayUrl(
    process.env.GAMEFORGE_RUN_RELAY_URL?.trim() || "http://127.0.0.1:8787/",
  );
  const configuredRuntimeDirectory = process.env.GAMEFORGE_INTEGRATION_RUNTIME_DIR?.trim();
  if (configuredRuntimeDirectory !== undefined && configuredRuntimeDirectory.length > 0 && !path.isAbsolute(configuredRuntimeDirectory)) {
    throw new Error("GAMEFORGE_INTEGRATION_RUNTIME_DIR must be absolute when configured.");
  }
  const runtimeDirectory = path.resolve(configuredRuntimeDirectory || path.join(repoRoot, ".gameforge-validation", "integrations", integration));
  const configuredAuditDirectory = process.env.GAMEFORGE_MCP_AUDIT_DIR?.trim();
  if (configuredAuditDirectory !== undefined && configuredAuditDirectory.length > 0 &&
      !path.isAbsolute(configuredAuditDirectory)) {
    throw new Error("GAMEFORGE_MCP_AUDIT_DIR must be absolute when configured.");
  }
  const auditDirectory = path.resolve(configuredAuditDirectory || path.join(runtimeDirectory, "mcp-audit"));
  await mkdir(outputRoot, { recursive: true });
  await mkdir(runtimeDirectory, { recursive: true });
  await mkdir(auditDirectory, { recursive: true, mode: 0o700 });
  const dataDirectory = path.join(runtimeDirectory, "data");
  await mkdir(dataDirectory, { recursive: true, mode: 0o700 });
  return {
    repoRoot,
    outputRoot,
    relayUrl,
    auditDirectory,
    configPath: path.join(runtimeDirectory, "opencode.json"),
    dataDirectory,
  };
}

export async function writeRuntimeConfig(
  runtime: IntegrationRuntime,
  options: { permissionMode?: "scoped" | "full-access" } = {},
): Promise<void> {
  const relayToken = process.env.GAMEFORGE_RUN_RELAY_TOKEN;
  if (relayToken !== undefined) {
    const normalized = relayToken.trim();
    if (normalized.length < 32 || normalized.length > 512 || /[\r\n]/.test(relayToken)) {
      throw new Error("GAMEFORGE_RUN_RELAY_TOKEN must be unset or contain between 32 and 512 characters without newlines.");
    }
  }
  const layaAirCliPath = await optionalRegularFileEnvironment("GAMEFORGE_LAYAIR_CLI");
  const douyinMiniGameCliPath = await optionalRegularFileEnvironment("GAMEFORGE_DOUYIN_MINIGAME_CLI");
  const permissionMode = options.permissionMode ?? "scoped";
  const fallbackProvider = explicitFallbackProvider();
  const permission = permissionMode === "full-access" ? "allow" : {
    "gameforge_*": "ask",
    "gameforge_validate_*": "allow",
    "gameforge_get_*": "allow",
    "gameforge_list_*": "allow",
    "gameforge_replay_*": "allow",
    "gameforge_query_*": "allow",
  };
  const config = {
    $schema: "https://opencode.ai/config.json",
    lsp: false,
    instructions: ["AGENTS.md", ".codeartsdoer/skills/*/SKILL.md"],
    mcp: {
      gameforge: {
        type: "local",
        command: ["node", "packages/mcp-server/dist/index.js"],
        environment: {
          // These optional providers are disabled for the current CodeArts experiments.
          // Mask ambient credentials so a partial host configuration cannot crash MCP startup.
          ...disabledExternalProviderCredentials,
          GAMEFORGE_PROJECT_OUTPUT_ROOT: runtime.outputRoot,
          GAMEFORGE_RUN_RELAY_URL: runtime.relayUrl,
          ...(relayToken === undefined
            ? {}
            : { GAMEFORGE_RUN_RELAY_TOKEN: "{env:GAMEFORGE_RUN_RELAY_TOKEN}" }),
          ...(layaAirCliPath === undefined ? {} : { GAMEFORGE_LAYAIR_CLI: layaAirCliPath }),
          ...(douyinMiniGameCliPath === undefined
            ? {}
            : { GAMEFORGE_DOUYIN_MINIGAME_CLI: douyinMiniGameCliPath }),
          GAMEFORGE_MCP_AUDIT_DIR: runtime.auditDirectory,
          GAMEFORGE_MODEL_ROUTING_POLICY: path.join(runtime.repoRoot, "config", "model-routing.example.json"),
        },
        enabled: true,
        // Browser verification has its own bounded 120 s deadline. The client
        // transport must remain alive long enough to receive that result.
        timeout: 180_000,
      },
    },
    ...(fallbackProvider === undefined ? {} : { provider: fallbackProvider }),
    permission,
  };
  await writeFile(runtime.configPath, `${JSON.stringify(config, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
}

function explicitFallbackProvider(): Record<string, unknown> | undefined {
  const baseUrlInput = process.env.GAMEFORGE_CODEARTS_FALLBACK_BASE_URL?.trim() || undefined;
  const model = process.env.GAMEFORGE_CODEARTS_FALLBACK_MODEL?.trim() || undefined;
  const apiKey = process.env.GAMEFORGE_FALLBACK_API_KEY?.trim() || undefined;
  const configured = [baseUrlInput, model, apiKey].filter((value) => value !== undefined).length;
  if (configured === 0) return undefined;
  if (baseUrlInput === undefined || model === undefined || apiKey === undefined) {
    throw new Error("Explicit CodeArts fallback requires base URL, model, and GAMEFORGE_FALLBACK_API_KEY together.");
  }
  const baseUrl = new URL(baseUrlInput);
  if (baseUrl.protocol !== "https:" || baseUrl.username || baseUrl.password || baseUrl.search || baseUrl.hash) {
    throw new Error("CodeArts fallback base URL must use HTTPS without credentials, query, or fragment.");
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,119}$/.test(model)) throw new Error("CodeArts fallback model ID is invalid.");
  if (apiKey.length < 16 || /[\r\n]/.test(apiKey)) throw new Error("GAMEFORGE_FALLBACK_API_KEY is invalid.");
  return {
    "gameforge-fallback": {
      npm: "@ai-sdk/openai-compatible",
      name: "GameForge explicit test fallback",
      options: { baseURL: baseUrl.href.replace(/\/$/, ""), apiKey: "{env:GAMEFORGE_FALLBACK_API_KEY}" },
      models: { [model]: { name: model } },
    },
  };
}

async function optionalRegularFileEnvironment(name: string): Promise<string | undefined> {
  const input = process.env[name];
  if (input === undefined) return undefined;
  const value = input.trim();
  if (value.length === 0 || !path.isAbsolute(value)) {
    throw new Error(`${name} must be unset or contain an absolute regular file path.`);
  }
  const info = await lstat(value).catch(() => undefined);
  if (info === undefined || !info.isFile() || info.isSymbolicLink()) {
    throw new Error(`${name} must be unset or contain an absolute regular file path.`);
  }
  return path.resolve(value);
}

export async function findRepoRoot(startDirectory: string): Promise<string> {
  let current = path.resolve(startDirectory);
  while (true) {
    try {
      await access(path.join(current, "package.json"));
      await access(path.join(current, "packages", "mcp-server"));
      return current;
    } catch {
      const parent = path.dirname(current);
      if (parent === current) throw new Error("Could not locate the GameForge repository root.");
      current = parent;
    }
  }
}

export function safeRelayUrl(input: string): string {
  const url = new URL(input);
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.username || url.password || url.search || url.hash ||
      (url.protocol !== "https:" && !(url.protocol === "http:" && loopback))) {
    throw new Error("Relay URL must use HTTPS, or HTTP on loopback, without credentials, query, or fragment.");
  }
  if (!url.pathname.endsWith("/")) url.pathname += "/";
  return url.href;
}

export function redactArguments(values: readonly string[]): string[] {
  return values.map((value) => /(?:KEY|TOKEN|SECRET|PASSWORD)=/i.test(value) ? "<redacted>" : value);
}

export function bindChildLifecycle(child: ChildProcess): void {
  let requestedSignal: NodeJS.Signals | null = null;
  const cleanupListeners = (): void => {
    process.off("SIGINT", onSigint);
    process.off("SIGTERM", onSigterm);
  };
  const terminate = (signal: NodeJS.Signals): void => {
    if (requestedSignal !== null) return;
    requestedSignal = signal;
    if (child.pid === undefined) return;
    if (process.platform === "win32") {
      const cleanup = spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
        stdio: "ignore",
        windowsHide: true,
      });
      cleanup.once("error", () => child.kill());
      return;
    }
    child.kill(signal);
  };
  const onSigint = (): void => terminate("SIGINT");
  const onSigterm = (): void => terminate("SIGTERM");
  process.once("SIGINT", onSigint);
  process.once("SIGTERM", onSigterm);
  child.once("exit", (code, signal) => {
    cleanupListeners();
    if (requestedSignal !== null) {
      process.exit(requestedSignal === "SIGINT" ? 130 : 143);
    }
    process.exit(signal === null ? (code ?? 1) : 1);
  });
}
