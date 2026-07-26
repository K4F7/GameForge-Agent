import { access } from "node:fs/promises";
import path from "node:path";
import type { PreflightProbe } from "./preflight.js";

/**
 * Live dependency probes shared by `testenv status` and the run path. Probes
 * only observe: nothing is started, and CodeArts is detected but never
 * managed (ADR-0005).
 */
const PROBE_TIMEOUT_MS = 2_000;

/**
 * A dependency is only available when the endpoint speaks that dependency's
 * actual contract - a 200 from the wrong service parked on the pinned port
 * must not read as ready, and any non-2xx (401/403/404 included) is down.
 */
export async function probeHttp(dependency: PreflightProbe["dependency"], url: string): Promise<PreflightProbe> {
  try {
    const headers = dependency === "authority-relay" && process.env.GAMEFORGE_RUN_RELAY_TOKEN !== undefined
      ? { authorization: `Bearer ${process.env.GAMEFORGE_RUN_RELAY_TOKEN}` }
      : undefined;
    const response = await fetch(url, { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS), redirect: "manual", ...(headers === undefined ? {} : { headers }) });
    if (response.status < 200 || response.status >= 300) return { dependency, available: false, detail: `${url} responded ${response.status}` };
    const body = await response.text();
    const contract = matchesContract(dependency, body);
    if (!contract.matches) return { dependency, available: false, detail: `${url} responded 200 but ${contract.reason}` };
    return { dependency, available: true, detail: `${url} responded ${response.status}` };
  } catch (error) {
    return { dependency, available: false, detail: `${url} is not reachable: ${errorMessage(error)}` };
  }
}

function matchesContract(dependency: PreflightProbe["dependency"], body: string): { matches: boolean; reason?: string } {
  if (dependency === "authority-relay") {
    try {
      const parsed: unknown = JSON.parse(body);
      if (typeof parsed === "object" && parsed !== null && Array.isArray((parsed as { tasks?: unknown }).tasks)) return { matches: true };
    } catch { /* fall through to the mismatch below */ }
    return { matches: false, reason: "did not return the relay task-list contract; another service may own this port" };
  }
  if (dependency === "openchamber-service") {
    if (body.includes("OpenChamber") && body.includes('id="root"')) return { matches: true };
    return { matches: false, reason: "did not serve the OpenChamber landing page; another service may own this port" };
  }
  return { matches: true };
}

export async function probeFile(dependency: PreflightProbe["dependency"], target: string): Promise<PreflightProbe> {
  try {
    await access(target);
    return { dependency, available: true, detail: target };
  } catch {
    return { dependency, available: false, detail: `${target} is missing` };
  }
}

/**
 * Mirrors the repository CodeArts launcher's resolution: CODEARTS_BIN, then
 * the Windows installer paths on win32, then `codearts` on PATH elsewhere -
 * matching `resolveCodeArtsLaunchTarget`. The harness only detects the
 * client; it never manages its authorization or private data directory
 * (ADR-0005).
 */
export async function probeCodeArts(options?: { platform?: NodeJS.Platform; env?: Readonly<Record<string, string | undefined>> }): Promise<PreflightProbe> {
  const platform = options?.platform ?? process.platform;
  const env = options?.env ?? process.env;
  const configured = env.CODEARTS_BIN?.trim();
  if (configured) {
    try { await access(configured); return { dependency: "codearts", available: true, detail: configured }; }
    catch { return { dependency: "codearts", available: false, detail: `CODEARTS_BIN points at ${configured}, which is not accessible` }; }
  }
  if (platform === "win32") {
    const home = env.USERPROFILE?.trim() || env.HOME?.trim() || "";
    const installers = path.join(home, ".codeartsdoer", "installers");
    for (const candidate of [path.join(installers, "bin", "codearts.exe"), path.join(installers, "codearts.cmd")]) {
      try { await access(candidate); return { dependency: "codearts", available: true, detail: candidate }; }
      catch { continue; }
    }
    return { dependency: "codearts", available: false, detail: `No CodeArts client under ${installers}; set CODEARTS_BIN to override` };
  }
  for (const directory of (env.PATH ?? "").split(path.delimiter).filter((entry) => entry.length > 0)) {
    const candidate = path.join(directory, "codearts");
    try { await access(candidate); return { dependency: "codearts", available: true, detail: candidate }; }
    catch { continue; }
  }
  return { dependency: "codearts", available: false, detail: "No codearts executable on PATH; set CODEARTS_BIN to override" };
}

/**
 * The probes that gate a harness run: the run needs the relay writable, the
 * OpenChamber service reachable and a CodeArts client present. The production
 * build probe is deliberately absent - it only matters for starting the
 * service, which is `testenv up`'s concern, not the run's.
 */
export async function probeRunDependencies(options: {
  relayUrl: string;
  openChamberUrl: string;
  codeArtsAttach?: { serverUrl: string; sessionId: string };
}): Promise<PreflightProbe[]> {
  const codeArtsProbe = options.codeArtsAttach === undefined
    ? probeCodeArts()
    : probeHttp("codearts", new URL(`/session/${encodeURIComponent(options.codeArtsAttach.sessionId)}`, options.codeArtsAttach.serverUrl).href);
  return await Promise.all([
    probeHttp("authority-relay", new URL("tasks?limit=1", options.relayUrl).href),
    probeHttp("openchamber-service", options.openChamberUrl),
    codeArtsProbe,
  ]);
}

function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error); }
