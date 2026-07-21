import type { GameTask } from "@gameforge/contracts";
import type { RunState, RunStatus } from "./run-state.js";
import { specialistMentionLabels } from "./specialist-agents.js";

export type OpenChamberTaskItem = {
  taskId: string;
  runId: string;
  title: string;
  projectLabel: string;
  specialistMentions: ReadonlyArray<string>;
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
      specialistMentions: specialistMentionLabels(task.requestedSpecialists),
      status: task.status,
      statusLabel: taskStatusLabels[task.status],
      createdAt: task.createdAt,
      selected: task.taskId === input.selectedTaskId,
    })),
    evidenceCount: Number(runState.build !== null) +
      Number(runState.verification !== null) +
      Number(runState.gameplayVerification !== null),
    eventCount: runState.logs.length,
  };
}

function summarizeTaskPrompt(prompt: string): string {
  const normalized = prompt.replace(/\s+/g, " ").trim();
  return normalized.length <= 42 ? normalized : `${normalized.slice(0, 41)}…`;
}
