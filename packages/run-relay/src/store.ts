import {
  runEventBatchSchema,
  runIdSchema,
  type RunEventBatch,
  type RunStatus,
  type WireRunEvent,
} from "@gameforge/contracts";
import { isDeepStrictEqual } from "node:util";

const terminalStatuses: ReadonlySet<RunStatus> = new Set(["succeeded", "failed", "stopped"]);
const maxAuthoritativeEvents = 100_000;

type RunRecord = {
  authoritativeEvents: WireRunEvent[];
  events: WireRunEvent[];
  started: Extract<WireRunEvent, { type: "run.started" }>;
  status: RunStatus;
  subscribers: Set<(event: WireRunEvent) => void>;
};

type StagedNotification = { runId: string; event: WireRunEvent };

export class RunStoreError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "RunStoreError";
  }
}

export type RunStoreOptions = {
  maxRuns?: number;
  maxEventsPerRun?: number;
};

export type RunStoreSnapshot = {
  schemaVersion?: 2;
  runs: Array<{
    runId: string;
    status: RunStatus;
    events: WireRunEvent[];
    authoritativeEvents?: WireRunEvent[];
    started?: Extract<WireRunEvent, { type: "run.started" }>;
  }>;
};

export class RunStore {
  readonly #maxEventsPerRun: number;
  readonly #maxRuns: number;
  readonly #runs = new Map<string, RunRecord>();
  #stagedNotifications: StagedNotification[] | undefined;

  constructor(options: RunStoreOptions = {}) {
    this.#maxRuns = boundedInteger(options.maxRuns ?? 100, 1, 10_000, "maxRuns");
    this.#maxEventsPerRun = boundedInteger(
      options.maxEventsPerRun ?? 10_000,
      10,
      100_000,
      "maxEventsPerRun",
    );
  }

  create(
    runIdInput: string,
    language?: "zh-CN" | "en-US",
  ): Extract<WireRunEvent, { type: "run.started" }> {
    const runId = runIdSchema.parse(runIdInput);
    if (this.#runs.has(runId)) {
      throw new RunStoreError(409, "run_exists", `Run already exists: ${runId}`);
    }
    if (this.#runs.size >= this.#maxRuns) {
      throw new RunStoreError(503, "run_capacity_reached", "Run relay capacity has been reached.");
    }

    const started = immutableClone<Extract<WireRunEvent, { type: "run.started" }>>({
      type: "run.started",
      runId,
      sequence: 1,
      emittedAt: new Date().toISOString(),
      ...(language === undefined ? {} : { language }),
    });
    this.#runs.set(runId, {
      authoritativeEvents: [started],
      events: [started],
      started,
      status: "running",
      subscribers: new Set(),
    });
    return immutableClone(started);
  }

  append(runIdInput: string, batchInput: unknown): ReadonlyArray<WireRunEvent> {
    const runId = runIdSchema.parse(runIdInput);
    const batch = runEventBatchSchema.parse(batchInput);
    if (batch.runId !== runId) {
      throw new RunStoreError(400, "run_id_mismatch", "Route and batch run IDs must match.");
    }
    const record = this.#record(runId);
    if (terminalStatuses.has(record.status)) {
      throw new RunStoreError(409, "run_terminal", "Cannot append events to a terminal run.");
    }
    const lastSequence = record.events.at(-1)?.sequence ?? 0;
    if (batch.after !== lastSequence) {
      throw new RunStoreError(
        409,
        "cursor_conflict",
        `Expected append cursor ${lastSequence}, received ${batch.after}.`,
      );
    }
    if (batch.events.some((event) => event.type === "run.started")) {
      throw new RunStoreError(400, "invalid_start_event", "run.started can only be created by the relay.");
    }

    let nextStatus = record.status;
    for (const event of batch.events) {
      if (terminalStatuses.has(nextStatus)) {
        throw new RunStoreError(400, "event_after_terminal", "A batch cannot contain events after a terminal event.");
      }
      nextStatus = statusAfter(nextStatus, event);
    }
    const authoritativeEventCount = record.authoritativeEvents.length + batch.events.length;
    if (authoritativeEventCount > maxAuthoritativeEvents ||
        (authoritativeEventCount === maxAuthoritativeEvents && !terminalStatuses.has(nextStatus))) {
      throw new RunStoreError(503, "run_evidence_capacity_reached", "Authoritative Run evidence capacity has been reached.");
    }

    const committedEvents = batch.events.map((event) => immutableClone(event));
    for (const event of committedEvents) {
      record.authoritativeEvents.push(event);
      record.events.push(event);
    }
    record.status = nextStatus;
    if (record.events.length > this.#maxEventsPerRun) {
      record.events.splice(0, record.events.length - this.#maxEventsPerRun);
    }
    for (const event of committedEvents) this.#notify(runId, event);
    return Object.freeze(committedEvents.map((event) => immutableClone(event)));
  }

  finish(runIdInput: string, type: "run.completed" | "run.stopped"): WireRunEvent {
    const runId = runIdSchema.parse(runIdInput);
    const record = this.#record(runId);
    const desiredStatus: RunStatus = type === "run.completed" ? "succeeded" : "stopped";
    const last = record.events.at(-1);
    if (record.status === desiredStatus && last?.type === type) return immutableClone(last);
    if (terminalStatuses.has(record.status)) {
      throw new RunStoreError(409, "run_terminal", "Run already ended with a different terminal state.");
    }
    if (record.authoritativeEvents.length >= maxAuthoritativeEvents) {
      throw new RunStoreError(503, "run_evidence_capacity_reached", "Authoritative Run evidence capacity has been reached.");
    }
    const event = immutableClone<WireRunEvent>({
      type,
      runId,
      sequence: (last?.sequence ?? 0) + 1,
      emittedAt: new Date().toISOString(),
    });
    record.events.push(event);
    record.authoritativeEvents.push(event);
    if (record.events.length > this.#maxEventsPerRun) {
      record.events.splice(0, record.events.length - this.#maxEventsPerRun);
    }
    record.status = desiredStatus;
    this.#notify(runId, event);
    return immutableClone(event);
  }

  stageNotifications(): { commit: () => void; discard: () => void } {
    if (this.#stagedNotifications !== undefined) {
      throw new Error("Run store notifications are already staged.");
    }
    const staged: StagedNotification[] = [];
    this.#stagedNotifications = staged;
    let active = true;
    const close = (): boolean => {
      if (!active) return false;
      active = false;
      if (this.#stagedNotifications === staged) this.#stagedNotifications = undefined;
      return true;
    };
    return {
      commit: () => {
        if (!close()) return;
        for (const notification of staged) this.#deliver(notification.runId, notification.event);
      },
      discard: () => { close(); },
    };
  }

  notificationsAreStaged(): boolean {
    return this.#stagedNotifications !== undefined;
  }

  replay(runIdInput: string, afterInput: number, limit = 1_000): RunEventBatch {
    const runId = runIdSchema.parse(runIdInput);
    const after = nonnegativeSafeInteger(afterInput, "after");
    const record = this.#record(runId);
    const firstSequence = record.events[0]?.sequence ?? 1;
    const lastSequence = record.events.at(-1)?.sequence ?? 0;
    if (after < firstSequence - 1) {
      throw new RunStoreError(410, "cursor_expired", "Requested event cursor is no longer retained.");
    }
    if (after > lastSequence) {
      throw new RunStoreError(409, "cursor_ahead", "Requested event cursor is ahead of the run.");
    }
    const events = record.events.filter((event) => event.sequence > after).slice(0, limit);
    return runEventBatchSchema.parse({ runId, after, events });
  }

  authoritativeEvents(runIdInput: string): ReadonlyArray<WireRunEvent> {
    const record = this.#record(runIdSchema.parse(runIdInput));
    return immutableClone(record.authoritativeEvents);
  }

  subscribe(runIdInput: string, subscriber: (event: WireRunEvent) => void): () => void {
    const runId = runIdSchema.parse(runIdInput);
    const record = this.#record(runId);
    record.subscribers.add(subscriber);
    return () => record.subscribers.delete(subscriber);
  }

  snapshot(): RunStoreSnapshot {
    return {
      schemaVersion: 2,
      runs: [...this.#runs.entries()].map(([runId, record]) => ({
        runId,
        status: record.status,
        started: structuredClone(record.started),
        events: structuredClone(record.authoritativeEvents),
      })),
    };
  }

  restore(snapshot: RunStoreSnapshot): void {
    if (this.#runs.size > 0) throw new Error("Run store can only restore into an empty instance.");
    if (snapshot.runs.length > this.#maxRuns) throw new Error("Run snapshot exceeds configured capacity.");
    for (const item of snapshot.runs) {
      if (this.#runs.has(item.runId)) throw new Error(`Run snapshot contains a duplicate run: ${item.runId}`);
      if (item.events.length === 0 || item.events.length > maxAuthoritativeEvents) {
        throw new Error("Run snapshot contains an invalid event count.");
      }
      if (item.authoritativeEvents === undefined && snapshot.schemaVersion !== 2) {
        throw new Error("Run snapshot legacy event history has unknown authority.");
      }
      const authoritativeEvents = item.authoritativeEvents ?? item.events;
      if (authoritativeEvents.length === 0 || authoritativeEvents.length > maxAuthoritativeEvents) {
        throw new Error("Run snapshot contains an invalid authoritative event count.");
      }
      const replayEvents = item.authoritativeEvents === undefined
        ? authoritativeEvents.slice(-this.#maxEventsPerRun)
        : item.events;
      if (replayEvents.length > this.#maxEventsPerRun) {
        throw new Error("Run snapshot contains an invalid replay event count.");
      }
      const started = item.started ?? authoritativeEvents.find((event) => event.type === "run.started");
      if (started === undefined || started.runId !== item.runId || started.sequence !== 1) {
        throw new Error("Run snapshot does not contain its authoritative start event.");
      }
      let restoredStatus: RunStatus = "running";
      let previousSequence: number | undefined;
      for (const event of authoritativeEvents) {
        if (event.runId !== item.runId) throw new Error("Run snapshot event run IDs must match.");
        if (previousSequence !== undefined && event.sequence !== previousSequence + 1) {
          throw new Error("Run snapshot events must be contiguous.");
        }
        if (terminalStatuses.has(restoredStatus)) throw new Error("Run snapshot contains an event after terminal state.");
        if (event.type === "run.started") {
          if (event.sequence !== 1 || event.runId !== started.runId || event.emittedAt !== started.emittedAt) {
            throw new Error("Run snapshot start event is inconsistent.");
          }
        } else {
          restoredStatus = statusAfter(restoredStatus, event);
        }
        previousSequence = event.sequence;
      }
      if (restoredStatus !== item.status) {
        throw new Error("Run snapshot status is inconsistent with its events.");
      }
      const retainedStart = authoritativeEvents.length - replayEvents.length;
      if (retainedStart < 0 || !isDeepStrictEqual(replayEvents, authoritativeEvents.slice(retainedStart))) {
        throw new Error("Run snapshot replay events must be an authoritative history suffix.");
      }
      this.#runs.set(item.runId, {
        status: item.status,
        started: immutableClone(started),
        authoritativeEvents: authoritativeEvents.map((event) => immutableClone(event)),
        events: replayEvents.map((event) => immutableClone(event)),
        subscribers: new Set(),
      });
    }
  }

  replace(snapshot: RunStoreSnapshot): void {
    const subscribers = new Map(
      [...this.#runs.entries()].map(([runId, record]) => [runId, record.subscribers] as const),
    );
    this.#runs.clear();
    this.restore(snapshot);
    for (const [runId, record] of this.#runs) {
      record.subscribers = subscribers.get(runId) ?? new Set();
    }
  }

  has(runIdInput: string): boolean {
    return this.#runs.has(runIdSchema.parse(runIdInput));
  }

  startedEvent(runIdInput: string): Extract<WireRunEvent, { type: "run.started" }> {
    const record = this.#record(runIdSchema.parse(runIdInput));
    return immutableClone(record.started);
  }

  status(runIdInput: string): RunStatus {
    return this.#record(runIdSchema.parse(runIdInput)).status;
  }

  #record(runId: string): RunRecord {
    const record = this.#runs.get(runId);
    if (record === undefined) {
      throw new RunStoreError(404, "run_not_found", `Unknown run: ${runId}`);
    }
    return record;
  }

  #notify(runId: string, event: WireRunEvent): void {
    if (this.#stagedNotifications !== undefined) {
      this.#stagedNotifications.push({ runId, event: immutableClone(event) });
      return;
    }
    this.#deliver(runId, event);
  }

  #deliver(runId: string, event: WireRunEvent): void {
    const record = this.#runs.get(runId);
    if (record === undefined) return;
    for (const subscriber of record.subscribers) subscriber(immutableClone(event));
  }
}

function statusAfter(current: RunStatus, event: WireRunEvent): RunStatus {
  switch (event.type) {
    case "run.completed": return "succeeded";
    case "run.stopped": return "stopped";
    case "phase.failed": return event.repairable ? "repair" : "failed";
    case "phase.started": return "running";
    default: return current;
  }
}

function boundedInteger(value: number, minimum: number, maximum: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}.`);
  }
  return value;
}

function nonnegativeSafeInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RunStoreError(400, "invalid_cursor", `${name} must be a nonnegative safe integer.`);
  }
  return value;
}

function immutableClone<T>(value: T): T {
  return freezeDeep(structuredClone(value));
}

function freezeDeep<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value as Record<string, unknown>).forEach(freezeDeep);
    Object.freeze(value);
  }
  return value;
}
