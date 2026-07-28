import {
  claimGameTaskRequestSchema,
  compileTaskAcceptanceContractInputSchema,
  createGameTaskRequestSchema,
  gameTaskIdSchema,
  gameTaskSchema,
  gameTaskAcceptanceCompileResultSchema,
  gameTaskTransitionRequestSchema,
  gameTaskTransitionResultSchema,
  listGameTasksRequestSchema,
  type ClaimGameTaskRequest,
  type CreateGameTaskRequest,
  type CreateGameTaskResponse,
  type GameTask,
  type GameTaskAcceptanceCompileResult,
  type GameTaskTransitionResult,
  type ListGameTasksRequest,
  type TaskAcceptanceContract,
  type WireRunEvent,
} from "@gameforge/contracts";
import { createHash, randomUUID } from "node:crypto";
import { RunStore } from "./store.js";

export class TaskInboxError extends Error {
  constructor(readonly statusCode: number, readonly code: string, message: string) {
    super(message);
    this.name = "TaskInboxError";
  }
}

export type TaskInboxOptions = { maxTasks?: number };
export type TaskInboxSnapshot = { tasks: GameTask[] };

export class TaskInbox {
  readonly #maxTasks: number;
  readonly #runStore: RunStore;
  readonly #runToTask = new Map<string, string>();
  readonly #tasks = new Map<string, GameTask>();

  constructor(runStore: RunStore, options: TaskInboxOptions = {}) {
    const maxTasks = options.maxTasks ?? 100;
    if (!Number.isSafeInteger(maxTasks) || maxTasks < 1 || maxTasks > 10_000) {
      throw new Error("maxTasks must be an integer between 1 and 10000.");
    }
    this.#runStore = runStore;
    this.#maxTasks = maxTasks;
  }

  create(input: CreateGameTaskRequest): CreateGameTaskResponse {
    const request = createGameTaskRequestSchema.parse(input);
    const existingTaskId = this.#runToTask.get(request.runId);
    if (existingTaskId !== undefined) {
      const existing = this.#tasks.get(existingTaskId);
      if (existing === undefined) throw new Error("Task inbox run index is inconsistent.");
      if (existing.prompt !== request.prompt || existing.language !== request.language ||
          existing.projectId !== request.projectId) {
        throw new TaskInboxError(
          409,
          "task_run_conflict",
          "Run ID is already bound to a different task request.",
        );
      }
      return { task: clone(existing), event: this.#runStore.startedEvent(request.runId) };
    }
    if (this.#tasks.size >= this.#maxTasks) {
      throw new TaskInboxError(503, "task_capacity_reached", "Task inbox capacity has been reached.");
    }
    const event = this.#runStore.create(request.runId, request.language);
    const task = gameTaskSchema.parse({
      taskId: `task-${randomUUID()}`,
      runId: request.runId,
      prompt: request.prompt,
      language: request.language,
      ...(request.projectId === undefined ? {} : { projectId: request.projectId }),
      status: "queued",
      createdAt: new Date().toISOString(),
    });
    this.#tasks.set(task.taskId, task);
    this.#runToTask.set(task.runId, task.taskId);
    return { task: clone(task), event };
  }

  get(taskIdInput: string): GameTask {
    const taskId = gameTaskIdSchema.parse(taskIdInput);
    const task = this.#tasks.get(taskId);
    if (task === undefined) throw new TaskInboxError(404, "task_not_found", `Unknown task: ${taskId}`);
    return clone(task);
  }

  list(input: ListGameTasksRequest): ReadonlyArray<GameTask> {
    const request = listGameTasksRequestSchema.parse(input);
    return [...this.#tasks.values()]
      .reverse()
      .filter((task) => request.status === undefined || task.status === request.status)
      .slice(0, request.limit)
      .map(clone);
  }

  acceptanceContract(taskIdInput: string): TaskAcceptanceContract | undefined {
    const task = this.get(taskIdInput);
    return task.acceptanceContract;
  }

  isAcceptanceFingerprintCurrent(taskIdInput: string, fingerprint: string): boolean {
    return this.acceptanceContract(taskIdInput)?.fingerprint === fingerprint;
  }

  compileAcceptanceContract(
    taskIdInput: string,
    input: unknown,
  ): GameTaskAcceptanceCompileResult {
    const taskId = gameTaskIdSchema.parse(taskIdInput);
    const current = this.#tasks.get(taskId);
    if (current === undefined) throw new TaskInboxError(404, "task_not_found", `Unknown task: ${taskId}`);
    const request = compileTaskAcceptanceContractInputSchema.parse(input);
    const preWork = current.status === "queued" || current.status === "needs-info";
    const claimedBeforeImplementation = current.status === "claimed";
    const inFlightUpdate = (current.status === "claimed" || current.status === "in-progress") &&
      current.acceptanceContract !== undefined;
    if (!preWork && !claimedBeforeImplementation && !inFlightUpdate) {
      throw new TaskInboxError(409, "task_acceptance_locked", "Acceptance can only be compiled before implementation.");
    }
    const requirementIssues = request.criteria.length === 0 && request.requirementIssues.length === 0
      ? [{ code: "missing" as const, detail: "At least one acceptance criterion is required." }]
      : request.requirementIssues;
    if (requirementIssues.length > 0) {
      if (!preWork && !claimedBeforeImplementation) {
        throw new TaskInboxError(
          409,
          "task_acceptance_locked",
          "Ambiguous requirements must be resolved before implementation.",
        );
      }
      const task = gameTaskSchema.parse({
        ...current,
        status: "needs-info",
        reasonCode: { schemaVersion: "1.0", code: "requirements-ambiguous" },
        claimedAt: undefined,
        claimedBy: undefined,
        acceptanceContract: undefined,
      });
      this.#tasks.set(taskId, task);
      return gameTaskAcceptanceCompileResultSchema.parse({
        schemaVersion: "1.0",
        outcome: "needs-info",
        task: clone(task),
        issues: requirementIssues,
      });
    }
    const fingerprintSource = {
      schemaVersion: "1.0" as const,
      contractVersion: request.contractVersion,
      criteria: request.criteria,
    };
    const contract = {
      ...fingerprintSource,
      fingerprint: createHash("sha256").update(JSON.stringify(fingerprintSource), "utf8").digest("hex"),
    };
    const frozen = current.acceptanceContract;
    if (frozen !== undefined && (
      request.contractVersion < frozen.contractVersion ||
      (request.contractVersion === frozen.contractVersion && contract.fingerprint !== frozen.fingerprint)
    )) {
      throw new TaskInboxError(
        409,
        "task_acceptance_version_conflict",
        "Changed acceptance criteria require a higher contract version.",
      );
    }
    if (frozen?.fingerprint === contract.fingerprint) {
      return gameTaskAcceptanceCompileResultSchema.parse({
        schemaVersion: "1.0",
        outcome: "frozen",
        task: clone(current),
        contract: frozen,
      });
    }
    const task = gameTaskSchema.parse({
      ...current,
      ...(preWork ? { status: "queued", reasonCode: undefined } : {}),
      acceptanceContract: contract,
    });
    this.#tasks.set(taskId, task);
    return gameTaskAcceptanceCompileResultSchema.parse({
      schemaVersion: "1.0",
      outcome: "frozen",
      task: clone(task),
      contract,
    });
  }

  claim(taskIdInput: string, input: ClaimGameTaskRequest): GameTask {
    const taskId = gameTaskIdSchema.parse(taskIdInput);
    const { agentId } = claimGameTaskRequestSchema.parse(input);
    const current = this.#tasks.get(taskId);
    if (current === undefined) throw new TaskInboxError(404, "task_not_found", `Unknown task: ${taskId}`);
    if (current.status === "claimed" || current.status === "in-progress") {
      if (current.claimedBy === agentId) return clone(current);
      throw new TaskInboxError(409, "task_claimed", "Task is already claimed by another agent.");
    }
    if (current.status !== "queued") {
      throw new TaskInboxError(409, "task_not_queued", "Only queued tasks can be claimed.");
    }
    const task = gameTaskSchema.parse({
      ...current,
      status: "claimed",
      claimedAt: new Date().toISOString(),
      claimedBy: agentId,
    });
    this.#tasks.set(taskId, task);
    return clone(task);
  }

  transition(taskIdInput: string, input: unknown): GameTaskTransitionResult {
    const taskId = gameTaskIdSchema.parse(taskIdInput);
    const current = this.#tasks.get(taskId);
    if (current === undefined) throw new TaskInboxError(404, "task_not_found", `Unknown task: ${taskId}`);
    const request = gameTaskTransitionRequestSchema.safeParse(input);
    if (!request.success) {
      return gameTaskTransitionResultSchema.parse({
        schemaVersion: "1.0",
        outcome: "invalid",
        code: "invalid-transition-request",
        task: clone(current),
      });
    }
    if (current.claimedBy !== undefined && request.data.agentId !== current.claimedBy) {
      return gameTaskTransitionResultSchema.parse({
        schemaVersion: "1.0",
        outcome: "rejected",
        code: "claimant-mismatch",
        task: clone(current),
      });
    }
    const allowed = TASK_TRANSITIONS[current.status].includes(request.data.status);
    if (!allowed) {
      return gameTaskTransitionResultSchema.parse({
        schemaVersion: "1.0",
        outcome: "rejected",
        code: "illegal-transition",
        task: clone(current),
      });
    }
    if (request.data.status === "in-progress" && current.acceptanceContract === undefined) {
      return gameTaskTransitionResultSchema.parse({
        schemaVersion: "1.0",
        outcome: "rejected",
        code: "missing-acceptance-contract",
        task: clone(current),
      });
    }
    const requiredRunStatus = REQUIRED_RUN_STATUS[request.data.status];
    if (requiredRunStatus !== undefined && this.#runStore.status(current.runId) !== requiredRunStatus) {
      return gameTaskTransitionResultSchema.parse({
        schemaVersion: "1.0",
        outcome: "rejected",
        code: "run-state-mismatch",
        task: clone(current),
      });
    }
    const candidate = gameTaskSchema.safeParse({
      ...current,
      status: request.data.status,
      reasonCode: request.data.reasonCode,
      ...(request.data.status === "queued" ? {
        claimedAt: undefined,
        claimedBy: undefined,
      } : {}),
      ...(["completed", "failed", "canceled", "conflicted"].includes(request.data.status)
        ? { completedAt: new Date().toISOString() }
        : {}),
    });
    if (!candidate.success) {
      return gameTaskTransitionResultSchema.parse({
        schemaVersion: "1.0",
        outcome: "rejected",
        code: "reason-code-mismatch",
        task: clone(current),
      });
    }
    this.#tasks.set(taskId, candidate.data);
    return gameTaskTransitionResultSchema.parse({
      schemaVersion: "1.0",
      outcome: "accepted",
      task: clone(candidate.data),
    });
  }

  appendRun(runId: string, batch: unknown): ReadonlyArray<WireRunEvent> {
    const taskId = this.#runToTask.get(runId);
    const current = taskId === undefined ? undefined : this.#tasks.get(taskId);
    if (current !== undefined && isUnclaimed(current.status)) {
      throw new TaskInboxError(409, "task_unclaimed", "A task must be claimed before events are published.");
    }
    const events = this.#runStore.append(runId, batch);
    return events;
  }

  finishRun(runId: string, type: "run.completed" | "run.stopped"): WireRunEvent {
    const taskId = this.#runToTask.get(runId);
    const current = taskId === undefined ? undefined : this.#tasks.get(taskId);
    if (type === "run.completed" && current !== undefined && isUnclaimed(current.status)) {
      throw new TaskInboxError(409, "task_unclaimed", "A task must be claimed before completion.");
    }
    const event = this.#runStore.finish(runId, type);
    return event;
  }

  snapshot(): TaskInboxSnapshot {
    return { tasks: [...this.#tasks.values()].map(clone) };
  }

  restore(snapshot: TaskInboxSnapshot): void {
    if (this.#tasks.size > 0) throw new Error("Task inbox can only restore into an empty instance.");
    if (snapshot.tasks.length > this.#maxTasks) throw new Error("Task snapshot exceeds configured capacity.");
    for (const input of snapshot.tasks) {
      const task = gameTaskSchema.parse(input);
      if (this.#tasks.has(task.taskId)) throw new Error(`Task snapshot contains a duplicate task: ${task.taskId}`);
      if (this.#runToTask.has(task.runId)) throw new Error(`Task snapshot contains a duplicate run: ${task.runId}`);
      if (!this.#runStore.has(task.runId)) throw new Error(`Task snapshot references an unknown run: ${task.runId}`);
      this.#tasks.set(task.taskId, clone(task));
      this.#runToTask.set(task.runId, task.taskId);
    }
  }

}

function clone(task: GameTask): GameTask {
  return {
    ...task,
    ...(task.reasonCode === undefined ? {} : { reasonCode: { ...task.reasonCode } }),
    ...(task.acceptanceContract === undefined ? {} : {
      acceptanceContract: {
        ...task.acceptanceContract,
        criteria: task.acceptanceContract.criteria.map((criterion) => ({
          ...criterion,
          verification: { ...criterion.verification },
        })),
      },
    }),
  };
}

function isUnclaimed(status: GameTask["status"]): boolean {
  return status === "queued" || status === "needs-info";
}

const TASK_TRANSITIONS: Record<GameTask["status"], ReadonlyArray<GameTask["status"]>> = {
  // claimed 只能由 claim 命令从 queued 进入；恢复可重放同一 claimant 的 owned work，但不自动重试。
  queued: ["needs-info", "canceled"],
  "needs-info": ["queued", "canceled"],
  claimed: ["in-progress", "canceled"],
  "in-progress": ["retryable", "completed", "failed", "canceled", "conflicted"],
  retryable: ["queued", "canceled"],
  completed: [],
  failed: [],
  canceled: [],
  conflicted: [],
};

const REQUIRED_RUN_STATUS: Partial<Record<GameTask["status"], "succeeded" | "failed" | "stopped">> = {
  completed: "succeeded",
  failed: "failed",
  canceled: "stopped",
  conflicted: "stopped",
};
