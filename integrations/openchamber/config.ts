import path from "node:path";

export const OPENCHAMBER_UPSTREAM_URL = "https://github.com/openchamber/openchamber.git";
export const OPENCHAMBER_PINNED_COMMIT = "f9ad0de3e5e7cf281dd4966391409f3e19de4e79";
export const OPENCHAMBER_PINNED_VERSION = "1.16.2";

export type OpenChamberIntegrationOptions = Readonly<{
  checkoutRoot: string;
  dataDirectory: string;
  codeArtsUrl: string;
  baseUrl: string;
  hostname: "127.0.0.1";
  port: number;
  dryRun: boolean;
}>;

export function resolveOpenChamberIntegrationOptions(
  args: readonly string[],
  environment: NodeJS.ProcessEnv,
  repoRoot: string,
): OpenChamberIntegrationOptions {
  let checkoutRoot = environment.GAMEFORGE_OPENCHAMBER_ROOT?.trim() || path.join(repoRoot, ".third-party", "openchamber");
  let dataDirectory = environment.GAMEFORGE_OPENCHAMBER_DATA_DIR?.trim() ||
    path.join(repoRoot, ".gameforge-validation", "integrations", "openchamber", "data");
  let codeArtsUrl = environment.GAMEFORGE_CODEARTS_URL?.trim() || "http://127.0.0.1:4096/";
  let port = 3000;
  let dryRun = false;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--") continue;
    if (argument === "--dry-run") { dryRun = true; continue; }
    if (argument === "--root") { checkoutRoot = requiredValue(args, ++index, argument); continue; }
    if (argument === "--data-dir") { dataDirectory = requiredValue(args, ++index, argument); continue; }
    if (argument === "--codearts-url") { codeArtsUrl = requiredValue(args, ++index, argument); continue; }
    if (argument === "--port") {
      const value = Number(requiredValue(args, ++index, argument));
      if (!Number.isSafeInteger(value) || value < 1 || value > 65_535) throw new Error("OpenChamber port must be between 1 and 65535.");
      port = value;
      continue;
    }
    throw new Error(`Unknown OpenChamber integration option: ${String(argument)}`);
  }
  if (!path.isAbsolute(checkoutRoot)) throw new Error("OpenChamber checkout root must be absolute.");
  if (!path.isAbsolute(dataDirectory)) throw new Error("OpenChamber data directory must be absolute.");
  const resolvedCheckoutRoot = path.resolve(checkoutRoot);
  const resolvedDataDirectory = path.resolve(dataDirectory);
  if (resolvedCheckoutRoot === path.parse(resolvedCheckoutRoot).root) throw new Error("OpenChamber checkout root cannot be a filesystem root.");
  if (resolvedDataDirectory === path.parse(resolvedDataDirectory).root) throw new Error("OpenChamber data directory cannot be a filesystem root.");
  codeArtsUrl = safeLoopbackBaseUrl(codeArtsUrl, "CodeArts");
  return {
    checkoutRoot: resolvedCheckoutRoot,
    dataDirectory: resolvedDataDirectory,
    codeArtsUrl,
    baseUrl: `http://127.0.0.1:${port}/`,
    hostname: "127.0.0.1",
    port,
    dryRun,
  };
}

export function safeLoopbackBaseUrl(input: string, label: string): string {
  const url = new URL(input);
  if (url.protocol !== "http:" || (url.hostname !== "127.0.0.1" && url.hostname !== "localhost")) {
    throw new Error(`${label} URL must use loopback HTTP.`);
  }
  if (url.username || url.password || url.search || url.hash || (url.pathname !== "/" && url.pathname !== "")) {
    throw new Error(`${label} URL must not contain credentials, path, query, or fragment.`);
  }
  if (!url.port) throw new Error(`${label} URL must include an explicit port.`);
  return `${url.origin}/`;
}

function requiredValue(args: readonly string[], index: number, option: string): string {
  const value = args[index]?.trim();
  if (!value) throw new Error(`${option} requires a value.`);
  return value;
}
