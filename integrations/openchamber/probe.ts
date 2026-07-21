import { findRepoRoot } from "../shared/runtime.js";
import { OPENCHAMBER_PINNED_VERSION, resolveOpenChamberIntegrationOptions } from "./config.js";

const repoRoot = await findRepoRoot(import.meta.dirname);
const options = resolveOpenChamberIntegrationOptions(process.argv.slice(2), process.env, repoRoot);
const directory = process.env.GAMEFORGE_CODEARTS_DIRECTORY?.trim() || repoRoot;
const query = new URLSearchParams({ directory });
const [openChamberHealth, codeArtsHealth, projects, providers, agents, mcp, sessions] = await Promise.all([
  readJson(new URL("health", options.baseUrl)),
  readJson(new URL("global/health", options.codeArtsUrl)),
  readJson(new URL("api/project", options.baseUrl)),
  readJson(new URL(`api/config/providers?${query}`, options.baseUrl)),
  readJson(new URL(`api/agent?${query}`, options.baseUrl)),
  readJson(new URL(`api/mcp?${query}`, options.baseUrl)),
  readJson(new URL(`api/experimental/session?${query}&archived=false&limit=1`, options.baseUrl)),
]);
const providerList = recordArray(providers, "providers");
const providerIds = providerList.map((provider) => stringField(provider, "id")).filter((value): value is string => value !== null);
const modelCount = providerList.reduce((total, provider) => total + Object.keys(recordField(provider, "models") ?? {}).length, 0);
const agentNames = Array.isArray(agents)
  ? agents.map((agent) => isRecord(agent) ? stringField(agent, "name") : null).filter((value): value is string => value !== null)
  : [];
const openChamberReady = isRecord(openChamberHealth) && openChamberHealth.status === "ok" &&
  openChamberHealth.openchamberVersion === OPENCHAMBER_PINNED_VERSION && openChamberHealth.isOpenCodeReady === true;
const codeArtsReady = isRecord(codeArtsHealth) && codeArtsHealth.healthy === true;
const ok = openChamberReady && codeArtsReady && providerIds.includes("huaweicloud-maas") && modelCount > 0 && agentNames.length > 0;
process.stdout.write(`${JSON.stringify({
  ok,
  openChamber: {
    version: isRecord(openChamberHealth) ? openChamberHealth.openchamberVersion ?? null : null,
    openCodeReady: isRecord(openChamberHealth) ? openChamberHealth.isOpenCodeReady ?? false : false,
  },
  codeArts: { version: isRecord(codeArtsHealth) ? codeArtsHealth.version ?? null : null },
  compatibility: {
    projectEndpoint: Array.isArray(projects) || isRecord(projects),
    providerIds,
    modelCount,
    agentNames,
    mcpEndpoint: isRecord(mcp),
    sessionEndpoint: Array.isArray(sessions),
  },
}, null, 2)}\n`);
if (!ok) process.exitCode = 1;

async function readJson(url: URL): Promise<unknown> {
  const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`${url.pathname} returned HTTP ${response.status}.`);
  return response.json() as Promise<unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function recordArray(value: unknown, key: string): Record<string, unknown>[] {
  if (!isRecord(value) || !Array.isArray(value[key])) return [];
  return value[key].filter(isRecord);
}

function recordField(value: Record<string, unknown>, key: string): Record<string, unknown> | null {
  return isRecord(value[key]) ? value[key] : null;
}

function stringField(value: Record<string, unknown>, key: string): string | null {
  return typeof value[key] === "string" ? value[key] : null;
}
