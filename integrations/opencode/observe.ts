import path from "node:path";
import { randomUUID } from "node:crypto";
import { resolveRuntime } from "../shared/runtime.js";
import { createSdkEventSource, OpenCodeObserver } from "./observer.js";

const runtime = await resolveRuntime(import.meta.dirname, "opencode");
const baseUrl = process.env.OPENCODE_SERVER_URL?.trim() || "http://127.0.0.1:4096";
const observerSessionId = process.env.GAMEFORGE_OBSERVER_SESSION_ID?.trim() || randomUUID();
const runId = process.env.GAMEFORGE_RUN_ID?.trim() || undefined;
const outputFile = path.join(path.dirname(runtime.configPath), "sessions", observerSessionId, "opencode-events.ndjson");
const controller = new AbortController();
process.once("SIGINT", () => controller.abort()); process.once("SIGTERM", () => controller.abort());
process.stdout.write(`${JSON.stringify({ observerSessionId, runId, baseUrl, outputFile })}\n`);
await new OpenCodeObserver({ outputFile, observerSessionId, ...(runId === undefined ? {} : { runId }), source: createSdkEventSource({ baseUrl, directory: runtime.repoRoot }) }).observe(controller.signal);
