#!/usr/bin/env bun

import { access } from "node:fs/promises";
import path from "node:path";
import { evaluatePreflight, type PreflightProbe, type PreflightReport } from "./preflight.js";
import { DEFAULT_OPENCHAMBER_URL, DEFAULT_RELAY_URL } from "./testenv-config.js";

/**
 * Resident test environment control surface. `status` performs preflight only:
 * it starts nothing, so it stays fast enough to run before every session.
 */
const repoRoot = path.resolve(import.meta.dirname, "../../..");

const PROBE_TIMEOUT_MS = 2_000;

const command = process.argv[2] ?? "status";
if (command !== "status") {
  process.stderr.write(`Unknown testenv command: ${command}\nUsage: testenv status\n`);
  process.exit(2);
}

const report = evaluatePreflight(await probeAll());
process.stdout.write(formatReport(report));
process.exitCode = report.ready ? 0 : 1;

async function probeAll(): Promise<PreflightProbe[]> {
  const relayUrl = process.env.GAMEFORGE_RUN_RELAY_URL?.trim() || DEFAULT_RELAY_URL;
  const openChamberUrl = process.env.GAMEFORGE_OPENCHAMBER_URL?.trim() || DEFAULT_OPENCHAMBER_URL;
  return await Promise.all([
    probeHttp("authority-relay", new URL("tasks?limit=1", relayUrl).href),
    probeHttp("openchamber-service", openChamberUrl),
    probeFile("openchamber-build", path.join(repoRoot, "vendor", "openchamber", "packages", "web", "dist", "index.html")),
    probeCodeArts(),
  ]);
}

async function probeHttp(dependency: PreflightProbe["dependency"], url: string): Promise<PreflightProbe> {
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

async function probeFile(dependency: PreflightProbe["dependency"], target: string): Promise<PreflightProbe> {
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
async function probeCodeArts(): Promise<PreflightProbe> {
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

function formatReport(value: PreflightReport): string {
  const lines = value.entries.map((entry) => {
    const mark = entry.available ? "OK  " : "DOWN";
    const remediation = entry.remediation === undefined ? "" : `\n       fix: ${entry.remediation}`;
    return `  ${mark} ${entry.dependency}${entry.detail === undefined ? "" : `\n       ${entry.detail}`}${remediation}`;
  });
  const summary = value.ready
    ? "Test environment is ready."
    : `Test environment is not ready: ${value.blocking.join(", ")}`;
  return `${lines.join("\n")}\n\n${summary}\n`;
}

function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error); }
