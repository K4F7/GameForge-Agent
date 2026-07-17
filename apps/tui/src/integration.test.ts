import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { RunRelayClient } from "@gameforge/run-relay/client";
import { createRunRelayServer } from "@gameforge/run-relay";
import { summarizeRun } from "./summary.js";

const servers: ReturnType<typeof createRunRelayServer>[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => {
    server.closeAllConnections();
    server.close(() => resolve());
  })));
});

describe("TUI relay integration", () => {
  it("submits, lists, replays and stops a real local task", async () => {
    const server = createRunRelayServer();
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address() as AddressInfo;
    const client = new RunRelayClient({ baseUrl: `http://127.0.0.1:${address.port}/` });
    const created = await client.createTask({
      runId: "tui-integration",
      prompt: "Create a complete deterministic browser safety game.",
      language: "en-US",
      projectId: "safety-game",
    });
    expect(created.task.projectId).toBe("safety-game");
    expect((await client.listTasks({ limit: 5 }))[0]?.taskId).toBe(created.task.taskId);
    const replay = await client.replayEvents({ runId: created.task.runId, after: 0 });
    expect(summarizeRun(replay.events)).toMatchObject({ status: "running", locale: "en-US" });
    expect(await client.stopRun(created.task.runId)).toMatchObject({ type: "run.stopped", sequence: 2 });
    expect(await client.getTask(created.task.taskId)).toMatchObject({ status: "stopped" });
  });
});
