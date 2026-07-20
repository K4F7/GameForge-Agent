import {
  createGameTaskRequestSchema,
  createGameTaskResponseSchema,
  listGameTasksRequestSchema,
  listGameTasksResponseSchema,
  runEventBatchSchema,
  runEventSchema,
  runIdSchema,
  toRunEvent,
  type RunEvent,
  type GameTask,
} from "@gameforge/contracts";
import {
  recoverRunEvents,
  RunRecoverySequenceError,
  type RunRecoveryState,
} from "@gameforge/run-relay/recovery";

export type RunEventFetchOptions = {
  baseUrl: string;
  runId: string;
  after: number;
  fetch?: typeof globalThis.fetch;
};

export type CreateRunOptions = {
  baseUrl: string;
  runId: string;
  fetch?: typeof globalThis.fetch;
};

export type CreateGameTaskOptions = CreateRunOptions & {
  prompt: string;
  language?: "zh-CN" | "en-US";
  projectId?: string;
};

export type ListGameTasksOptions = {
  baseUrl: string;
  limit?: number;
  fetch?: typeof globalThis.fetch;
};

export async function listGameTasks(options: ListGameTasksOptions): Promise<ReadonlyArray<GameTask>> {
  const baseUrl = relayBaseUrl(options.baseUrl);
  const request = listGameTasksRequestSchema.parse({
    ...(options.limit === undefined ? {} : { limit: options.limit }),
  });
  const url = new URL("tasks", baseUrl);
  url.searchParams.set("limit", String(request.limit));
  const response = await (options.fetch ?? globalThis.fetch)(url, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`Task list failed with HTTP ${response.status}.`);
  return listGameTasksResponseSchema.parse(await response.json()).tasks;
}

export async function createGameTask(options: CreateGameTaskOptions): Promise<{
  task: GameTask;
  event: RunEvent;
}> {
  const baseUrl = relayBaseUrl(options.baseUrl);
  const request = createGameTaskRequestSchema.parse({
    runId: options.runId,
    prompt: options.prompt,
    ...(options.language === undefined ? {} : { language: options.language }),
    ...(options.projectId === undefined ? {} : { projectId: options.projectId }),
  });
  const response = await (options.fetch ?? globalThis.fetch)(new URL("tasks", baseUrl), {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(request),
  });
  if (!response.ok) throw new Error(`Task creation failed with HTTP ${response.status}.`);
  const parsed = createGameTaskResponseSchema.parse(await response.json());
  if (parsed.event.type !== "run.started" || parsed.event.runId !== parsed.task.runId) {
    throw new Error("Task creation returned an inconsistent run event.");
  }
  return { task: parsed.task, event: toRunEvent(parsed.event) };
}

export async function createRun(options: CreateRunOptions): Promise<RunEvent> {
  const runId = runIdSchema.parse(options.runId);
  const url = relayBaseUrl(options.baseUrl);
  url.pathname += "runs";
  const response = await (options.fetch ?? globalThis.fetch)(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ runId }),
  });
  if (!response.ok) {
    throw new Error(`Run creation failed with HTTP ${response.status}.`);
  }
  const body = await response.json() as { event?: unknown };
  const event = runEventSchema.parse(body.event);
  if (event.type !== "run.started" || event.runId !== runId || event.sequence !== 1) {
    throw new Error("Run creation response did not contain the expected start event.");
  }
  return toRunEvent(event);
}

export async function stopRun(options: CreateRunOptions): Promise<RunEvent> {
  const runId = runIdSchema.parse(options.runId);
  const url = runUrl(options.baseUrl, runId, "stop");
  const response = await (options.fetch ?? globalThis.fetch)(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: "{}",
  });
  if (!response.ok) throw new Error(`Run stop failed with HTTP ${response.status}.`);
  const body = await response.json() as { event?: unknown };
  const event = runEventSchema.parse(body.event);
  if (event.type !== "run.stopped" || event.runId !== runId) {
    throw new Error("Run stop response did not contain the expected terminal event.");
  }
  return toRunEvent(event);
}

export async function fetchRunEvents(options: RunEventFetchOptions): Promise<ReadonlyArray<RunEvent>> {
  const runId = runIdSchema.parse(options.runId);
  const after = nonnegativeSequence(options.after);
  const url = runUrl(options.baseUrl, runId, "events");
  url.searchParams.set("after", String(after));

  const response = await (options.fetch ?? globalThis.fetch)(url, {
    method: "GET",
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    throw new RunEventReplayError(response.status);
  }

  const batch = runEventBatchSchema.parse(await response.json());
  if (batch.runId !== runId || batch.after !== after) {
    throw new Error("Run event replay response did not match the requested cursor.");
  }
  return batch.events.map(toRunEvent);
}

export class RunEventReplayError extends Error {
  readonly status: number;

  constructor(status: number) {
    super(`Run event replay failed with HTTP ${status}.`);
    this.name = "RunEventReplayError";
    this.status = status;
  }
}

export type RunEventSource = {
  addEventListener(type: "open" | "message" | "error", listener: (event: MessageEvent<string> | Event) => void): void;
  close(): void;
};

export type ConnectRunEventStreamOptions = {
  baseUrl: string;
  runId: string;
  after: number;
  onEvent(event: RunEvent): void;
  onGap(cursor: { expected: number; received: number }): void;
  onError(error: Error): void;
  onOpen?(cursor: number): void;
  eventSourceFactory?: (url: string) => RunEventSource;
};

export function connectRunEventStream(options: ConnectRunEventStreamOptions): () => void {
  const runId = runIdSchema.parse(options.runId);
  let lastSequence = nonnegativeSequence(options.after);
  const url = runUrl(options.baseUrl, runId, "stream");
  url.searchParams.set("after", String(lastSequence));
  const factory = options.eventSourceFactory ?? ((value) => new EventSource(value));
  const source = factory(url.href);

  source.addEventListener("open", () => {
    options.onOpen?.(lastSequence);
  });

  source.addEventListener("message", (message) => {
    if (!(message instanceof MessageEvent)) {
      options.onError(new Error("Run event stream emitted an invalid message."));
      return;
    }

    let input: unknown;
    try {
      input = JSON.parse(message.data) as unknown;
    } catch {
      options.onError(new Error("Run event stream emitted invalid JSON."));
      return;
    }

    const parsed = runEventSchema.safeParse(input);
    if (!parsed.success || parsed.data.runId !== runId) {
      options.onError(new Error("Run event stream emitted an invalid event."));
      return;
    }
    if (parsed.data.sequence <= lastSequence) {
      return;
    }
    if (parsed.data.sequence !== lastSequence + 1) {
      options.onGap({ expected: lastSequence + 1, received: parsed.data.sequence });
      return;
    }

    lastSequence = parsed.data.sequence;
    options.onEvent(toRunEvent(parsed.data));
  });

  source.addEventListener("error", () => {
    options.onError(new Error("Run event stream connection failed."));
  });

  return () => source.close();
}

export type RecoveringRunEventState = RunRecoveryState;

export type RecoveringRunEventConnection = {
  ready: Promise<void>;
  close(): void;
  reconnect(): void;
  cursor(): number;
};

export type RecoveringRunEventOptions = {
  baseUrl: string;
  runId: string;
  after: number;
  onEvent(event: RunEvent): void;
  onState(state: RecoveringRunEventState): void;
  fetch?: typeof globalThis.fetch;
  eventSourceFactory?: (url: string) => RunEventSource;
  retryDelaysMs?: ReadonlyArray<number>;
  schedule?: (callback: () => void, delayMs: number) => unknown;
  cancelSchedule?: (timer: unknown) => void;
};

export function connectRecoveringRunEventStream(
  options: RecoveringRunEventOptions,
): RecoveringRunEventConnection {
  const runId = runIdSchema.parse(options.runId);
  const schedule = options.schedule ?? ((callback, delay) => globalThis.setTimeout(callback, delay));
  const cancelSchedule = options.cancelSchedule ?? ((timer) => {
    globalThis.clearTimeout(timer as ReturnType<typeof globalThis.setTimeout>);
  });
  let cursor = nonnegativeSequence(options.after);
  let closed = false;
  let terminal = false;
  let currentAttempt = 0;
  let generation = 0;
  let controller: AbortController | null = null;
  let readySettled = false;
  let resolveReady!: () => void;
  let rejectReady!: (error: Error) => void;
  const ready = new Promise<void>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });

  const settleReady = (error?: Error): void => {
    if (readySettled) return;
    readySettled = true;
    if (error === undefined) resolveReady();
    else rejectReady(error);
  };

  const sleep = (delayMs: number, signal?: AbortSignal): Promise<void> => new Promise((resolve) => {
    if (signal?.aborted === true) return resolve();
    let timer: unknown;
    const done = (): void => {
      cancelSchedule(timer);
      signal?.removeEventListener("abort", done);
      resolve();
    };
    timer = schedule(done, delayMs);
    signal?.addEventListener("abort", done, { once: true });
  });

  const launch = (): void => {
    if (closed || terminal) return;
    generation += 1;
    const activeGeneration = generation;
    controller?.abort();
    controller = new AbortController();
    void recoverRunEvents<RunEvent>({
      after: cursor,
      replay: (after) => fetchRunEvents({
        baseUrl: options.baseUrl,
        runId,
        after,
        ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
      }),
      stream: ({ after, onEvent, onOpen, signal }) => new Promise<void>((resolve, reject) => {
        const disconnect = connectRunEventStream({
          baseUrl: options.baseUrl,
          runId,
          after,
          onEvent(event) {
            try {
              onEvent(event);
              if (isTerminalRunEvent(event)) {
                disconnect();
                resolve();
              }
            } catch (error) {
              disconnect();
              reject(error);
            }
          },
          onGap(gap) {
            disconnect();
            reject(new RunRecoverySequenceError(gap.expected, gap.received));
          },
          onError(error) {
            disconnect();
            reject(error);
          },
          onOpen,
          ...(options.eventSourceFactory === undefined ? {} : { eventSourceFactory: options.eventSourceFactory }),
        });
        signal?.addEventListener("abort", () => {
          disconnect();
          resolve();
        }, { once: true });
      }),
      onEvent(event) {
        if (activeGeneration !== generation || closed) return;
        options.onEvent(event);
        cursor = event.sequence;
        if (isTerminalRunEvent(event) && !terminal) {
          terminal = true;
          options.onState({ status: "terminal", cursor, attempt: currentAttempt });
          settleReady();
        }
      },
      onState(state) {
        if (activeGeneration !== generation || closed) return;
        cursor = state.cursor;
        currentAttempt = state.attempt;
        if (state.status === "terminal" && terminal) return;
        terminal = state.status === "terminal";
        options.onState(state);
        if (state.status === "connected" || state.status === "terminal") settleReady();
      },
      retry(error) {
        return !(error instanceof RunEventReplayError && [409, 410].includes(error.status));
      },
      signal: controller.signal,
      sleep,
      ...(options.retryDelaysMs === undefined ? {} : { retryDelaysMs: options.retryDelaysMs }),
    }).catch((error: unknown) => {
      if (activeGeneration !== generation || closed) return;
      settleReady(error instanceof Error ? error : new Error("Run event recovery failed."));
    });
  };

  launch();
  return {
    ready,
    close() {
      closed = true;
      generation += 1;
      controller?.abort();
      settleReady(new Error("Run event connection was closed."));
    },
    reconnect() {
      if (closed || terminal) return;
      launch();
    },
    cursor: () => cursor,
  };
}

function isTerminalRunEvent(event: RunEvent): boolean {
  return event.type === "run.completed" || event.type === "run.stopped" ||
    (event.type === "phase.failed" && !event.repairable);
}

function runUrl(baseUrl: string, runId: string, resource: "events" | "stream" | "stop"): URL {
  const base = relayBaseUrl(baseUrl);
  return new URL(`runs/${encodeURIComponent(runId)}/${resource}`, base);
}

function relayBaseUrl(baseUrl: string): URL {
  const base = new URL(baseUrl);
  if (
    base.username !== "" ||
    base.password !== "" ||
    base.search !== "" ||
    base.hash !== "" ||
    (base.protocol !== "https:" &&
      !(base.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(base.hostname)))
  ) {
    throw new Error("Agent base URL must use HTTPS, or HTTP on a loopback host, without credentials or query data.");
  }

  if (!base.pathname.endsWith("/")) {
    base.pathname += "/";
  }
  return base;
}

function nonnegativeSequence(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error("Run event cursor must be a nonnegative safe integer.");
  }
  return value;
}
