import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { createRunRelayServer } from "@gameforge/run-relay";
import { RunRelayClient } from "@gameforge/run-relay/client";
import { afterEach, describe, expect, it } from "vitest";
import { RelayAuthorityDriver } from "./relay-authority.js";

const servers: Server[] = [];
afterEach(async () => { await Promise.all(servers.splice(0).map(closeServer)); });

describe("RelayAuthorityDriver", () => {
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
    await client.completeRun(created.task.runId);

    const authority = new RelayAuthorityDriver({ baseUrl, taskId: created.task.taskId, runId: created.task.runId, projectId: "pagination-game" });
    await expect(authority.snapshot()).resolves.toMatchObject({ taskStatus: "completed", runStatus: "completed", eventSequence: 1_002, lastEventType: "run.completed" });
  });
});

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve) => { server.closeAllConnections(); server.close(() => resolve()); });
}
