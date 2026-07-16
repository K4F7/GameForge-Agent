import {
  gameTaskSchema,
  runEventSchema,
  runIdSchema,
  runStatusSchema,
} from "@gameforge/contracts";
import { randomUUID } from "node:crypto";
import { lstat, mkdir, open, readFile, realpath, rename, rm } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { RunStore, type RunStoreOptions, type RunStoreSnapshot } from "./store.js";
import { TaskInbox, type TaskInboxOptions, type TaskInboxSnapshot } from "./tasks.js";

const MAX_STATE_BYTES = 32 * 1024 * 1024;
const runRecordSchema = z.strictObject({
  runId: runIdSchema,
  status: runStatusSchema,
  started: runEventSchema.refine(
    (event): event is Extract<z.infer<typeof runEventSchema>, { type: "run.started" }> => event.type === "run.started",
    "Stored start event must be run.started.",
  ).optional(),
  events: z.array(runEventSchema).min(1).max(100_000),
}).superRefine((record, context) => {
  if (record.started !== undefined && (record.started.runId !== record.runId || record.started.sequence !== 1)) {
    context.addIssue({ code: "custom", path: ["started"], message: "Stored start event must match the run." });
  }
  record.events.forEach((event, index) => {
    if (event.runId !== record.runId) {
      context.addIssue({ code: "custom", path: ["events", index, "runId"], message: "Event run ID must match." });
    }
    const previous = record.events[index - 1];
    if (previous !== undefined && event.sequence !== previous.sequence + 1) {
      context.addIssue({ code: "custom", path: ["events", index, "sequence"], message: "Events must be contiguous." });
    }
  });
});
const relayStateSchema = z.strictObject({
  schemaVersion: z.literal("1.0"),
  savedAt: z.string().datetime({ offset: true }),
  runs: z.array(runRecordSchema).max(10_000),
  tasks: z.array(gameTaskSchema).max(10_000),
}).superRefine((state, context) => {
  const runs = new Map(state.runs.map((run) => [run.runId, run]));
  state.tasks.forEach((task, index) => {
    const run = runs.get(task.runId);
    if (run === undefined) {
      context.addIssue({ code: "custom", path: ["tasks", index, "runId"], message: "Task run must exist." });
      return;
    }
    const expected = task.status === "completed" ? "succeeded"
      : task.status === "failed" ? "failed"
      : task.status === "stopped" ? "stopped"
      : undefined;
    if (expected !== undefined && run.status !== expected) {
      context.addIssue({ code: "custom", path: ["tasks", index, "status"], message: "Task and run terminal states must match." });
    }
    if (expected === undefined && ["succeeded", "failed", "stopped"].includes(run.status)) {
      context.addIssue({ code: "custom", path: ["tasks", index, "status"], message: "Active task cannot reference a terminal run." });
    }
  });
});

export type RelayStateOptions = RunStoreOptions & TaskInboxOptions;

export class RelayStatePersistence {
  readonly #filePath: string;
  #saveQueue: Promise<void> = Promise.resolve();

  constructor(filePath: string) {
    this.#filePath = statePath(filePath);
  }

  async load(options: RelayStateOptions = {}): Promise<{ store: RunStore; taskInbox: TaskInbox }> {
    const store = new RunStore(options);
    const taskInbox = new TaskInbox(store, options);
    const info = await lstat(this.#filePath).catch((error: unknown) => {
      if (isNodeError(error, "ENOENT")) return undefined;
      throw error;
    });
    if (info === undefined) return { store, taskInbox };
    if (!info.isFile() || info.isSymbolicLink()) throw new Error("Relay state path must be a regular file.");
    if (info.size > MAX_STATE_BYTES) throw new Error("Relay state file exceeds the byte limit.");
    const parsed = relayStateSchema.parse(JSON.parse(await readFile(this.#filePath, "utf8")) as unknown);
    const runSnapshot: RunStoreSnapshot = {
      runs: parsed.runs.map(({ started, ...run }) => (
        started === undefined ? run : { ...run, started }
      )),
    };
    const taskSnapshot: TaskInboxSnapshot = { tasks: parsed.tasks };
    store.restore(runSnapshot);
    taskInbox.restore(taskSnapshot);
    return { store, taskInbox };
  }

  save(store: RunStore, taskInbox: TaskInbox): Promise<void> {
    const operation = this.#saveQueue.then(() => this.#write(store.snapshot(), taskInbox.snapshot()));
    this.#saveQueue = operation.catch(() => undefined);
    return operation;
  }

  async #write(runs: RunStoreSnapshot, tasks: TaskInboxSnapshot): Promise<void> {
    const value = relayStateSchema.parse({
      schemaVersion: "1.0",
      savedAt: new Date().toISOString(),
      runs: runs.runs,
      tasks: tasks.tasks,
    });
    const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
    if (bytes.byteLength > MAX_STATE_BYTES) throw new Error("Relay state exceeds the byte limit.");
    const parent = path.dirname(this.#filePath);
    await mkdir(parent, { recursive: true });
    const parentInfo = await lstat(parent);
    if (!parentInfo.isDirectory() || parentInfo.isSymbolicLink()) {
      throw new Error("Relay state directory must be a real directory.");
    }
    const realParent = await realpath(parent);
    const destination = path.join(realParent, path.basename(this.#filePath));
    const temporary = path.join(realParent, `.${path.basename(this.#filePath)}.${randomUUID()}.tmp`);
    const handle = await open(temporary, "wx");
    try {
      await handle.writeFile(bytes);
      await handle.sync();
    } finally {
      await handle.close();
    }
    try {
      await rename(temporary, destination);
    } catch (error) {
      await rm(temporary, { force: true });
      throw error;
    }
  }
}

function statePath(value: string): string {
  if (!path.isAbsolute(value)) throw new Error("Relay state file path must be absolute.");
  const normalized = path.resolve(value);
  if (path.parse(normalized).root === normalized) throw new Error("Relay state file cannot be a filesystem root.");
  return normalized;
}

function isNodeError(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}
