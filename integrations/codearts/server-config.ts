export type CodeArtsServerOptions = {
  baseUrl: string;
  corsOrigins: string[];
  dryRun: boolean;
  hostname: "127.0.0.1";
  port: number;
};

const externalProviderEnvironmentNames = [
  "DASHSCOPE_API_KEY",
  "GAMEFORGE_SPEC_MODEL",
  "FREESOUND_API_KEY",
  "FREESOUND_API_USAGE",
  "VOLCENGINE_ARK_API_KEY",
  "GAMEFORGE_IMAGE_MODEL",
  "GAMEFORGE_IMAGE_LICENSE",
  "GAMEFORGE_IMAGE_REFERENCE_HOSTS",
  "VOLCENGINE_SPEECH_API_TOKEN",
  "VOLCENGINE_SPEECH_APP_ID",
  "GAMEFORGE_TTS_LICENSE",
  "GAMEFORGE_TTS_AUDIO_HOSTS",
  "MINIMAX_API_KEY",
  "GAMEFORGE_MUSIC_MODEL",
  "GAMEFORGE_MUSIC_LICENSE",
] as const;

export function resolveCodeArtsServerOptions(
  args: readonly string[],
  environment: NodeJS.ProcessEnv = process.env,
): CodeArtsServerOptions {
  let portInput = environment.GAMEFORGE_CODEARTS_PORT?.trim() || "4096";
  const corsInputs = splitOrigins(environment.GAMEFORGE_STUDIO_ORIGINS);
  let dryRun = false;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--") continue;
    if (argument === "--dry-run") {
      dryRun = true;
      continue;
    }
    if (argument === "--port") {
      portInput = requiredValue(args, ++index, "--port");
      continue;
    }
    if (argument === "--cors") {
      corsInputs.push(requiredValue(args, ++index, "--cors"));
      continue;
    }
    throw new Error(`Unknown CodeArts server option: ${String(argument)}`);
  }

  const port = parsePort(portInput);
  const corsOrigins = uniqueOrigins(corsInputs.length > 0
    ? corsInputs
    : ["http://127.0.0.1:4173", "http://localhost:4173"]);
  return {
    baseUrl: `http://127.0.0.1:${port}/`,
    corsOrigins,
    dryRun,
    hostname: "127.0.0.1",
    port,
  };
}

export function safeCodeArtsServerUrl(input: string): string {
  const url = new URL(input);
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (!loopback || url.protocol !== "http:" || url.username || url.password || url.search || url.hash) {
    throw new Error("CodeArts server URL must use loopback HTTP without credentials, query, or fragment.");
  }
  if (!url.pathname.endsWith("/")) url.pathname += "/";
  return url.href;
}

export function withoutExternalProviderEnvironment(input: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const output = { ...input };
  for (const name of externalProviderEnvironmentNames) delete output[name];
  return output;
}

function splitOrigins(input: string | undefined): string[] {
  if (input === undefined) return [];
  return input.split(",").map((value) => value.trim()).filter((value) => value.length > 0);
}

function uniqueOrigins(inputs: readonly string[]): string[] {
  return [...new Set(inputs.map(safeStudioOrigin))];
}

function safeStudioOrigin(input: string): string {
  const url = new URL(input);
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  const secure = url.protocol === "https:";
  if ((!secure && !(url.protocol === "http:" && loopback)) || url.username || url.password ||
      url.search || url.hash || (url.pathname !== "/" && url.pathname !== "")) {
    throw new Error("Studio CORS origins must use HTTPS, or loopback HTTP, without credentials, path, query, or fragment.");
  }
  return url.origin;
}

function parsePort(input: string): number {
  if (!/^\d+$/.test(input)) throw new Error("CodeArts server port must be an integer between 1 and 65535.");
  const port = Number(input);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error("CodeArts server port must be an integer between 1 and 65535.");
  }
  return port;
}

function requiredValue(args: readonly string[], index: number, option: string): string {
  const value = args[index]?.trim();
  if (!value) throw new Error(`${option} requires a value.`);
  return value;
}
