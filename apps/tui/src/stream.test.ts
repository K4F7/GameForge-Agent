import { describe, expect, it } from "vitest";
import { streamRunEvents } from "./stream.js";

const emittedAt = "2026-07-18T02:00:00+08:00";

function response(blocks: string[]): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const block of blocks) controller.enqueue(encoder.encode(block));
      controller.close();
    },
  });
  return new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } });
}

describe("TUI SSE stream", () => {
  it("emits contiguous events and stops on a terminal event", async () => {
    const received: string[] = [];
    await streamRunEvents({
      baseUrl: "http://127.0.0.1:8787/",
      runId: "run-1",
      after: 0,
      fetch: async () => response([
        `retry: 1000\n\ndata: ${JSON.stringify({ type: "run.started", runId: "run-1", sequence: 1, emittedAt })}\n\n`,
        `data: ${JSON.stringify({ type: "run.completed", runId: "run-1", sequence: 2, emittedAt })}\n\n`,
      ]),
      onEvent: (event) => received.push(event.type),
    });
    expect(received).toEqual(["run.started", "run.completed"]);
  });

  it("rejects sequence gaps and unsafe relay URLs", async () => {
    await expect(streamRunEvents({
      baseUrl: "http://127.0.0.1:8787/", runId: "run-1", after: 0, onEvent() {},
      fetch: async () => response([
        `data: ${JSON.stringify({ type: "run.completed", runId: "run-1", sequence: 2, emittedAt })}\n\n`,
      ]),
    })).rejects.toThrow("sequence gap");
    await expect(streamRunEvents({
      baseUrl: "http://example.com/", runId: "run-1", after: 0, onEvent() {},
    })).rejects.toThrow("loopback");
  });

  it("treats a nonterminal EOF as a reconnectable failure", async () => {
    await expect(streamRunEvents({
      baseUrl: "http://127.0.0.1:8787/", runId: "run-1", after: 0, onEvent() {},
      fetch: async () => response([
        `data: ${JSON.stringify({ type: "run.started", runId: "run-1", sequence: 1, emittedAt })}`,
      ]),
    })).rejects.toThrow("ended before a terminal event");
  });
});
