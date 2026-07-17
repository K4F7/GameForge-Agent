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

export type RecoveringRunEventState =
  | { status: "replaying"; cursor: number; attempt: number }
  | { status: "waiting"; cursor: number; attempt: number; delayMs: number; error: Error }
  | { status: "connected"; cursor: number; attempt: number }
  | { status: "terminal"; cursor: number; attempt: number }
  | { status: "failed"; cursor: number; attempt: number; error: Error };

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

const DEFAULT_RETRY_DELAYS_MS = [500, 1_000, 2_000, 4_000, 8_000] as const;
const REPLAY_PAGE_SIZE = 1_000;
const MAX_REPLAY_PAGES = 11;

export function connectRecoveringRunEventStream(
  options: RecoveringRunEventOptions,
): RecoveringRunEventConnection {
  const runId = runIdSchema.parse(options.runId);
  const retryDelays = [...(options.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS)];
  if (retryDelays.some((delay) => !Number.isSafeInteger(delay) || delay < 0)) {
    throw new Error("Run event retry delays must be nonnegative safe integers.");
  }
  const schedule = options.schedule ?? ((callback, delay) => globalThis.setTimeout(callback, delay));
  const cancelSchedule = options.cancelSchedule ?? ((timer) => {
    globalThis.clearTimeout(timer as ReturnType<typeof globalThis.setTimeout>);
  });
  let cursor = nonnegativeSequence(options.after);
  let attempt = 0;
  let closed = false;
  let recovering = false;
  let terminal = false;
  let streamClose: (() => void) | null = null;
  let retryTimer: unknown | null = null;
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

  const closeTransport = (): void => {
    streamClose?.();
    streamClose = null;
    if (retryTimer !== null) {
      cancelSchedule(retryTimer);
      retryTimer = null;
    }
  };

  const acceptEvent = (event: RunEvent): void => {
    if (event.sequence <= cursor) return;
    if (event.sequence !== cursor + 1) {
      throw new Error(`Run event recovery expected sequence ${cursor + 1} but received ${event.sequence}.`);
    }
    options.onEvent(event);
    cursor = event.sequence;
    if (isTerminalRunEvent(event)) terminal = true;
  };

  const scheduleRecovery = (error: Error): void => {
    if (closed || terminal) return;
    closeTransport();
    const fatal = error instanceof RunEventReplayError && [409, 410].includes(error.status);
    const delay = retryDelays[attempt];
    if (fatal || delay === undefined) {
      options.onState({ status: "failed", cursor, attempt, error });
      settleReady(error);
      return;
    }
    attempt += 1;
    options.onState({ status: "waiting", cursor, attempt, delayMs: delay, error });
    retryTimer = schedule(() => {
      retryTimer = null;
      void recover();
    }, delay);
  };

  const recover = async (): Promise<void> => {
    if (closed || terminal || recovering) return;
    recovering = true;
    closeTransport();
    options.onState({ status: "replaying", cursor, attempt });
    try {
      for (let page = 0; page < MAX_REPLAY_PAGES; page += 1) {
        const events = await fetchRunEvents({
          baseUrl: options.baseUrl,
          runId,
          after: cursor,
          ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
        });
        for (const event of events) acceptEvent(event);
        if (terminal || events.length < REPLAY_PAGE_SIZE) break;
        if (page === MAX_REPLAY_PAGES - 1) throw new Error("Run event replay exceeded the retained event window.");
      }
      if (closed) return;
      if (terminal) {
        options.onState({ status: "terminal", cursor, attempt });
        settleReady();
        return;
      }
      streamClose = connectRunEventStream({
        baseUrl: options.baseUrl,
        runId,
        after: cursor,
        onEvent(event) {
          try {
            acceptEvent(event);
            if (terminal) {
              closeTransport();
              options.onState({ status: "terminal", cursor, attempt });
            }
          } catch (error) {
            scheduleRecovery(error instanceof Error ? error : new Error("Run event stream recovery failed."));
          }
        },
        onGap() {
          closeTransport();
          recovering = false;
          void recover();
        },
        onError(error) {
          scheduleRecovery(error);
        },
        onOpen() {
          attempt = 0;
          options.onState({ status: "connected", cursor, attempt });
          settleReady();
        },
        ...(options.eventSourceFactory === undefined ? {} : { eventSourceFactory: options.eventSourceFactory }),
      });
    } catch (error) {
      scheduleRecovery(error instanceof Error ? error : new Error("Run event recovery failed."));
    } finally {
      recovering = false;
    }
  };

  void recover();
  return {
    ready,
    close() {
      closed = true;
      closeTransport();
      settleReady(new Error("Run event connection was closed."));
    },
    reconnect() {
      if (closed || terminal) return;
      attempt = 0;
      closeTransport();
      void recover();
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
