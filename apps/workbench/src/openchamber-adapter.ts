import type { GameTask } from "@gameforge/contracts";
import type { RunState, RunStatus } from "./run-state.js";

export type OpenChamberTaskItem = {
  taskId: string;
  runId: string;
  title: string;
  projectLabel: string;
  status: GameTask["status"];
  statusLabel: string;
  createdAt: string;
  selected: boolean;
};

export type OpenChamberRuntimeView = {
  runtime: "gameforge-relay";
  activeRun: {
    runId: string;
    status: RunStatus;
    completedPhases: number;
    totalPhases: number;
    lastSequence: number;
  };
  tasks: ReadonlyArray<OpenChamberTaskItem>;
  evidenceCount: number;
  eventCount: number;
  context: {
    project: null | {
      projectId: string;
      target: string;
      generatorVersion: string;
      mode: "dry-run" | "apply";
      operation: "create" | "update";
      planSha256: string;
      totalBytes: number;
      files: ReadonlyArray<{ path: string; bytes: number }>;
      update: null | {
        updated: number;
        unchanged: number;
        preserved: number;
        deleted: number;
        conflicts: number;
      };
    };
    manifest: {
      revision: number;
      assets: ReadonlyArray<{ assetId: string; kind: string; path: string; origin: string }>;
    };
    audit: null | {
      totalCalls: number;
      truncated: boolean;
      calls: ReadonlyArray<{ sequence: number; tool: string; durationMs: number; outcome: "success" | "error" }>;
    };
  };
};

const taskStatusLabels: Record<GameTask["status"], string> = {
  queued: "排队中",
  claimed: "执行中",
  completed: "已完成",
  failed: "失败",
  stopped: "已停止",
};

export function createOpenChamberRuntimeView(input: {
  runState: RunState;
  taskHistory: ReadonlyArray<GameTask>;
  selectedTaskId: string;
  fallbackRunId: string;
}): OpenChamberRuntimeView {
  const { runState } = input;
  return {
    runtime: "gameforge-relay",
    activeRun: {
      runId: runState.runId ?? input.fallbackRunId,
      status: runState.status,
      completedPhases: runState.phases.filter((phase) => phase.status === "succeeded").length,
      totalPhases: runState.phases.length,
      lastSequence: runState.lastSequence,
    },
    tasks: input.taskHistory.map((task) => ({
      taskId: task.taskId,
      runId: task.runId,
      title: summarizeTaskPrompt(task.prompt),
      projectLabel: task.projectId ?? "新项目",
      status: task.status,
      statusLabel: taskStatusLabels[task.status],
      createdAt: task.createdAt,
      selected: task.taskId === input.selectedTaskId,
    })),
    evidenceCount: Number(runState.build !== null) +
      Number(runState.verification !== null) +
      Number(runState.gameplayVerification !== null),
    eventCount: runState.logs.length,
    context: {
      project: runState.generation === null ? null : {
        projectId: runState.generation.projectId,
        target: runState.generation.plan.target,
        generatorVersion: runState.generation.plan.generatorVersion,
        mode: runState.generation.mode,
        operation: runState.generation.operation,
        planSha256: runState.generation.plan.planSha256,
        totalBytes: runState.generation.plan.files.reduce((total, file) => total + file.bytes, 0),
        files: runState.generation.plan.files.map(({ path, bytes }) => ({ path, bytes })),
        update: runState.generation.update === null ? null : {
          updated: runState.generation.update.updatedPaths.length,
          unchanged: runState.generation.update.unchangedPaths.length,
          preserved: runState.generation.update.preservedPaths.length,
          deleted: runState.generation.update.deletedPaths.length,
          conflicts: runState.generation.update.conflicts.length,
        },
      },
      manifest: {
        revision: runState.assetManifestRevision,
        assets: runState.assets.map((asset) => ({
          assetId: asset.assetId,
          kind: asset.kind,
          path: asset.path,
          origin: asset.provenance.origin,
        })),
      },
      audit: runState.audit,
    },
  };
}

function summarizeTaskPrompt(prompt: string): string {
  const normalized = prompt.replace(/\s+/g, " ").trim();
  return normalized.length <= 42 ? normalized : `${normalized.slice(0, 41)}…`;
}
