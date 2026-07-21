import { safeCodeArtsServerUrl } from "./server-config.js";

const baseUrl = safeCodeArtsServerUrl(readBaseUrl(process.argv.slice(2)));
const directory = process.env.GAMEFORGE_CODEARTS_DIRECTORY?.trim() || process.cwd();
const health = await requestJson(new URL("global/health", baseUrl));
const documentation = await request(new URL("doc", baseUrl));
const mcpUrl = new URL("mcp", baseUrl);
mcpUrl.searchParams.set("directory", directory);
const mcp = await requestJson(mcpUrl);
const mcpRecord = isRecord(mcp.body) ? mcp.body : {};

const result = {
  ok: health.response.ok && documentation.ok && mcp.response.ok,
  baseUrl,
  health: health.body,
  documentation: {
    status: documentation.status,
    contentType: documentation.headers.get("content-type"),
  },
  mcp: {
    status: mcp.response.status,
    gameforge: mcpRecord.gameforge ?? null,
  },
};
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
if (!result.ok) process.exitCode = 1;

function readBaseUrl(args: readonly string[]): string {
  let input = process.env.GAMEFORGE_CODEARTS_URL?.trim() || "http://127.0.0.1:4096/";
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--") continue;
    if (argument === "--url") {
      const value = args[++index]?.trim();
      if (!value) throw new Error("--url requires a value.");
      input = value;
      continue;
    }
    throw new Error(`Unknown CodeArts server probe option: ${String(argument)}`);
  }
  return input;
}

async function requestJson(url: URL): Promise<{ response: Response; body: unknown }> {
  const response = await request(url);
  const text = await response.text();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    body = { invalidJson: true, status: response.status };
  }
  return { response, body };
}

async function request(url: URL): Promise<Response> {
  const response = await fetch(url, { signal: AbortSignal.timeout(5_000) });
  if (!response.ok) process.stderr.write(`CodeArts probe ${url.pathname} returned HTTP ${response.status}.\n`);
  return response;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
