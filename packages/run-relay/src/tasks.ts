import {
  claimGameTaskRequestSchema,
  createGameTaskRequestSchema,
  gameTaskIdSchema,
  gameTaskSchema,
  listGameTasksRequestSchema,
  type ClaimGameTaskRequest,
  type CreateGameTaskRequest,
  type CreateGameTaskResponse,
  type GameTask,
  type ListGameTasksRequest,
  type WireRunEvent,
} from "@gameforge/contracts";
import { randomUUID } from "node:crypto";
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
          existing.projectId !== request.projectId ||
          existing.requestedSpecialists.join("\0") !== request.requestedSpecialists.join("\0")) {
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
      requestedSpecialists: request.requestedSpecialists,
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

  claim(taskIdInput: string, input: ClaimGameTaskRequest): GameTask {
    const taskId = gameTaskIdSchema.parse(taskIdInput);
    const { agentId } = claimGameTaskRequestSchema.parse(input);
    const current = this.#tasks.get(taskId);
    if (current === undefined) throw new TaskInboxError(404, "task_not_found", `Unknown task: ${taskId}`);
    if (current.status === "completed" || current.status === "failed" || current.status === "stopped") {
      throw new TaskInboxError(409, "task_terminal", "Terminal tasks cannot be claimed.");
    }
    if (current.status === "claimed") {
      if (current.claimedBy === agentId) return clone(current);
      throw new TaskInboxError(409, "task_claimed", "Task is already claimed by another agent.");
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

  appendRun(runId: string, batch: unknown): ReadonlyArray<WireRunEvent> {
    const taskId = this.#runToTask.get(runId);
    const current = taskId === undefined ? undefined : this.#tasks.get(taskId);
    if (current?.status === "queued") {
      throw new TaskInboxError(409, "task_unclaimed", "A queued task must be claimed before events are published.");
    }
    const events = this.#runStore.append(runId, batch);
    if (events.some((event) => event.type === "phase.failed" && !event.repairable)) {
      this.#markTerminal(runId, "failed");
    }
    return events;
  }

  finishRun(runId: string, type: "run.completed" | "run.stopped"): WireRunEvent {
    const taskId = this.#runToTask.get(runId);
    const current = taskId === undefined ? undefined : this.#tasks.get(taskId);
    if (type === "run.completed" && current?.status === "queued") {
      throw new TaskInboxError(409, "task_unclaimed", "A queued task must be claimed before completion.");
    }
    const event = this.#runStore.finish(runId, type);
    if (taskId === undefined || current === undefined ||
        current.status === "completed" || current.status === "failed" || current.status === "stopped") return event;
    this.#markTerminal(runId, type === "run.completed" ? "completed" : "stopped");
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

  #markTerminal(runId: string, status: "completed" | "failed" | "stopped"): void {
    const taskId = this.#runToTask.get(runId);
    if (taskId === undefined) return;
    const current = this.#tasks.get(taskId);
    if (current === undefined) return;
    this.#tasks.set(taskId, gameTaskSchema.parse({
      ...current,
      status,
      completedAt: new Date().toISOString(),
    }));
  }
}

function clone(task: GameTask): GameTask {
  return { ...task, requestedSpecialists: [...task.requestedSpecialists] };
}
