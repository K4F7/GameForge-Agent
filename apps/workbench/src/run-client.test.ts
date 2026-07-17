import { describe, expect, it, vi } from "vitest";
import {
  connectRunEventStream,
  connectRecoveringRunEventStream,
  createGameTask,
  createRun,
  fetchRunEvents,
  stopRun,
  type RunEventSource,
} from "./run-client.js";

const emittedAt = "2026-07-16T06:00:00+08:00";

async function waitUntil(assertion: () => void, attempts = 50): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      assertion();
      return;
    } catch (error) {
      lastError = error;
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
  }
  throw lastError;
}

class FakeEventSource implements RunEventSource {
  readonly listeners = new Map<string, Array<(event: MessageEvent<string> | Event) => void>>();
  closed = false;

  addEventListener(type: "open" | "message" | "error", listener: (event: MessageEvent<string> | Event) => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  emit(type: "open" | "message" | "error", event: MessageEvent<string> | Event): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener(event);
    }
  }

  close(): void {
    this.closed = true;
  }
}

describe("run event client", () => {
  it("creates a validated game task and authoritative run from the prompt", async () => {
    const taskId = "task-00000000-0000-0000-0000-000000000000";
    const fetchMock = vi.fn<typeof globalThis.fetch>(async () =>
      new Response(JSON.stringify({
        task: {
          taskId,
          runId: "run-1",
          prompt: "制作一个可以收集装备并避开危险的浏览器小游戏。",
          language: "zh-CN",
          projectId: "safety-game",
          status: "queued",
          createdAt: emittedAt,
        },
        event: { type: "run.started", runId: "run-1", sequence: 1, emittedAt, language: "zh-CN" },
      }), { status: 201, headers: { "Content-Type": "application/json" } }),
    );
    const result = await createGameTask({
      baseUrl: "http://127.0.0.1:8787/",
      runId: "run-1",
      prompt: "制作一个可以收集装备并避开危险的浏览器小游戏。",
      projectId: "safety-game",
      fetch: fetchMock,
    });
    expect(result).toMatchObject({
      task: { taskId, status: "queued", projectId: "safety-game" },
      event: { type: "run.started", language: "zh-CN" },
    });
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe("http://127.0.0.1:8787/tasks");
    expect(fetchMock.mock.calls[0]?.[1]?.body).toContain('"language":"zh-CN"');
    expect(fetchMock.mock.calls[0]?.[1]?.body).toContain('"projectId":"safety-game"');
  });

  it("creates a relay run without sending credentials", async () => {
    const fetchMock = vi.fn<typeof globalThis.fetch>(async () =>
      new Response(JSON.stringify({
        event: { type: "run.started", runId: "run-1", sequence: 1, emittedAt },
      }), { status: 201, headers: { "Content-Type": "application/json" } }),
    );

    const event = await createRun({
      baseUrl: "http://localhost:8787/",
      runId: "run-1",
      fetch: fetchMock,
    });

    expect(event).toEqual({ type: "run.started", runId: "run-1", sequence: 1 });
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toBe("http://localhost:8787/runs");
    expect(init?.body).toBe('{"runId":"run-1"}');
  });

  it("fetches and validates a contiguous replay batch", async () => {
    const fetchMock = vi.fn<typeof globalThis.fetch>(async () =>
      new Response(JSON.stringify({
        runId: "run-1",
        after: 1,
        events: [{
          type: "log.appended",
          runId: "run-1",
          sequence: 2,
          emittedAt,
          source: "agent",
          level: "info",
          message: "Continuing",
        }],
      }), { status: 200, headers: { "Content-Type": "application/json" } }),
    );

    const events = await fetchRunEvents({
      baseUrl: "http://localhost:8787/api/",
      runId: "run-1",
      after: 1,
      fetch: fetchMock,
    });

    expect(events).toEqual([{
      type: "log.appended",
      runId: "run-1",
      sequence: 2,
      source: "agent",
      level: "info",
      message: "Continuing",
    }]);
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      "http://localhost:8787/api/runs/run-1/events?after=1",
    );
  });

  it("stops a real relay run instead of only disconnecting the stream", async () => {
    const fetchMock = vi.fn<typeof globalThis.fetch>(async () =>
      new Response(JSON.stringify({
        event: { type: "run.stopped", runId: "run-1", sequence: 4, emittedAt },
      }), { status: 200, headers: { "Content-Type": "application/json" } }),
    );
    const event = await stopRun({ baseUrl: "http://127.0.0.1:8787/", runId: "run-1", fetch: fetchMock });
    expect(event).toEqual({ type: "run.stopped", runId: "run-1", sequence: 4 });
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe("http://127.0.0.1:8787/runs/run-1/stop");
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ method: "POST", body: "{}" });
  });

  it("ignores replayed events and reports sequence gaps", () => {
    const source = new FakeEventSource();
    const onEvent = vi.fn();
    const onGap = vi.fn();
    const onError = vi.fn();
    const disconnect = connectRunEventStream({
      baseUrl: "https://agent.example.com/api/",
      runId: "run-1",
      after: 1,
      onEvent,
      onGap,
      onError,
      eventSourceFactory: () => source,
    });

    source.emit("message", new MessageEvent("message", { data: JSON.stringify({
      type: "run.started", runId: "run-1", sequence: 1, emittedAt,
    }) }));
    source.emit("message", new MessageEvent("message", { data: JSON.stringify({
      type: "run.completed", runId: "run-1", sequence: 3, emittedAt,
    }) }));

    expect(onEvent).not.toHaveBeenCalled();
    expect(onGap).toHaveBeenCalledWith({ expected: 2, received: 3 });
    expect(onError).not.toHaveBeenCalled();

    disconnect();
    expect(source.closed).toBe(true);
  });

  it("reports the latest cursor whenever the native stream reconnects", () => {
    const source = new FakeEventSource();
    const onOpen = vi.fn();
    const onError = vi.fn();
    connectRunEventStream({
      baseUrl: "http://127.0.0.1:8787/",
      runId: "run-1",
      after: 1,
      onEvent() {},
      onGap() {},
      onError,
      onOpen,
      eventSourceFactory: () => source,
    });

    source.emit("open", new Event("open"));
    source.emit("message", new MessageEvent("message", { data: JSON.stringify({
      type: "log.appended",
      runId: "run-1",
      sequence: 2,
      emittedAt,
      source: "agent",
      level: "info",
      message: "Before restart",
    }) }));
    source.emit("error", new Event("error"));
    source.emit("open", new Event("open"));

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onOpen.mock.calls).toEqual([[1], [2]]);
  });

  it("replays a missing event after an SSE gap and resumes without duplicates", async () => {
    const sources: FakeEventSource[] = [];
    let replayCalls = 0;
    const fetchMock = vi.fn<typeof globalThis.fetch>(async (input) => {
      const after = Number(new URL(String(input)).searchParams.get("after"));
      replayCalls += 1;
      const events = replayCalls === 1 ? [] : [{
        type: "log.appended",
        runId: "run-1",
        sequence: 2,
        emittedAt,
        source: "agent",
        level: "info",
        message: "Recovered",
      }];
      return new Response(JSON.stringify({ runId: "run-1", after, events }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    const received: number[] = [];
    const states: string[] = [];
    const connection = connectRecoveringRunEventStream({
      baseUrl: "http://127.0.0.1:8787/",
      runId: "run-1",
      after: 1,
      fetch: fetchMock,
      onEvent: (event) => received.push(event.sequence),
      onState: (state) => states.push(state.status),
      eventSourceFactory: () => {
        const source = new FakeEventSource();
        sources.push(source);
        return source;
      },
    });
    await waitUntil(() => expect(sources).toHaveLength(1));
    sources[0]?.emit("open", new Event("open"));
    await connection.ready;
    sources[0]?.emit("message", new MessageEvent("message", { data: JSON.stringify({
      type: "run.completed", runId: "run-1", sequence: 3, emittedAt,
    }) }));

    await waitUntil(() => expect(sources).toHaveLength(2));
    expect(sources[0]?.closed).toBe(true);
    expect(received).toEqual([2]);
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain("after=1");
    sources[1]?.emit("open", new Event("open"));
    sources[1]?.emit("message", new MessageEvent("message", { data: JSON.stringify({
      type: "run.completed", runId: "run-1", sequence: 3, emittedAt,
    }) }));
    expect(received).toEqual([2, 3]);
    expect(connection.cursor()).toBe(3);
    expect(sources[1]?.closed).toBe(true);
    expect(states).toContain("replaying");
    expect(states).toContain("terminal");
  });

  it("bounds automatic replay retries and fails fast for an expired cursor", async () => {
    const callbacks: Array<() => void> = [];
    const delays: number[] = [];
    const states: string[] = [];
    const connection = connectRecoveringRunEventStream({
      baseUrl: "http://127.0.0.1:8787/",
      runId: "run-1",
      after: 1,
      fetch: async () => { throw new Error("offline"); },
      onEvent() {},
      onState: (state) => states.push(state.status),
      retryDelaysMs: [5, 10],
      schedule(callback, delay) {
        callbacks.push(callback);
        delays.push(delay);
        return callbacks.length;
      },
      cancelSchedule() {},
    });
    await waitUntil(() => expect(callbacks).toHaveLength(1));
    callbacks.shift()?.();
    await waitUntil(() => expect(callbacks).toHaveLength(1));
    callbacks.shift()?.();
    await expect(connection.ready).rejects.toThrow("offline");
    expect(delays).toEqual([5, 10]);
    expect(states.at(-1)).toBe("failed");

    let scheduled = false;
    const expired = connectRecoveringRunEventStream({
      baseUrl: "http://127.0.0.1:8787/",
      runId: "run-1",
      after: 4,
      fetch: async () => new Response("{}", { status: 410 }),
      onEvent() {},
      onState() {},
      schedule() {
        scheduled = true;
        return 1;
      },
    });
    await expect(expired.ready).rejects.toThrow("HTTP 410");
    expect(scheduled).toBe(false);
  });

  it("rejects insecure remote Agent URLs", async () => {
    await expect(fetchRunEvents({
      baseUrl: "http://agent.example.com/",
      runId: "run-1",
      after: 0,
    })).rejects.toThrow("HTTPS");
  });
});
