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
      }),
    });
    expect(createdResponse.status).toBe(201);
    const created = createGameTaskResponseSchema.parse(await createdResponse.json());
    expect(created).toMatchObject({
      task: { runId: "run-task-1", status: "queued" },
      event: { type: "run.started", sequence: 1 },
    });

    const retriedResponse = await fetch(`${baseUrl}/tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "http://localhost:4173" },
      body: JSON.stringify({
        runId: "run-task-1",
        prompt: "制作一个可以收集装备并避开危险的浏览器小游戏。",
        language: "zh-CN",
      }),
    });
    expect(retriedResponse.status).toBe(201);
    expect(createGameTaskResponseSchema.parse(await retriedResponse.json())).toEqual(created);

    const conflictingResponse = await fetch(`${baseUrl}/tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "http://localhost:4173" },
      body: JSON.stringify({
        runId: "run-task-1",
        prompt: "制作一个内容不同但复用相同 Run ID 的浏览器小游戏。",
        language: "zh-CN",
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
    await expect(relayClient.getTask(created.task.taskId)).resolves.toMatchObject({ status: "completed" });
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
