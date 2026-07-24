#!/usr/bin/env node

import { randomBytes, timingSafeEqual } from "node:crypto";
import { lstat, open, readFile, rename, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import type { AddressInfo } from "node:net";
import { DouyinBridgeController, type DouyinRuntimeAction } from "./douyin-bridge-controller.js";

const rendezvousPath = resolve(tmpdir(), "gameforge-douyin-bridge-host.json");
const lockPath = resolve(tmpdir(), "gameforge-douyin-bridge-host.lock");
const lockOwner = await acquireLock();
const controller = new DouyinBridgeController();
const token = randomBytes(32).toString("base64url");

const server = createServer(async (request, response) => {
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.setHeader("cache-control", "no-store");
  if (!isAuthorized(request.headers.authorization, token)) {
    response.writeHead(401).end(JSON.stringify({ error: "unauthorized" }));
    return;
  }
  try {
    if (request.method === "GET" && request.url === "/v1/status") {
      response.end(JSON.stringify({ status: controller.getStatus() }));
      return;
    }
    if (request.method === "POST" && request.url === "/v1/runtime-status") {
      response.end(JSON.stringify({ status: controller.getStatus(), result: await controller.getRuntimeStatus() }));
      return;
    }
    if (request.method === "POST" && request.url === "/v1/runtime-action") {
      const action = parseAction(await readBody(request));
      response.end(JSON.stringify({ status: controller.getStatus(), result: await controller.runRuntimeAction(action) }));
      return;
    }
    response.writeHead(404).end(JSON.stringify({ error: "not_found" }));
  } catch (error) {
    response.writeHead(503).end(JSON.stringify({ error: "bridge_unavailable", message: error instanceof Error ? error.message : String(error), status: controller.getStatus() }));
  }
});

try {
  await controller.start();
  await new Promise<void>((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const address = server.address() as AddressInfo;
  await writeRendezvous(address.port, token);
  process.stderr.write(`GameForge Douyin bridge host listening on http://127.0.0.1:${address.port}\n`);
} catch (error) {
  await controller.stop().catch(() => undefined);
  await closeServer();
  await releaseLock(lockOwner);
  throw error;
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => void shutdown(signal === "SIGINT" ? 130 : 143));
}

async function shutdown(exitCode: number): Promise<void> {
  await controller.stop().catch(() => undefined);
  await rm(rendezvousPath, { force: true }).catch(() => undefined);
  await releaseLock(lockOwner);
  await closeServer();
  process.exit(exitCode);
}

async function acquireLock(): Promise<string> {
  const owner = String(process.pid);
  try {
    const handle = await open(lockPath, "wx", 0o600);
    await handle.writeFile(owner, "utf8");
    await handle.close();
    return owner;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  const existingPid = Number.parseInt(await readFile(lockPath, "utf8").catch(() => ""), 10);
  if (Number.isInteger(existingPid) && existingPid > 0 && isProcessAlive(existingPid)) {
    throw new Error(`A GameForge Douyin bridge host is already running with PID ${existingPid}.`);
  }
  await rm(lockPath, { force: true });
  const handle = await open(lockPath, "wx", 0o600);
  await handle.writeFile(owner, "utf8");
  await handle.close();
  return owner;
}

async function releaseLock(owner: string): Promise<void> {
  const current = await readFile(lockPath, "utf8").catch(() => undefined);
  if (current === owner) await rm(lockPath, { force: true }).catch(() => undefined);
}

async function closeServer(): Promise<void> {
  server.closeAllConnections();
  if (!server.listening) return;
  await new Promise<void>((resolveClose) => server.close(() => resolveClose())).catch(() => undefined);
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

async function writeRendezvous(port: number, authToken: string): Promise<void> {
  try {
    const metadata = await lstat(rendezvousPath);
    if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error("The Douyin bridge host rendezvous path is unsafe.");
    await rm(rendezvousPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const temporaryPath = `${rendezvousPath}.${process.pid}.tmp`;
  await writeFile(temporaryPath, JSON.stringify({ port, token: authToken, pid: process.pid }), { encoding: "utf8", mode: 0o600, flag: "wx" });
  await rename(temporaryPath, rendezvousPath);
}

function isAuthorized(header: string | undefined, expected: string): boolean {
  if (header?.startsWith("Bearer ") !== true) return false;
  const actual = Buffer.from(header.slice(7));
  const wanted = Buffer.from(expected);
  return actual.byteLength === wanted.byteLength && timingSafeEqual(actual, wanted);
}

async function readBody(request: import("node:http").IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.byteLength;
    if (size > 4_096) throw new Error("Request body is too large.");
    chunks.push(bytes);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function parseAction(value: unknown): DouyinRuntimeAction {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("Invalid Runtime action.");
  const record = value as Record<string, unknown>;
  if (record.action === "reload" || record.action === "screenshot") return { action: record.action };
  if (record.action === "tap" && typeof record.x === "number" && typeof record.y === "number" &&
      Number.isFinite(record.x) && Number.isFinite(record.y) && record.x >= 0 && record.x <= 4_096 && record.y >= 0 && record.y <= 4_096) {
    return { action: "tap", x: record.x, y: record.y };
  }
  if (record.action === "collectConsole" && Number.isInteger(record.durationMs) &&
      typeof record.durationMs === "number" && record.durationMs >= 0 && record.durationMs <= 5_000) {
    return { action: "collectConsole", durationMs: record.durationMs };
  }
  throw new Error("Invalid Runtime action.");
}
