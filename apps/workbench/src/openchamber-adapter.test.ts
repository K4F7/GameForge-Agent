import { describe, expect, it } from "vitest";
import type { GameTask } from "@gameforge/contracts";
import { createInitialRunState } from "./run-state.js";
import { createOpenChamberRuntimeView } from "./openchamber-adapter.js";

describe("createOpenChamberRuntimeView", () => {
  it("maps GameForge Task and Run state without exposing OpenCode session types", () => {
    const initial = createInitialRunState();
    const runState = {
      ...initial,
      runId: "run-active",
      status: "succeeded" as const,
      lastSequence: 12,
      phases: initial.phases.map((phase) => ({ ...phase, status: "succeeded" as const })),
      logs: [{ id: "run-active:12", sequence: 12, source: "agent" as const, level: "success" as const, message: "done" }],
      verification: {
        projectId: "project-1",
        passed: true,
        outcome: "won" as const,
        score: 5,
        lives: 3,
        remainingSeconds: 12,
        evidencePath: "evidence.json",
        canvas: { width: 960, height: 540 },
        diagnostics: { consoleErrors: 0, pageErrors: 0, failedRequests: 0 },
        actionsExecuted: 4,
        durationMs: 200,
      },
      assetManifestRevision: 2,
      generation: {
        projectId: "project-1",
        mode: "apply" as const,
        operation: "update" as const,
        plan: {
          generatorVersion: "0.12.0",
          projectId: "project-1",
          target: "web" as const,
          specSha256: "a".repeat(64),
          planSha256: "b".repeat(64),
          files: [{ path: "src/main.ts", bytes: 128, sha256: "c".repeat(64) }],
        },
        update: {
          currentPlanSha256: "d".repeat(64),
          updatedPaths: ["src/main.ts"],
          unchangedPaths: [],
          preservedPaths: [],
          deletedPaths: [],
          conflicts: [],
        },
      },
      audit: {
        truncated: false,
        totalCalls: 1,
        calls: [{ sequence: 1, tool: "generate_game_project", durationMs: 20, outcome: "success" as const }],
      },
    };
    const tasks = [{
      taskId: "task-00000000-0000-0000-0000-000000000001",
      runId: "run-active",
      prompt: "制作一个拥有较长需求描述并且能够验证摘要截断逻辑的安全训练小游戏任务，同时包含收集目标、移动危险物和限时抵达出口条件",
      language: "zh-CN",
      status: "queued",
      createdAt: "2026-07-21T10:00:00.000Z",
    }] satisfies ReadonlyArray<GameTask>;

    const view = createOpenChamberRuntimeView({
      runState,
      taskHistory: tasks,
      selectedTaskId: tasks[0]!.taskId,
      fallbackRunId: "run-fallback",
    });

    expect(view.runtime).toBe("gameforge-relay");
    expect(view.activeRun).toMatchObject({ runId: "run-active", completedPhases: 7, totalPhases: 7, lastSequence: 12 });
    expect(view.tasks[0]).toMatchObject({ selected: true, statusLabel: "排队中", projectLabel: "新项目" });
    expect(view.tasks[0]!.title.endsWith("…")).toBe(true);
    expect(view.evidenceCount).toBe(1);
    expect(view.eventCount).toBe(1);
    expect(view.context.project).toMatchObject({ projectId: "project-1", totalBytes: 128, update: { updated: 1, conflicts: 0 } });
    expect(view.context.manifest.revision).toBe(2);
    expect(view.context.audit?.calls[0]).toMatchObject({ tool: "generate_game_project" });
  });
});
