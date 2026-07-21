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
    target: "douyin-mini-game" | "wechat-mini-game";
    cliVersion: "3.4.0";
    fileCount: number;
    totalBytes: number;
    mainPackageBytes: number;
    assetCount: number;
    assetManifestRevision: number;
    deviceOrientation: "portrait" | "landscape";
    artifactSha256?: string;
    remoteOperations?: "forbidden";
    devToolVerification?: "not-run";
  };
  verification?: { passed: boolean; outcome: "running" | "won" | "lost"; score: number; lives: number };
  gameplayVerification?: {
    target: "douyin-mini-game" | "wechat-mini-game";
    genre: string;
    winActions: number;
    lossActions: number;
    durationMs: number;
  };
  evidence: {
    webPreview: "pending" | "passed" | "failed";
    webVisual: "pending" | "passed" | "failed";
    minigameLogic: "pending" | "passed" | "failed";
    douyinBuild: "pending" | "passed" | "failed";
  };
  douyinDevTool: "not-run" | "disconnected" | "connected" | "passed" | "failed";
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
    evidence: { webPreview: "pending", webVisual: "pending", minigameLogic: "pending", douyinBuild: "pending" },
    douyinDevTool: "not-run",
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
      case "preview.ready": summary.previewUrl = event.url; summary.evidence.webPreview = "passed"; break;
      case "build.ready":
        summary.build = {
          projectId: event.projectId,
          target: event.target,
          cliVersion: event.cliVersion,
          fileCount: event.fileCount,
          totalBytes: event.totalBytes,
          mainPackageBytes: event.mainPackageBytes,
          assetCount: event.assetCount,
          assetManifestRevision: event.assetManifestRevision,
          deviceOrientation: event.deviceOrientation,
          ...(event.artifactSha256 === undefined ? {} : { artifactSha256: event.artifactSha256 }),
          ...(event.remoteOperations === undefined ? {} : { remoteOperations: event.remoteOperations }),
          ...(event.devToolVerification === undefined ? {} : { devToolVerification: event.devToolVerification }),
        };
        if (event.target === "douyin-mini-game") summary.evidence.douyinBuild = "passed";
        break;
      case "verification.ready":
        summary.verification = {
          passed: event.passed,
          outcome: event.outcome,
          score: event.score,
          lives: event.lives,
        };
        summary.evidence.webVisual = event.passed ? "passed" : "failed";
        break;
      case "gameplay.verified":
        summary.gameplayVerification = {
          target: event.target,
          genre: event.genre,
          winActions: event.scenarios[0].actions,
          lossActions: event.scenarios[1].actions,
          durationMs: event.durationMs,
        };
        summary.evidence.minigameLogic = "passed";
        break;
      case "evidence.status":
        if (event.surface === "web-preview") summary.evidence.webPreview = event.status;
        if (event.surface === "web-visual") summary.evidence.webVisual = event.status;
        if (event.surface === "minigame-logic") summary.evidence.minigameLogic = event.status;
        if (event.surface === "douyin-build") summary.evidence.douyinBuild = event.status;
        break;
      case "douyin.devtool.status": summary.douyinDevTool = event.status; break;
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
    `Web Preview: ${summary.evidence.webPreview}`,
    `Web Visual Verification: ${summary.evidence.webVisual}`,
    `Mini-game Logic: ${summary.evidence.minigameLogic} [no-render]`,
    `Douyin Build: ${summary.evidence.douyinBuild}`,
    `Douyin DevTool: ${summary.douyinDevTool}`,
  ];
  if (summary.verification !== undefined) {
    lines.push(
      `Verification: ${summary.verification.passed ? "passed" : "failed"} ` +
      `${summary.verification.outcome} score=${summary.verification.score} lives=${summary.verification.lives}`,
    );
  }
  if (summary.build !== undefined) {
    lines.push(
      `${summary.build.target === "wechat-mini-game" ? "WeChat" : "Douyin"} build: LayaAir ${summary.build.cliVersion} ${summary.build.deviceOrientation} ` +
      `files=${summary.build.fileCount} main=${formatMiB(summary.build.mainPackageBytes)} ` +
      `total=${formatMiB(summary.build.totalBytes)} assets=${summary.build.assetCount}@r${summary.build.assetManifestRevision}`,
    );
    if (summary.build.artifactSha256 !== undefined) {
      lines.push(
        `Handoff: sha256=${summary.build.artifactSha256} ` +
        `remote=${summary.build.remoteOperations ?? "unknown"} devtool=${summary.build.devToolVerification ?? "unknown"}`,
      );
    }
  }
  if (summary.gameplayVerification !== undefined) {
    lines.push(
      `Logic proof: ${summary.gameplayVerification.target} ${summary.gameplayVerification.genre} ` +
      `won(${summary.gameplayVerification.winActions}) lost(${summary.gameplayVerification.lossActions}) ` +
      `${summary.gameplayVerification.durationMs}ms [no-render]`,
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
