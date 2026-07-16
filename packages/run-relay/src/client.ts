import {
  claimGameTaskRequestSchema,
  gameTaskIdSchema,
  gameTaskSchema,
  listGameTasksRequestSchema,
  listGameTasksResponseSchema,
  runEventBatchSchema,
  replayRunEventsRequestSchema,
  runEventSchema,
  runIdSchema,
  type RunEventBatch,
  type ReplayRunEventsRequest,
  type ClaimGameTaskRequest,
  type GameTask,
  type ListGameTasksRequest,
  type WireRunEvent,
} from "@gameforge/contracts";
import { z } from "zod";

const createResponseSchema = z.strictObject({ event: runEventSchema });
const publishResponseSchema = z.strictObject({
  accepted: z.number().int().nonnegative(),
  lastSequence: z.number().int().positive().optional(),
});
const relayErrorSchema = z.object({ error: z.string().min(1).max(100) });
const taskResponseSchema = z.strictObject({ task: gameTaskSchema });

export type RelayFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export type RunRelayClientOptions = {
  baseUrl: string;
  fetch?: RelayFetch;
  timeoutMilliseconds?: number;
};

export class RunRelayClientError extends Error {
  constructor(
    readonly code: "timeout" | "network" | "http" | "protocol",
    message: string,
    readonly statusCode?: number,
    readonly relayCode?: string,
  ) {
    super(message);
    this.name = "RunRelayClientError";
  }
}

export class RunRelayClient {
  readonly #baseUrl: URL;
  readonly #fetch: RelayFetch;
  readonly #timeoutMilliseconds: number;

  constructor(options: RunRelayClientOptions) {
    this.#baseUrl = relayBaseUrl(options.baseUrl);
    this.#fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
    const timeout = options.timeoutMilliseconds ?? 10_000;
    if (!Number.isSafeInteger(timeout) || timeout < 100 || timeout > 60_000) {
      throw new Error("Run relay timeout must be an integer between 100 and 60000 milliseconds.");
    }
    this.#timeoutMilliseconds = timeout;
  }

  async createRun(runIdInput: string): Promise<WireRunEvent> {
    const runId = runIdSchema.parse(runIdInput);
    const response = await this.#request("runs", {
      method: "POST",
      body: JSON.stringify({ runId }),
    });
    const parsed = createResponseSchema.safeParse(response);
    if (
      !parsed.success ||
      parsed.data.event.type !== "run.started" ||
      parsed.data.event.runId !== runId ||
      parsed.data.event.sequence !== 1
    ) {
      throw new RunRelayClientError("protocol", "Run relay returned an invalid create response.");
    }
    return parsed.data.event;
  }

  async publishEvents(batchInput: RunEventBatch): Promise<{ accepted: number; lastSequence?: number }> {
    const batch = runEventBatchSchema.parse(batchInput);
    const response = await this.#request(
      `runs/${encodeURIComponent(batch.runId)}/events`,
      { method: "POST", body: JSON.stringify(batch) },
    );
    const parsed = publishResponseSchema.safeParse(response);
    if (!parsed.success || parsed.data.accepted !== batch.events.length) {
      throw new RunRelayClientError("protocol", "Run relay returned an invalid publish response.");
    }
    const expectedLast = batch.events.at(-1)?.sequence;
    if (expectedLast !== undefined && parsed.data.lastSequence !== expectedLast) {
      throw new RunRelayClientError("protocol", "Run relay returned an unexpected event cursor.");
    }
    return parsed.data.lastSequence === undefined
      ? { accepted: parsed.data.accepted }
      : { accepted: parsed.data.accepted, lastSequence: parsed.data.lastSequence };
  }

  async replayEvents(input: ReplayRunEventsRequest): Promise<RunEventBatch> {
    const request = replayRunEventsRequestSchema.parse(input);
    const query = new URLSearchParams({ after: String(request.after) });
    const response = await this.#request(
      `runs/${encodeURIComponent(request.runId)}/events?${query.toString()}`,
      { method: "GET" },
    );
    const parsed = runEventBatchSchema.safeParse(response);
    if (!parsed.success || parsed.data.runId !== request.runId || parsed.data.after !== request.after) {
      throw new RunRelayClientError("protocol", "Run relay returned an invalid event replay.");
    }
    return parsed.data;
  }

  async completeRun(runIdInput: string): Promise<WireRunEvent> {
    return this.#finish(runIdInput, "complete", "run.completed");
  }

  async stopRun(runIdInput: string): Promise<WireRunEvent> {
    return this.#finish(runIdInput, "stop", "run.stopped");
  }

  async listTasks(input: ListGameTasksRequest = {}): Promise<ReadonlyArray<GameTask>> {
    const request = listGameTasksRequestSchema.parse(input);
    const query = new URLSearchParams({ limit: String(request.limit) });
    if (request.status !== undefined) query.set("status", request.status);
    const response = await this.#request(`tasks?${query.toString()}`, { method: "GET" });
    const parsed = listGameTasksResponseSchema.safeParse(response);
    if (!parsed.success) throw new RunRelayClientError("protocol", "Run relay returned an invalid task list.");
    return parsed.data.tasks;
  }

  async getTask(taskIdInput: string): Promise<GameTask> {
    const taskId = gameTaskIdSchema.parse(taskIdInput);
    const response = await this.#request(`tasks/${encodeURIComponent(taskId)}`, { method: "GET" });
    const parsed = taskResponseSchema.safeParse(response);
    if (!parsed.success || parsed.data.task.taskId !== taskId) {
      throw new RunRelayClientError("protocol", "Run relay returned an invalid task response.");
    }
    return parsed.data.task;
  }

  async claimTask(taskIdInput: string, input: ClaimGameTaskRequest): Promise<GameTask> {
    const taskId = gameTaskIdSchema.parse(taskIdInput);
    const request = claimGameTaskRequestSchema.parse(input);
    const response = await this.#request(`tasks/${encodeURIComponent(taskId)}/claim`, {
      method: "POST",
      body: JSON.stringify(request),
    });
    const parsed = taskResponseSchema.safeParse(response);
    if (!parsed.success || parsed.data.task.taskId !== taskId || parsed.data.task.claimedBy !== request.agentId) {
      throw new RunRelayClientError("protocol", "Run relay returned an invalid task claim response.");
    }
    return parsed.data.task;
  }

  async #finish(
    runIdInput: string,
    command: "complete" | "stop",
    expectedType: "run.completed" | "run.stopped",
  ): Promise<WireRunEvent> {
    const runId = runIdSchema.parse(runIdInput);
    const response = await this.#request(
      `runs/${encodeURIComponent(runId)}/${command}`,
      { method: "POST", body: "{}" },
    );
    const parsed = createResponseSchema.safeParse(response);
    if (!parsed.success || parsed.data.event.type !== expectedType || parsed.data.event.runId !== runId) {
      throw new RunRelayClientError("protocol", "Run relay returned an invalid terminal response.");
    }
    return parsed.data.event;
  }

  async #request(relativePath: string, init: RequestInit): Promise<unknown> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.#timeoutMilliseconds);
    let response: Response;
    try {
      response = await this.#fetch(new URL(relativePath, this.#baseUrl), {
        ...init,
        signal: controller.signal,
        headers: { "Content-Type": "application/json", Accept: "application/json" },
      });
    } catch (error) {
      if (controller.signal.aborted) {
        throw new RunRelayClientError("timeout", "Run relay request timed out.");
      }
      throw new RunRelayClientError("network", "Run relay request failed.");
    } finally {
      clearTimeout(timeout);
    }

    let body: unknown;
    try {
      if (!(response.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) {
        throw new Error("Unexpected content type");
      }
      body = await response.json() as unknown;
    } catch {
      throw new RunRelayClientError("protocol", "Run relay returned an invalid JSON response.");
    }
    if (!response.ok) {
      const relayCode = relayErrorSchema.safeParse(body);
      throw new RunRelayClientError(
        "http",
        `Run relay request failed with HTTP ${response.status}.`,
        response.status,
        relayCode.success ? relayCode.data.error : undefined,
      );
    }
    return body;
  }
}

function relayBaseUrl(value: string): URL {
  const url = new URL(value);
  const loopback = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";
  if (
    url.username !== "" ||
    url.password !== "" ||
    url.search !== "" ||
    url.hash !== "" ||
    (url.protocol !== "https:" && !(url.protocol === "http:" && loopback))
  ) {
    throw new Error("Run relay URL must use HTTPS, or HTTP on loopback, without credentials or query data.");
  }
  if (!url.pathname.endsWith("/")) url.pathname += "/";
  return url;
}
