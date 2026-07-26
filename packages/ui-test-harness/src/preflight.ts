export type PreflightDependency = "authority-relay" | "openchamber-service" | "openchamber-build" | "codearts";

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
 * The command an operator runs to make each dependency available. CodeArts is
 * deliberately launcher-only: the harness probes it but never takes over its
 * authorization or private data directory (ADR-0005).
 */
const REMEDIATION: Record<PreflightDependency, string> = {
  "authority-relay": "bun run testenv:up",
  "openchamber-service": "bun run testenv:up",
  "openchamber-build": "bun --cwd vendor/openchamber run build:web",
  codearts: "bun run codearts",
};

export function evaluatePreflight(probes: readonly PreflightProbe[]): PreflightReport {
  const entries: PreflightEntry[] = probes.map((probe) => ({
    ...probe,
    ...(probe.available ? {} : { remediation: REMEDIATION[probe.dependency] }),
  }));
  const blocking = entries.filter((entry) => !entry.available).map((entry) => entry.dependency);
  return { ready: blocking.length === 0, entries, blocking };
}
