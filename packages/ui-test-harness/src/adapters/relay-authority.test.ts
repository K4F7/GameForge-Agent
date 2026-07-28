import type { AddressInfo } from "node:net";
import { createServer, type Server } from "node:http";
import { createRunRelayServer } from "@gameforge/run-relay";
import { RunRelayClient } from "@gameforge/run-relay/client";
import { afterEach, describe, expect, it } from "vitest";
import { RelayAuthorityDriver } from "./relay-authority.js";

const servers: Server[] = [];
afterEach(async () => { await Promise.all(servers.splice(0).map(closeServer)); });

describe("RelayAuthorityDriver", () => {
  it("rejects a snapshot when the Task belongs to a different Run", async () => {
    const server = createRunRelayServer(); servers.push(server);
    await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
    const address = server.address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const client = new RunRelayClient({ baseUrl });
    const first = await client.createTask({ runId: "run-authority-first", prompt: "Build the first game.", language: "en-US", projectId: "first-game" });
    const second = await client.createTask({ runId: "run-authority-second", prompt: "Build the second game.", language: "en-US", projectId: "second-game" });

    const authority = new RelayAuthorityDriver({
      baseUrl,
      taskId: first.task.taskId,
      runId: second.task.runId,
      projectId: "first-game",
    });

    await expect(authority.snapshot()).rejects.toThrow(
      `Authority Run mismatch: expected ${second.task.runId}, received ${first.task.runId}`,
    );
  });

  it("rejects a snapshot when the Task belongs to a different Project", async () => {
    const server = createRunRelayServer(); servers.push(server);
    await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
    const address = server.address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const client = new RunRelayClient({ baseUrl });
    const created = await client.createTask({ runId: "run-authority-project", prompt: "Build the bound game.", language: "en-US", projectId: "bound-game" });
    const authority = new RelayAuthorityDriver({
      baseUrl,
      taskId: created.task.taskId,
      runId: created.task.runId,
      projectId: "other-game",
    });

    await expect(authority.snapshot()).rejects.toThrow(
      "Authority Project mismatch: expected other-game, received bound-game",
    );
  });

  it("projects a repairable phase failure as the Relay repair state", async () => {
    const server = createRunRelayServer(); servers.push(server);
    await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
    const address = server.address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const client = new RunRelayClient({ baseUrl });
    const created = await client.createTask({ runId: "run-authority-repair", prompt: "Build and repair a browser game.", language: "en-US", projectId: "repair-game" });
    await client.claimTask(created.task.taskId, { agentId: "codearts" });
    await client.publishEvents({
      runId: created.task.runId,
      after: 1,
      events: [{
        type: "phase.failed",
        runId: created.task.runId,
        sequence: 2,
        emittedAt: "2026-07-23T00:00:00.000Z",
        phase: "test",
        message: "The first verification attempt failed.",
        repairable: true,
      }],
    });

    const authority = new RelayAuthorityDriver({ baseUrl, taskId: created.task.taskId, runId: created.task.runId, projectId: "repair-game" });
    await expect(authority.snapshot()).resolves.toMatchObject({
      taskStatus: "claimed",
      runStatus: "repair",
      eventSequence: 2,
      lastEventType: "phase.failed",
    });
  });

  it("replays full pages before projecting a terminal run status", async () => {
    const server = createRunRelayServer(); servers.push(server);
    await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
    const address = server.address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const client = new RunRelayClient({ baseUrl });
    const created = await client.createTask({ runId: "run-authority-pagination", prompt: "Replay a long run.", language: "en-US", projectId: "pagination-game" });
    await client.claimTask(created.task.taskId, { agentId: "codearts" });
    await client.publishEvents({
      runId: created.task.runId,
      after: 1,
      events: Array.from({ length: 1_000 }, (_, index) => ({
        type: "phase.started" as const,
        runId: created.task.runId,
        sequence: index + 2,
        emittedAt: "2026-07-23T00:00:00.000Z",
        phase: "code" as const,
        detail: `Step ${index + 1}`,
      })),
    });
    await client.transitionTask(created.task.taskId, { status: "in-progress" });
    await client.completeRun(created.task.runId);
    await client.transitionTask(created.task.taskId, { status: "completed" });

    const authority = new RelayAuthorityDriver({ baseUrl, taskId: created.task.taskId, runId: created.task.runId, projectId: "pagination-game" });
    await expect(authority.snapshot()).resolves.toMatchObject({ taskStatus: "completed", runStatus: "completed", eventSequence: 1_002, lastEventType: "run.completed" });
  });

  it("does not regress when concurrent snapshots receive event pages out of order", async () => {
    let replayRequest = 0;
    const server = createServer((request, response) => {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      if (url.pathname === "/tasks/task-00000000-0000-0000-0000-000000000000") {
        respondJson(response, {
          task: {
            taskId: "task-00000000-0000-0000-0000-000000000000",
            runId: "run-authority-concurrent",
            prompt: "Observe concurrent authority snapshots.",
            language: "en-US",
            projectId: "concurrent-game",
            status: "claimed",
            createdAt: "2026-07-23T00:00:00.000Z",
            claimedAt: "2026-07-23T00:00:01.000Z",
            claimedBy: "codearts",
          },
        });
        return;
      }
      if (url.pathname === "/runs/run-authority-concurrent/events") {
        replayRequest += 1;
        const events = [
          { type: "run.started", runId: "run-authority-concurrent", sequence: 1, emittedAt: "2026-07-23T00:00:01.000Z", language: "en-US" },
          { type: "phase.started", runId: "run-authority-concurrent", sequence: 2, emittedAt: "2026-07-23T00:00:02.000Z", phase: "test", detail: "Verify the game." },
          ...(replayRequest === 1 ? [] : [
            { type: "run.completed", runId: "run-authority-concurrent", sequence: 3, emittedAt: "2026-07-23T00:00:03.000Z" },
          ]),
        ];
        const delay = replayRequest === 1 ? 20 : 0;
        setTimeout(() => respondJson(response, {
          runId: "run-authority-concurrent",
          after: Number(url.searchParams.get("after")),
          events,
        }), delay);
        return;
      }
      response.writeHead(404).end();
    });
    servers.push(server);
    await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
    const address = server.address() as AddressInfo;
    const authority = new RelayAuthorityDriver({
      baseUrl: `http://127.0.0.1:${address.port}`,
      taskId: "task-00000000-0000-0000-0000-000000000000",
      runId: "run-authority-concurrent",
      projectId: "concurrent-game",
    });

    const [first, second] = await Promise.all([authority.snapshot(), authority.snapshot()]);

    expect(first).toMatchObject({ runStatus: "completed", eventSequence: 3, lastEventType: "run.completed" });
    expect(second).toMatchObject({ runStatus: "completed", eventSequence: 3, lastEventType: "run.completed" });
  });
});

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve) => { server.closeAllConnections(); server.close(() => resolve()); });
}

function respondJson(response: import("node:http").ServerResponse, body: unknown): void {
  response.writeHead(200, { "Content-Type": "application/json" });
  response.end(JSON.stringify(body));
}
