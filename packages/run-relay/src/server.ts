import {
  claimGameTaskRequestSchema,
  createGameTaskRequestSchema,
  gameTaskIdSchema,
  gameTaskStatusSchema,
  listGameTasksRequestSchema,
  runIdSchema,
  type WireRunEvent,
} from "@gameforge/contracts";
import { createServer as createHttpServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { createHash, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { RunStore, RunStoreError, type RunStoreOptions } from "./store.js";
import { TaskInbox, TaskInboxError } from "./tasks.js";

export { ProjectAuthority, ProjectAuthorityError } from "./projects.js";

const createRunSchema = z.strictObject({ runId: runIdSchema });
const MAX_BODY_BYTES = 1024 * 1024;

export type RunRelayServerOptions = RunStoreOptions & {
  allowedOrigins?: ReadonlyArray<string>;
  heartbeatMilliseconds?: number;
  maxSseClients?: number;
  maxTasks?: number;
  store?: RunStore;
  taskInbox?: TaskInbox;
  persistState?: () => Promise<void>;
  authToken?: string;
};

export function createRunRelayServer(options: RunRelayServerOptions = {}): Server {
  const store = options.store ?? new RunStore(options);
  const taskInbox = options.taskInbox ?? new TaskInbox(
    store,
    options.maxTasks === undefined ? {} : { maxTasks: options.maxTasks },
  );
  const allowedOrigins = new Set(options.allowedOrigins ?? [
    "http://localhost:4173",
    "http://127.0.0.1:4173",
  ]);
  const heartbeatMilliseconds = boundedInteger(
    options.heartbeatMilliseconds ?? 15_000,
    1_000,
    60_000,
    "heartbeatMilliseconds",
  );
  const maxSseClients = boundedInteger(options.maxSseClients ?? 50, 1, 1_000, "maxSseClients");
  const authToken = options.authToken === undefined ? undefined : validateAuthToken(options.authToken);
  let activeSseClients = 0;

  return createHttpServer(async (request, response) => {
    try {
      const origin = request.headers.origin;
      if (origin !== undefined && !allowedOrigins.has(origin)) {
        throw new HttpError(403, "origin_forbidden", "Request origin is not allowed.");
      }
      if (origin !== undefined) response.setHeader("Access-Control-Allow-Origin", origin);
      response.setHeader("Vary", "Origin");

      if (request.method === "OPTIONS") {
        response.writeHead(204, {
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": authToken === undefined ? "Content-Type" : "Content-Type, Authorization",
          "Access-Control-Max-Age": "600",
        }).end();
        return;
      }
      if (authToken !== undefined && !authorized(request.headers.authorization, authToken)) {
        response.setHeader("WWW-Authenticate", "Bearer");
        throw new HttpError(401, "authentication_required", "Run relay authentication is required.");
      }

      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      if (request.method === "POST" && url.pathname === "/tasks") {
        const input = createGameTaskRequestSchema.parse(await readJson(request));
        const created = taskInbox.create(input);
        await options.persistState?.();
        writeJson(response, 201, created);
        return;
      }
      if (request.method === "GET" && url.pathname === "/tasks") {
        const statusInput = url.searchParams.get("status") ?? undefined;
        const limitInput = url.searchParams.get("limit") ?? undefined;
        const input = listGameTasksRequestSchema.parse({
          ...(statusInput === undefined ? {} : { status: gameTaskStatusSchema.parse(statusInput) }),
          ...(limitInput === undefined ? {} : { limit: parsePositiveInteger(limitInput, "limit") }),
        });
        writeJson(response, 200, { tasks: taskInbox.list(input) });
        return;
      }
      const taskRoute = matchTaskRoute(url.pathname);
      if (taskRoute !== undefined && taskRoute.command === undefined && request.method === "GET") {
        writeJson(response, 200, { task: taskInbox.get(taskRoute.taskId) });
        return;
      }
      if (taskRoute?.command === "claim" && request.method === "POST") {
        const input = claimGameTaskRequestSchema.parse(await readJson(request));
        const task = taskInbox.claim(taskRoute.taskId, input);
        await options.persistState?.();
        writeJson(response, 200, { task });
        return;
      }

      if (request.method === "POST" && url.pathname === "/runs") {
        const input = createRunSchema.parse(await readJson(request));
        const event = store.create(input.runId);
        await options.persistState?.();
        writeJson(response, 201, { event });
        return;
      }

      const eventRoute = matchRunRoute(url.pathname, "events");
      if (eventRoute !== undefined && request.method === "POST") {
        const events = taskInbox.appendRun(eventRoute, await readJson(request));
        await options.persistState?.();
        writeJson(response, 202, { accepted: events.length, lastSequence: events.at(-1)?.sequence });
        return;
      }
      if (eventRoute !== undefined && request.method === "GET") {
        writeJson(response, 200, store.replay(eventRoute, parseAfter(url)));
        return;
      }

      const streamRoute = matchRunRoute(url.pathname, "stream");
      if (streamRoute !== undefined && request.method === "GET") {
        if (activeSseClients >= maxSseClients) {
          throw new HttpError(503, "sse_capacity_reached", "SSE client capacity has been reached.");
        }
        const replay = store.replay(streamRoute, parseAfter(url), 1_000);
        activeSseClients += 1;
        response.writeHead(200, {
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
          "X-Accel-Buffering": "no",
        });
        response.write("retry: 1500\n\n");
        for (const event of replay.events) writeSse(response, event);
        const unsubscribe = store.subscribe(streamRoute, (event) => writeSse(response, event));
        const heartbeat = setInterval(() => response.write(": heartbeat\n\n"), heartbeatMilliseconds);
        let closed = false;
        const close = (): void => {
          if (closed) return;
          closed = true;
          activeSseClients -= 1;
          clearInterval(heartbeat);
          unsubscribe();
        };
        request.on("close", close);
        response.on("close", close);
        return;
      }

      const stopRoute = matchRunRoute(url.pathname, "stop");
      if (stopRoute !== undefined && request.method === "POST") {
        const event = taskInbox.finishRun(stopRoute, "run.stopped");
        await options.persistState?.();
        writeJson(response, 200, { event });
        return;
      }
      const completeRoute = matchRunRoute(url.pathname, "complete");
      if (completeRoute !== undefined && request.method === "POST") {
        const event = taskInbox.finishRun(completeRoute, "run.completed");
        await options.persistState?.();
        writeJson(response, 200, { event });
        return;
      }

      throw new HttpError(404, "route_not_found", "Run relay route was not found.");
    } catch (error) {
      if (!response.headersSent) {
        const normalized = normalizeError(error);
        writeJson(response, normalized.statusCode, {
          error: normalized.code,
          message: normalized.message,
        });
      } else {
        response.end();
      }
    }
  });
}

function matchTaskRoute(pathname: string): { taskId: string; command?: "claim" } | undefined {
  const match = /^\/tasks\/([^/]+)(?:\/(claim))?$/.exec(pathname);
  if (match?.[1] === undefined) return undefined;
  try {
    const taskId = gameTaskIdSchema.parse(decodeURIComponent(match[1]));
    return match[2] === "claim" ? { taskId, command: "claim" } : { taskId };
  } catch {
    throw new HttpError(400, "invalid_task_id", "Task ID is invalid.");
  }
}

function matchRunRoute(pathname: string, resource: "events" | "stream" | "stop" | "complete"): string | undefined {
  const match = new RegExp(`^/runs/([^/]+)/${resource}$`).exec(pathname);
  if (match?.[1] === undefined) return undefined;
  try {
    return runIdSchema.parse(decodeURIComponent(match[1]));
  } catch {
    throw new HttpError(400, "invalid_run_id", "Run ID is invalid.");
  }
}

function parseAfter(url: URL): number {
  const raw = url.searchParams.get("after") ?? "0";
  if (!/^\d+$/.test(raw)) throw new HttpError(400, "invalid_cursor", "after must be a nonnegative integer.");
  const value = Number(raw);
  if (!Number.isSafeInteger(value)) throw new HttpError(400, "invalid_cursor", "after is too large.");
  return value;
}

function parsePositiveInteger(raw: string, name: string): number {
  if (!/^\d+$/.test(raw)) throw new HttpError(400, `invalid_${name}`, `${name} must be a positive integer.`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new HttpError(400, `invalid_${name}`, `${name} must be a positive safe integer.`);
  }
  return value;
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  if (!(request.headers["content-type"] ?? "").toLowerCase().startsWith("application/json")) {
    throw new HttpError(415, "content_type_required", "Content-Type must be application/json.");
  }
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.byteLength;
    if (bytes > MAX_BODY_BYTES) throw new HttpError(413, "body_too_large", "Request body is too large.");
    chunks.push(buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch {
    throw new HttpError(400, "invalid_json", "Request body must contain valid JSON.");
  }
}

function writeJson(response: ServerResponse, statusCode: number, value: unknown): void {
  response.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(value));
}

function writeSse(response: ServerResponse, event: WireRunEvent): void {
  if (response.destroyed || response.writableEnded) return;
  // A false return value signals buffered backpressure, not a failed write.
  // Node retains the chunk and emits drain after the socket catches up; closing
  // here would truncate an otherwise valid event stream.
  response.write(`id: ${event.sequence}\ndata: ${JSON.stringify(event)}\n\n`);
}

class HttpError extends Error {
  constructor(readonly statusCode: number, readonly code: string, message: string) {
    super(message);
  }
}

function normalizeError(error: unknown): HttpError {
  if (error instanceof HttpError) return error;
  if (error instanceof RunStoreError) return new HttpError(error.statusCode, error.code, error.message);
  if (error instanceof TaskInboxError) return new HttpError(error.statusCode, error.code, error.message);
  if (error instanceof z.ZodError) return new HttpError(400, "validation_failed", "Request validation failed.");
  return new HttpError(500, "internal_error", "Run relay failed to process the request.");
}

function boundedInteger(value: number, minimum: number, maximum: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}.`);
  }
  return value;
}

function validateAuthToken(value: string): string {
  const token = value.trim();
  if (token.length < 32 || token.length > 512 || /[\r\n]/.test(token)) {
    throw new Error("Run relay auth token must contain between 32 and 512 characters without newlines.");
  }
  return token;
}

function authorized(header: string | undefined, expected: string): boolean {
  const supplied = header?.startsWith("Bearer ") === true ? header.slice(7) : "";
  const expectedDigest = createHash("sha256").update(expected).digest();
  const suppliedDigest = createHash("sha256").update(supplied).digest();
  return timingSafeEqual(expectedDigest, suppliedDigest);
}
