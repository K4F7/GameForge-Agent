import type { WireRunEvent } from "@gameforge/contracts";

export type RunSummary = {
  runId: string;
  status: "idle" | "running" | "repair" | "succeeded" | "failed" | "stopped";
  sequence: number;
  locale?: "zh-CN" | "en-US";
  title?: string;
  assets: number;
  previewUrl?: string;
  build?: {
    projectId: string;
    cliVersion: "3.4.0";
    fileCount: number;
    totalBytes: number;
    mainPackageBytes: number;
    assetCount: number;
    assetManifestRevision: number;
    deviceOrientation: "portrait" | "landscape";
  };
  verification?: { passed: boolean; outcome: "running" | "won" | "lost"; score: number; lives: number };
  phases: Partial<Record<string, string>>;
  logs: string[];
};

export function summarizeRun(events: readonly WireRunEvent[]): RunSummary | null {
  const started = events.find((event) => event.type === "run.started");
  if (started === undefined) return null;
  const summary: RunSummary = {
    runId: started.runId,
    status: "running",
    sequence: started.sequence,
    ...(started.language === undefined ? {} : { locale: started.language }),
    assets: 0,
    phases: {},
    logs: [],
  };
  const assetIds = new Set<string>();
  for (const event of events) {
    if (event.runId !== summary.runId || event.sequence <= summary.sequence && event !== started) continue;
    summary.sequence = Math.max(summary.sequence, event.sequence);
    switch (event.type) {
      case "run.completed": summary.status = "succeeded"; break;
      case "run.stopped": summary.status = "stopped"; break;
      case "phase.started": summary.status = "running"; summary.phases[event.phase] = "running"; break;
      case "phase.completed": summary.phases[event.phase] = "succeeded"; break;
      case "phase.failed":
        summary.status = event.repairable ? "repair" : "failed";
        summary.phases[event.phase] = event.repairable ? "repair" : "failed";
        break;
      case "spec.ready": summary.locale = event.spec.locale ?? "zh-CN"; summary.title = event.spec.title; break;
      case "asset.ready": assetIds.add(event.entry.assetId); summary.assets = assetIds.size; break;
      case "preview.ready": summary.previewUrl = event.url; break;
      case "build.ready":
        summary.build = {
          projectId: event.projectId,
          cliVersion: event.cliVersion,
          fileCount: event.fileCount,
          totalBytes: event.totalBytes,
          mainPackageBytes: event.mainPackageBytes,
          assetCount: event.assetCount,
          assetManifestRevision: event.assetManifestRevision,
          deviceOrientation: event.deviceOrientation,
        };
        break;
      case "verification.ready":
        summary.verification = {
          passed: event.passed,
          outcome: event.outcome,
          score: event.score,
          lives: event.lives,
        };
        break;
      case "log.appended": summary.logs = [...summary.logs, `[${event.level}] ${event.message}`].slice(-8); break;
    }
  }
  return summary;
}

export function formatSummary(summary: RunSummary): string {
  const lines = [
    `Run ${summary.runId}`,
    `Status: ${summary.status}  Sequence: ${summary.sequence}`,
    `Game: ${summary.title ?? "waiting"}  Locale: ${summary.locale ?? "waiting"}`,
    `Assets: ${summary.assets}  Preview: ${summary.previewUrl ?? "waiting"}`,
  ];
  if (summary.verification !== undefined) {
    lines.push(
      `Verification: ${summary.verification.passed ? "passed" : "failed"} ` +
      `${summary.verification.outcome} score=${summary.verification.score} lives=${summary.verification.lives}`,
    );
  }
  if (summary.build !== undefined) {
    lines.push(
      `Douyin build: LayaAir ${summary.build.cliVersion} ${summary.build.deviceOrientation} ` +
      `files=${summary.build.fileCount} main=${formatMiB(summary.build.mainPackageBytes)} ` +
      `total=${formatMiB(summary.build.totalBytes)} assets=${summary.build.assetCount}@r${summary.build.assetManifestRevision}`,
    );
  }
  const phases = Object.entries(summary.phases);
  if (phases.length > 0) lines.push(`Phases: ${phases.map(([key, value]) => `${key}=${value}`).join(" ")}`);
  if (summary.logs.length > 0) lines.push("Logs:", ...summary.logs.map((line) => `  ${line}`));
  return lines.join("\n");
}

function formatMiB(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(2)}MiB`;
}
