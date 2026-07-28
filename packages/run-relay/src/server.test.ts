import type { AddressInfo } from "node:net";
import { createGameTaskResponseSchema } from "@gameforge/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { createRunRelayServer } from "./server.js";
import { RunRelayClient } from "./client.js";

const servers: ReturnType<typeof createRunRelayServer>[] = [];

async function startServer(
  options: Parameters<typeof createRunRelayServer>[0] = {},
): Promise<string> {
  const server = createRunRelayServer({ heartbeatMilliseconds: 1_000, ...options });
  servers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => {
    server.closeAllConnections();
    server.close(() => resolve());
  })));
});

describe("run relay HTTP server", () => {
  it("protects every non-preflight route when bearer authentication is configured", async () => {
    const token = "relay-test-token-0123456789-abcdef";
    const baseUrl = await startServer({ authToken: token });
    const missing = await fetch(`${baseUrl}/tasks?limit=1`);
    expect(missing.status).toBe(401);
    await expect(missing.json()).resolves.toMatchObject({ error: "authentication_required" });
    expect(missing.headers.get("www-authenticate")).toBe("Bearer");
    expect((await fetch(`${baseUrl}/tasks?limit=1`, {
      headers: { Authorization: "Bearer wrong-token-with-enough-characters-000" },
    })).status).toBe(401);
    const authorized = await fetch(`${baseUrl}/tasks?limit=1`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(authorized.status).toBe(200);
    const preflight = await fetch(`${baseUrl}/tasks`, { method: "OPTIONS" });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-headers")).toContain("Authorization");
  });

  it("awaits persistence after mutations but not reads", async () => {
    let saves = 0;
    const baseUrl = await startServer({ persistState: async () => { saves += 1; } });
    const created = await fetch(`${baseUrl}/runs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ runId: "run-persist-hook" }),
    });
    expect(created.status).toBe(201);
    expect(saves).toBe(1);
    const replay = await fetch(`${baseUrl}/runs/run-persist-hook/events?after=0`);
    expect(replay.status).toBe(200);
    expect(saves).toBe(1);
    const stopped = await fetch(`${baseUrl}/runs/run-persist-hook/stop`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    expect(stopped.status).toBe(200);
    expect(saves).toBe(2);
  });

  it("creates, lists, claims, and completes a game task with its run", async () => {
    const baseUrl = await startServer();
    const createdResponse = await fetch(`${baseUrl}/tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "http://localhost:4173" },
      body: JSON.stringify({
        runId: "run-task-1",
        prompt: "制作一个可以收集装备并避开危险的浏览器小游戏。",
        language: "zh-CN",
        projectId: "safety-game",
      }),
    });
    expect(createdResponse.status).toBe(201);
    const created = createGameTaskResponseSchema.parse(await createdResponse.json());
    expect(created).toMatchObject({
      task: { runId: "run-task-1", status: "queued", projectId: "safety-game" },
      event: { type: "run.started", sequence: 1 },
    });

    const retriedResponse = await fetch(`${baseUrl}/tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "http://localhost:4173" },
      body: JSON.stringify({
        runId: "run-task-1",
        prompt: "制作一个可以收集装备并避开危险的浏览器小游戏。",
        language: "zh-CN",
        projectId: "safety-game",
      }),
    });
    expect(retriedResponse.status).toBe(201);
    expect(createGameTaskResponseSchema.parse(await retriedResponse.json())).toEqual(created);

    const conflictingResponse = await fetch(`${baseUrl}/tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "http://localhost:4173" },
      body: JSON.stringify({
        runId: "run-task-1",
        prompt: "制作一个可以收集装备并避开危险的浏览器小游戏。",
        language: "zh-CN",
        projectId: "another-game",
      }),
    });
    expect(conflictingResponse.status).toBe(409);
    await expect(conflictingResponse.json()).resolves.toMatchObject({ error: "task_run_conflict" });

    const relayClient = new RunRelayClient({ baseUrl });
    await expect(relayClient.listTasks({ status: "queued", limit: 10 }))
      .resolves.toEqual([expect.objectContaining({ taskId: created.task.taskId })]);
    await expect(relayClient.claimTask(created.task.taskId, { agentId: "codearts" }))
      .resolves.toMatchObject({ status: "claimed", claimedBy: "codearts" });
    await expect(relayClient.completeRun("run-task-1")).resolves.toMatchObject({ type: "run.completed" });
    await expect(relayClient.getTask(created.task.taskId)).resolves.toMatchObject({ status: "claimed" });
  });

  it("creates a task through the shared client without browser-only APIs", async () => {
    const baseUrl = await startServer();
    const client = new RunRelayClient({ baseUrl });
    const created = await client.createTask({
      runId: "run-client-task",
      prompt: "Create a deterministic browser game from this terminal request.",
      language: "en-US",
    });
    expect(created).toMatchObject({
      task: { runId: "run-client-task", language: "en-US", status: "queued" },
      event: { type: "run.started", language: "en-US", sequence: 1 },
    });
  });

  it("returns a stable invalid result for an unknown reason without changing the public Task bytes", async () => {
    const baseUrl = await startServer();
    const client = new RunRelayClient({ baseUrl });
    const created = await client.createTask({
      runId: "run-unknown-reason",
      prompt: "Create a browser game while preserving fail-closed Task state.",
      language: "en-US",
    });
    const before = JSON.stringify(await client.getTask(created.task.taskId));

    await expect(client.transitionTask(created.task.taskId, {
      status: "completed",
      reasonCode: { schemaVersion: "1.0", code: "unknown-failure" },
    })).resolves.toMatchObject({
      schemaVersion: "1.0",
      outcome: "invalid",
      code: "invalid-transition-request",
      task: { status: "queued" },
    });

    expect(JSON.stringify(await client.getTask(created.task.taskId))).toBe(before);
    await expect(client.transitionTask(created.task.taskId, {
      status: "needs-info",
      reasonCode: { schemaVersion: "1.0", code: "requirements-ambiguous" },
    })).resolves.toMatchObject({ outcome: "accepted", task: { status: "needs-info" } });
    await expect(client.getTask(created.task.taskId)).resolves.toMatchObject({
      status: "needs-info",
      reasonCode: { schemaVersion: "1.0", code: "requirements-ambiguous" },
    });
  });

  it("creates a run, appends events, and replays a validated batch", async () => {
    const baseUrl = await startServer();
    const created = await fetch(`${baseUrl}/runs`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "http://localhost:4173" },
      body: JSON.stringify({ runId: "run-1" }),
    });
    expect(created.status).toBe(201);
    expect(created.headers.get("access-control-allow-origin")).toBe("http://localhost:4173");

    const appended = await fetch(`${baseUrl}/runs/run-1/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        runId: "run-1",
        after: 1,
        events: [{
          type: "log.appended",
          runId: "run-1",
          sequence: 2,
          emittedAt: "2026-07-16T06:00:00+08:00",
          source: "tool",
          level: "success",
          message: "Generated project",
        }],
      }),
    });
    expect(appended.status).toBe(202);

    const replay = await fetch(`${baseUrl}/runs/run-1/events?after=1`);
    expect(await replay.json()).toMatchObject({
      runId: "run-1",
      after: 1,
      events: [{ sequence: 2, type: "log.appended" }],
    });
  });

  it("streams retained events over SSE", async () => {
    const baseUrl = await startServer();
    await fetch(`${baseUrl}/runs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ runId: "run-sse" }),
    });
    const controller = new AbortController();
    try {
      const response = await fetch(`${baseUrl}/runs/run-sse/stream?after=0`, { signal: controller.signal });
      expect(response.headers.get("content-type")).toContain("text/event-stream");
      const reader = response.body?.getReader();
      const chunk = await reader?.read();
      const text = new TextDecoder().decode(chunk?.value);
      expect(text).toContain("id: 1");
      expect(text).toContain('"type":"run.started"');
    } finally {
      controller.abort();
    }
  });

  it("rejects untrusted browser origins and stale cursors", async () => {
    const baseUrl = await startServer();
    const forbidden = await fetch(`${baseUrl}/runs`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://attacker.example" },
      body: JSON.stringify({ runId: "run-1" }),
    });
    expect(forbidden.status).toBe(403);

    await fetch(`${baseUrl}/runs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ runId: "run-1" }),
    });
    const stale = await fetch(`${baseUrl}/runs/run-1/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ runId: "run-1", after: 0, events: [] }),
    });
    expect(stale.status).toBe(409);
  });
});
