import type { WireRunEvent } from "@gameforge/contracts";
import { RunRelayClientError } from "@gameforge/run-relay/client";
import { describe, expect, it, vi } from "vitest";
import { RunStreamError } from "./stream.js";
import { watchRun } from "./watch.js";

const emittedAt = "2026-07-18T05:00:00+08:00";
const event = (type: WireRunEvent["type"], sequence: number): WireRunEvent => {
  if (type === "run.started") return { type, runId: "run-1", sequence, emittedAt };
  if (type === "run.completed") return { type, runId: "run-1", sequence, emittedAt };
  if (type === "run.stopped") return { type, runId: "run-1", sequence, emittedAt };
  throw new Error("Unsupported test event type.");
};

describe("TUI watch recovery", () => {
  it("replays from the last contiguous cursor after a stream failure", async () => {
    const replayAfter: number[] = [];
    const client = {
      async replayEvents(input: { runId: string; after: number }) {
        replayAfter.push(input.after);
        return {
          runId: input.runId,
          after: input.after,
          events: input.after === 0 ? [event("run.started", 1)] : [event("run.stopped", 2)],
        };
      },
    };
    const received: number[] = [];
    const retries: number[] = [];
    const result = await watchRun({
      client,
      baseUrl: "http://127.0.0.1:8787/",
      runId: "run-1",
      after: 0,
      onEvent: (item) => received.push(item.sequence),
      onRetry: (retry) => retries.push(retry.cursor),
      retryDelaysMs: [5],
      sleep: async () => undefined,
      stream: async () => { throw new RunStreamError("eof", "disconnected"); },
    });

    expect(replayAfter).toEqual([0, 1]);
    expect(received).toEqual([1, 2]);
    expect(retries).toEqual([1]);
    expect(result).toEqual({ cursor: 2, terminal: true, aborted: false });
  });

  it("emits live terminal events once and does not reconnect", async () => {
    const client = { replayEvents: vi.fn(async (input: { runId: string; after: number }) => ({
      runId: input.runId, after: input.after, events: [event("run.started", 1)],
    })) };
    const stream = vi.fn(async (options: { onEvent(item: WireRunEvent): void }) => {
      options.onEvent(event("run.completed", 2));
    });
    const received: number[] = [];
    const result = await watchRun({
      client,
      baseUrl: "http://127.0.0.1:8787/",
      runId: "run-1",
      after: 0,
      onEvent: (item) => received.push(item.sequence),
      stream,
    });
    expect(received).toEqual([1, 2]);
    expect(client.replayEvents).toHaveBeenCalledOnce();
    expect(stream).toHaveBeenCalledOnce();
    expect(result.terminal).toBe(true);
  });

  it("bounds transient retries and does not retry an expired cursor", async () => {
    const transient = {
      replayEvents: vi.fn(async () => { throw new RunRelayClientError("network", "offline"); }),
    };
    const delays: number[] = [];
    await expect(watchRun({
      client: transient,
      baseUrl: "http://127.0.0.1:8787/",
      runId: "run-1",
      after: 4,
      onEvent() {},
      retryDelaysMs: [5, 10],
      sleep: async (delay) => { delays.push(delay); },
    })).rejects.toThrow("exhausted at cursor 4");
    expect(delays).toEqual([5, 10]);
    expect(transient.replayEvents).toHaveBeenCalledTimes(3);

    let slept = false;
    await expect(watchRun({
      client: {
        replayEvents: async () => { throw new RunRelayClientError("http", "expired", 410, "cursor_expired"); },
      },
      baseUrl: "http://127.0.0.1:8787/",
      runId: "run-1",
      after: 4,
      onEvent() {},
      sleep: async () => { slept = true; },
    })).rejects.toThrow("expired");
    expect(slept).toBe(false);
  });

  it("does not treat a stream that returns without a terminal event as success", async () => {
    await expect(watchRun({
      client: {
        replayEvents: async (input) => ({
          runId: input.runId,
          after: input.after,
          events: input.after === 0 ? [event("run.started", 1)] : [],
        }),
      },
      baseUrl: "http://127.0.0.1:8787/",
      runId: "run-1",
      after: 0,
      onEvent() {},
      retryDelaysMs: [],
      stream: async () => undefined,
    })).rejects.toThrow("returned without a terminal event");
  });
});
