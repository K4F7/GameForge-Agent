import {
  claimGameTaskRequestSchema,
  attemptIdSchema,
  createProjectInputSchema,
  evidenceSubmissionMaxBytes,
  evidenceSubmissionSchema,
  projectIdSchema,
  startAttemptInputSchema,
  createGameTaskRequestSchema,
  gameTaskIdSchema,
  gameTaskStatusSchema,
  listGameTasksRequestSchema,
  runEventBatchSchema,
  runIdSchema,
  type WireRunEvent,
} from "@gameforge/contracts";
import { createServer as createHttpServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { createHash, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { RunStore, RunStoreError, type RunStoreOptions } from "./store.js";
import { TaskInbox, TaskInboxError } from "./tasks.js";
import { ProjectAuthority, ProjectAuthorityError } from "./projects.js";

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
  projectAuthority?: ProjectAuthority;
  persistState?: () => Promise<void>;
  authToken?: string;
};

export function createRunRelayServer(options: RunRelayServerOptions = {}): Server {
  const store = options.store ?? new RunStore(options);
  const taskInbox = options.taskInbox ?? new TaskInbox(
    store,
    options.maxTasks === undefined ? {} : { maxTasks: options.maxTasks },
  );
  const projectAuthority = options.projectAuthority ?? new ProjectAuthority(taskInbox);
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
  let mutationQueue: Promise<void> = Promise.resolve();

  const durableMutation = async <T>(
    mutate: () => T,
    shouldPersist: (result: T) => boolean = () => true,
  ): Promise<T> => {
    let resolveTurn: (() => void) | undefined;
    const previous = mutationQueue;
    mutationQueue = new Promise<void>((resolve) => { resolveTurn = resolve; });
    await previous;
    const rollback = options.persistState === undefined ? undefined : {
      run: store.snapshot(),
      task: taskInbox.snapshot(),
      project: projectAuthority.snapshot(),
    };
    const notifications = store.stageNotifications();
    try {
      const result = mutate();
      if (shouldPersist(result) && options.persistState !== undefined) {
        try {
          await options.persistState();
        } catch (error) {
          notifications.discard();
          if (rollback !== undefined) {
            store.replace(rollback.run);
            taskInbox.replace(rollback.task);
            projectAuthority.replace(rollback.project);
            try {
              await options.persistState();
            } catch (rollbackError) {
              throw new AggregateError(
                [error, rollbackError],
                "Run relay persistence failed and the durable rollback could not be saved.",
              );
            }
          }
          throw error;
        }
      }
      notifications.commit();
      return result;
    } catch (error) {
      notifications.discard();
      throw error;
    } finally {
      resolveTurn?.();
    }
  };

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
      if (request.method === "POST" && url.pathname === "/projects") {
        const input = createProjectInputSchema.parse(await readJson(request));
        const project = await durableMutation(() => projectAuthority.createProject(input));
        writeJson(response, 201, { project });
        return;
      }
      const projectRoute = matchAuthorityRoute(url.pathname, "projects", projectIdSchema);
      if (projectRoute !== undefined && projectRoute.command === undefined && request.method === "GET") {
        await mutationQueue;
        writeJson(response, 200, { project: projectAuthority.getProject(projectRoute.id) });
        return;
      }
      if (request.method === "POST" && url.pathname === "/attempts") {
        const input = startAttemptInputSchema.parse(await readJson(request));
        const attempt = await durableMutation(() => projectAuthority.startAttempt(input));
        writeJson(response, 201, { attempt });
        return;
      }
      const attemptRoute = matchAuthorityRoute(url.pathname, "attempts", attemptIdSchema);
      if (attemptRoute !== undefined && attemptRoute.command === undefined && request.method === "GET") {
        await mutationQueue;
        writeJson(response, 200, { attempt: projectAuthority.getAttempt(attemptRoute.id) });
        return;
      }
      if (attemptRoute?.command === "retry" && request.method === "POST") {
        await readJson(request);
        const attempt = await durableMutation(() => projectAuthority.retryAttempt({ attemptId: attemptRoute.id }));
        writeJson(response, 201, { attempt });
        return;
      }
      if (attemptRoute?.command === "evidence" && request.method === "POST") {
        const input = await readJson(request, evidenceSubmissionMaxBytes);
        if (typeof input !== "object" || input === null || Array.isArray(input) ||
            (input as { attemptId?: unknown }).attemptId !== attemptRoute.id) {
          throw new HttpError(400, "attempt_id_mismatch", "Route and Evidence Attempt IDs must match.");
        }
        const submission = evidenceSubmissionSchema.parse(input);
        const result = await durableMutation(() => projectAuthority.sealAttemptEvidence(submission));
        writeJson(response, 200, result);
        return;
      }
      if (request.method === "POST" && url.pathname === "/tasks") {
        const input = createGameTaskRequestSchema.parse(await readJson(request));
        const created = await durableMutation(() => taskInbox.create(input));
        writeJson(response, 201, created);
        return;
      }
      if (request.method === "GET" && url.pathname === "/tasks") {
        await mutationQueue;
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
        await mutationQueue;
        writeJson(response, 200, { task: taskInbox.get(taskRoute.taskId) });
        return;
      }
      if (taskRoute?.command === "claim" && request.method === "POST") {
        const input = claimGameTaskRequestSchema.parse(await readJson(request));
        const task = await durableMutation(() => taskInbox.claim(taskRoute.taskId, input));
        writeJson(response, 200, { task });
        return;
      }
      if (taskRoute?.command === "transition" && request.method === "POST") {
        const transitionInput = await readJson(request);
        const result = await durableMutation(
          () => taskInbox.transition(taskRoute.taskId, transitionInput),
          (candidate) => candidate.outcome === "accepted",
        );
        writeJson(response, 200, result);
        return;
      }
      if (taskRoute?.command === "acceptance-contract" && request.method === "POST") {
        const contractInput = await readJson(request);
        const result = await durableMutation(() => taskInbox.compileAcceptanceContract(taskRoute.taskId, contractInput));
        writeJson(response, 200, result);
        return;
      }

      if (request.method === "POST" && url.pathname === "/runs") {
        const input = createRunSchema.parse(await readJson(request));
        const event = await durableMutation(() => store.create(input.runId));
        writeJson(response, 201, { event });
        return;
      }

      const eventRoute = matchRunRoute(url.pathname, "events");
      if (eventRoute !== undefined && request.method === "POST") {
        const batch = await readJson(request);
        const events = await durableMutation(() => taskInbox.appendRun(eventRoute, batch));
        writeJson(response, 202, { accepted: events.length, lastSequence: events.at(-1)?.sequence });
        return;
      }
      if (eventRoute !== undefined && request.method === "GET") {
        await mutationQueue;
        const after = parseAfter(url);
        const authoritativeEvents = taskInbox.authoritativeRunEvents(eventRoute);
        const lastSequence = authoritativeEvents.at(-1)?.sequence ?? 0;
        if (after > lastSequence) {
          throw new RunStoreError(409, "cursor_ahead", "Requested event cursor is ahead of the run.");
        }
        const events = authoritativeEvents
          .filter((event) => event.sequence > after)
          .slice(0, 1_000);
        writeJson(response, 200, runEventBatchSchema.parse({ runId: eventRoute, after, events }));
        return;
      }

      const streamRoute = matchRunRoute(url.pathname, "stream");
      if (streamRoute !== undefined && request.method === "GET") {
        await mutationQueue;
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
        const event = await durableMutation(() => taskInbox.finishRun(stopRoute, "run.stopped"));
        writeJson(response, 200, { event });
        return;
      }
      const completeRoute = matchRunRoute(url.pathname, "complete");
      if (completeRoute !== undefined && request.method === "POST") {
        const event = await durableMutation(() => taskInbox.finishRun(completeRoute, "run.completed"));
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

function matchAuthorityRoute(
  pathname: string,
  resource: "projects" | "attempts",
  idSchema: z.ZodType<string>,
): { id: string; command?: string } | undefined {
  const match = new RegExp(`^/${resource}/([^/]+)(?:/([^/]+))?$`).exec(pathname);
  if (match?.[1] === undefined) return undefined;
  try {
    const id = idSchema.parse(decodeURIComponent(match[1]));
    return match[2] === undefined ? { id } : { id, command: match[2] };
  } catch {
    throw new HttpError(400, `invalid_${resource.slice(0, -1)}_id`, `${resource.slice(0, -1)} ID is invalid.`);
  }
}

function matchTaskRoute(pathname: string): {
  taskId: string;
  command?: "claim" | "transition" | "acceptance-contract";
} | undefined {
  const match = /^\/tasks\/([^/]+)(?:\/(claim|transition|acceptance-contract))?$/.exec(pathname);
  if (match?.[1] === undefined) return undefined;
  try {
    const taskId = gameTaskIdSchema.parse(decodeURIComponent(match[1]));
    return match[2] === "claim" || match[2] === "transition" || match[2] === "acceptance-contract"
      ? { taskId, command: match[2] }
      : { taskId };
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

async function readJson(request: IncomingMessage, maxBytes = MAX_BODY_BYTES): Promise<unknown> {
  if (!(request.headers["content-type"] ?? "").toLowerCase().startsWith("application/json")) {
    throw new HttpError(415, "content_type_required", "Content-Type must be application/json.");
  }
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.byteLength;
    if (bytes > maxBytes) throw new HttpError(413, "body_too_large", "Request body is too large.");
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
  if (error instanceof ProjectAuthorityError) {
    const notFound = error.code === "project_not_found" || error.code === "revision_not_found" ||
      error.code === "attempt_not_found";
    return new HttpError(notFound ? 404 : 409, error.code, error.message);
  }
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
