import { access } from "node:fs/promises";
import path from "node:path";
import type { PreflightProbe } from "./preflight.js";

/**
 * Live dependency probes shared by `testenv status` and the run path. Probes
 * only observe: nothing is started, and CodeArts is detected but never
 * managed (ADR-0005).
 */
const PROBE_TIMEOUT_MS = 2_000;

export async function probeHttp(dependency: PreflightProbe["dependency"], url: string): Promise<PreflightProbe> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS), redirect: "manual" });
    // A 5xx means the process is listening but not serving; treat it as down so
    // the report cannot show OK for a dependency the run will fail against.
    if (response.status >= 500) return { dependency, available: false, detail: `${url} responded ${response.status}` };
    return { dependency, available: true, detail: `${url} responded ${response.status}` };
  } catch (error) {
    return { dependency, available: false, detail: `${url} is not reachable: ${errorMessage(error)}` };
  }
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
 * Mirrors the candidate list used by the repository CodeArts launcher. The
 * harness only detects the client - it never manages its authorization or
 * private data directory (ADR-0005).
 */
export async function probeCodeArts(): Promise<PreflightProbe> {
  const configured = process.env.CODEARTS_BIN?.trim();
  const home = process.env.USERPROFILE?.trim() || process.env.HOME?.trim() || "";
  const installers = path.join(home, ".codeartsdoer", "installers");
  const candidates = configured ? [configured] : [path.join(installers, "bin", "codearts.exe"), path.join(installers, "codearts.cmd")];
  for (const candidate of candidates) {
    try {
      await access(candidate);
      return { dependency: "codearts", available: true, detail: candidate };
    } catch { continue; }
  }
  return { dependency: "codearts", available: false, detail: `No CodeArts client under ${installers}; set CODEARTS_BIN to override` };
}

/**
 * The probes that gate a harness run: the run needs the relay writable, the
 * OpenChamber service reachable and a CodeArts client present. The production
 * build probe is deliberately absent - it only matters for starting the
 * service, which is `testenv up`'s concern, not the run's.
 */
export async function probeRunDependencies(options: { relayUrl: string; openChamberUrl: string }): Promise<PreflightProbe[]> {
  return await Promise.all([
    probeHttp("authority-relay", new URL("tasks?limit=1", options.relayUrl).href),
    probeHttp("openchamber-service", options.openChamberUrl),
    probeCodeArts(),
  ]);
}

function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error); }
