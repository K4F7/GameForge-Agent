import {
  createGameTaskRequestSchema,
  createGameTaskResponseSchema,
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
};

export async function createGameTask(options: CreateGameTaskOptions): Promise<{
  task: GameTask;
  event: RunEvent;
}> {
  const baseUrl = relayBaseUrl(options.baseUrl);
  const request = createGameTaskRequestSchema.parse({
    runId: options.runId,
    prompt: options.prompt,
    ...(options.language === undefined ? {} : { language: options.language }),
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
    throw new Error(`Run event replay failed with HTTP ${response.status}.`);
  }

  const batch = runEventBatchSchema.parse(await response.json());
  if (batch.runId !== runId || batch.after !== after) {
    throw new Error("Run event replay response did not match the requested cursor.");
  }
  return batch.events.map(toRunEvent);
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
