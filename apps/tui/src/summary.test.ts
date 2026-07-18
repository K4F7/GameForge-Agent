import { describe, expect, it } from "vitest";
import type { WireRunEvent } from "@gameforge/contracts";
import { formatSummary, summarizeRun } from "./summary.js";

const emittedAt = "2026-07-18T02:00:00+08:00";

describe("terminal run summary", () => {
  it("projects specification, assets, verification and completion", () => {
    const events: WireRunEvent[] = [
      { type: "run.started", runId: "run-1", sequence: 1, emittedAt, language: "en-US" },
      {
        type: "spec.ready", runId: "run-1", sequence: 2, emittedAt,
        spec: {
          title: "Safety Sprint", locale: "en-US", genre: "arcade", objective: "Collect equipment.",
          controls: ["Arrow keys"], winCondition: "Collect everything.", loseCondition: "Time expires.",
          targetDurationSeconds: 60,
        },
      },
      {
        type: "asset.ready", runId: "run-1", sequence: 3, emittedAt, projectId: "safety-sprint", manifestRevision: 1,
        entry: {
          assetId: "player", kind: "image", role: "player", path: "assets/player.png", mimeType: "image/png",
          bytes: 128, sha256: "a".repeat(64),
          provenance: { assetId: "player", kind: "image", origin: "generated", provider: "volcengine-ark", license: "test", sha256: "a".repeat(64) },
        },
      },
      {
        type: "build.ready", runId: "run-1", sequence: 4, emittedAt, projectId: "safety-sprint",
        target: "douyin-mini-game", cliVersion: "3.4.0", passed: true, fileCount: 16,
        totalBytes: 1_108_438, mainPackageBytes: 1_108_438, subpackages: [], deviceOrientation: "portrait",
        capabilities: { network: false, login: false, share: false, ads: false, payments: false },
        allowedNetworkHosts: [], assetManifestRevision: 1, assetCount: 1,
        stdoutTruncated: false, stderrTruncated: false,
      },
      {
        type: "gameplay.verified", runId: "run-1", sequence: 5, emittedAt, projectId: "safety-sprint",
        target: "douyin-mini-game", genre: "arcade", passed: true,
        scenarios: [
          { name: "genre-win", outcome: "won", actions: 2 },
          { name: "timeout-loss", outcome: "lost", actions: 1 },
        ],
        durationMs: 42, templateSha256: "a".repeat(64),
      },
      {
        type: "verification.ready", runId: "run-1", sequence: 6, emittedAt, projectId: "safety-sprint",
        passed: true, outcome: "won", score: 2, lives: 3, remainingSeconds: 50,
        evidencePath: ".gameforge/verification/proof.png", canvas: { width: 960, height: 540 },
        diagnostics: { consoleErrors: 0, pageErrors: 0, failedRequests: 0 }, actionsExecuted: 7, durationMs: 1000,
      },
      { type: "run.completed", runId: "run-1", sequence: 7, emittedAt },
    ];
    const summary = summarizeRun(events);
    expect(summary).toMatchObject({ status: "succeeded", locale: "en-US", title: "Safety Sprint", assets: 1 });
    expect(summary?.build).toMatchObject({ cliVersion: "3.4.0", fileCount: 16, assetCount: 1 });
    expect(formatSummary(summary!)).toContain("Douyin build: LayaAir 3.4.0 portrait files=16");
    expect(formatSummary(summary!)).toContain("Verification: passed won score=2 lives=3");
    expect(formatSummary(summary!)).toContain("Logic proof: douyin-mini-game arcade won(2) lost(1) 42ms [no-render]");
    const wechat = summarizeRun(events.map((event) => event.type === "build.ready"
      ? { ...event, target: "wechat-mini-game" as const }
      : event));
    expect(formatSummary(wechat!)).toContain("WeChat build: LayaAir 3.4.0 portrait files=16");
  });

  it("returns null when a replay page does not contain the start event", () => {
    expect(summarizeRun([{ type: "run.completed", runId: "run-1", sequence: 2, emittedAt }])).toBeNull();
  });
});
