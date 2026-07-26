export type PreflightDependency = "authority-relay" | "openchamber-service" | "openchamber-build" | "codearts" | "codearts-session";

export type PreflightProbe = {
  dependency: PreflightDependency;
  available: boolean;
  detail?: string;
};

export type PreflightEntry = PreflightProbe & { remediation?: string };

export type PreflightReport = {
  ready: boolean;
  entries: PreflightEntry[];
  blocking: PreflightDependency[];
};

/**
 * The command an operator runs to make each dependency available. Every entry
 * must be runnable as written today - a remediation naming a command that does
 * not exist is worse than no remediation at all. CodeArts is deliberately
 * launcher-only: the harness probes it but never takes over its authorization
 * or private data directory (ADR-0005).
 */
const REMEDIATION: Record<PreflightDependency, string> = {
  "authority-relay": "bun run testenv:down; bun run testenv:up",
  "openchamber-service": "bun run testenv:down; bun run testenv:up",
  "openchamber-build": "git submodule update --init --recursive && bun --cwd vendor/openchamber install --frozen-lockfile && bun --cwd vendor/openchamber run build:web",
  codearts: "Set CODEARTS_BIN to the installed CodeArts executable (see docs/codearts-quickstart.md)",
  "codearts-session": "Verify --codearts-server-url and --codearts-session identify a live CodeArts session",
};

export function evaluatePreflight(probes: readonly PreflightProbe[]): PreflightReport {
  const entries: PreflightEntry[] = probes.map((probe) => ({
    ...probe,
    ...(probe.available ? {} : { remediation: REMEDIATION[probe.dependency] }),
  }));
  const blocking = entries.filter((entry) => !entry.available).map((entry) => entry.dependency);
  return { ready: blocking.length === 0, entries, blocking };
}
