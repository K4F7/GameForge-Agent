import { describe, expect, it, vi } from "vitest";
import { RunRelayClient, RunRelayClientError, type RelayFetch } from "./client.js";

const emittedAt = "2026-07-16T06:00:00+08:00";

describe("RunRelayClient", () => {
  it("lists, reads, and claims validated game tasks", async () => {
    const taskId = "task-00000000-0000-0000-0000-000000000000";
    const queued = {
      taskId,
      runId: "run-1",
      prompt: "Create a complete browser arcade game.",
      language: "en-US",
      status: "queued",
      createdAt: emittedAt,
    };
    const claimed = { ...queued, status: "claimed", claimedAt: emittedAt, claimedBy: "codearts" };
    const fetchMock = vi.fn<RelayFetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ tasks: [queued] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ task: queued }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ task: claimed }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }));
    const client = new RunRelayClient({ baseUrl: "http://127.0.0.1:8787/", fetch: fetchMock });
    await expect(client.listTasks({ status: "queued", limit: 5 })).resolves.toHaveLength(1);
    await expect(client.getTask(taskId)).resolves.toMatchObject({ status: "queued" });
    await expect(client.claimTask(taskId, { agentId: "codearts" })).resolves.toMatchObject({
      status: "claimed",
      claimedBy: "codearts",
    });
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("tasks?limit=5&status=queued");
  });

  it("creates and publishes a strictly validated run", async () => {
    const fetchMock = vi.fn<RelayFetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        event: { type: "run.started", runId: "run-1", sequence: 1, emittedAt },
      }), { status: 201, headers: { "Content-Type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ accepted: 1, lastSequence: 2 }), {
        status: 202,
        headers: { "Content-Type": "application/json" },
      }));
    const client = new RunRelayClient({ baseUrl: "http://127.0.0.1:8787/", fetch: fetchMock });

    expect(await client.createRun("run-1")).toMatchObject({ type: "run.started", sequence: 1 });
    expect(await client.publishEvents({
      runId: "run-1",
      after: 1,
      events: [{
        type: "phase.started",
        runId: "run-1",
        sequence: 2,
        emittedAt,
        phase: "spec",
        detail: "Validating",
      }],
    })).toEqual({ accepted: 1, lastSequence: 2 });
    expect(String(fetchMock.mock.calls[1]?.[0])).toBe("http://127.0.0.1:8787/runs/run-1/events");
  });

  it("replays one validated bounded event page after an explicit cursor", async () => {
    const replay = {
      runId: "run-1",
      after: 1,
      events: [{
        type: "phase.started",
        runId: "run-1",
        sequence: 2,
        emittedAt,
        phase: "spec",
        detail: "Validating",
      }],
    };
    const fetchMock = vi.fn<RelayFetch>(async () => new Response(JSON.stringify(replay), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));
    const client = new RunRelayClient({ baseUrl: "http://127.0.0.1:8787/", fetch: fetchMock });

    await expect(client.replayEvents({ runId: "run-1", after: 1 })).resolves.toEqual(replay);
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      "http://127.0.0.1:8787/runs/run-1/events?after=1",
    );
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ method: "GET" });
  });

  it("preserves only the stable relay error code", async () => {
    const fetchMock = vi.fn<RelayFetch>(async () => new Response(JSON.stringify({
      error: "cursor_conflict",
      message: "sensitive internal detail",
    }), { status: 409, headers: { "Content-Type": "application/json" } }));
    const client = new RunRelayClient({ baseUrl: "http://localhost:8787/", fetch: fetchMock });

    let caught: unknown;
    try {
      await client.publishEvents({ runId: "run-1", after: 0, events: [] });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(RunRelayClientError);
    expect(caught).toMatchObject({ code: "http", statusCode: 409, relayCode: "cursor_conflict" });
    expect((caught as Error).message).not.toContain("sensitive");
  });

  it("aborts requests at the configured timeout", async () => {
    const fetchMock = vi.fn<RelayFetch>((_input, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
    }));
    const client = new RunRelayClient({
      baseUrl: "http://localhost:8787/",
      fetch: fetchMock,
      timeoutMilliseconds: 100,
    });

    await expect(client.createRun("run-1")).rejects.toMatchObject({ code: "timeout" });
  });

  it("rejects insecure or credential-bearing relay URLs", () => {
    expect(() => new RunRelayClient({ baseUrl: "http://relay.example.com/" })).toThrow("HTTPS");
    expect(() => new RunRelayClient({ baseUrl: "https://user:secret@relay.example.com/" })).toThrow("credentials");
  });
});
