import { describe, expect, it, vi } from "vitest";
import { fetchProvider, ProviderRequestError } from "./transport.js";

describe("provider transport", () => {
  it("retries bounded 429 and 5xx responses before succeeding", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response("busy", { status: 429, headers: { "Retry-After": "0.01" } }))
      .mockResolvedValueOnce(new Response("server", { status: 503 }))
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));
    const delays: number[] = [];
    const response = await fetchProvider({
      provider: "Example",
      fetch: fetchMock,
      input: "https://example.test/api",
      init: { method: "GET" },
      timeoutMs: 1_000,
      retry: {
        maxAttempts: 3,
        baseDelayMs: 20,
        maxDelayMs: 100,
        random: () => 0,
        sleep: async (milliseconds) => { delays.push(milliseconds); },
      },
    });

    expect(await response.text()).toBe("ok");
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(delays).toEqual([10, 20]);
  });

  it("classifies credentials without retrying or exposing response bodies", async () => {
    const secret = "secret-token-value";
    const fetchMock = vi.fn(async () => new Response(secret, { status: 401 }));
    let caught: unknown;
    try {
      await fetchProvider({
        provider: "Example",
        fetch: fetchMock,
        input: "https://example.test/api",
        init: { headers: { Authorization: `Bearer ${secret}` } },
        timeoutMs: 1_000,
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(ProviderRequestError);
    expect(caught).toMatchObject({ kind: "authentication", retryable: false, attempts: 1, status: 401 });
    expect(String(caught)).not.toContain(secret);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("bounds network retries and returns structured terminal context", async () => {
    const fetchMock = vi.fn(async () => { throw new Error("socket contains credential"); });
    await expect(fetchProvider({
      provider: "Example",
      fetch: fetchMock,
      input: "https://example.test/api",
      init: {},
      timeoutMs: 1_000,
      retry: { maxAttempts: 2, baseDelayMs: 0, maxDelayMs: 0, sleep: async () => undefined },
    })).rejects.toMatchObject({ kind: "network", retryable: true, attempts: 2 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("cancels terminal HTTP response bodies", async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      pull() { /* keep the error body unread */ },
      cancel() { cancelled = true; },
    });
    await expect(fetchProvider({
      provider: "Example",
      fetch: async () => new Response(body, { status: 403 }),
      input: "https://example.test/api",
      init: {},
      timeoutMs: 1_000,
    })).rejects.toMatchObject({ kind: "authorization", attempts: 1 });
    expect(cancelled).toBe(true);
  });

  it("preserves caller cancellation without retrying", async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      controller.abort();
      throw init?.signal?.reason ?? new Error("aborted");
    });
    await expect(fetchProvider({
      provider: "Example",
      fetch: fetchMock,
      input: "https://example.test/api",
      init: { signal: controller.signal },
      timeoutMs: 1_000,
    })).rejects.toMatchObject({ kind: "cancelled", retryable: false, attempts: 1 });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("rejects and discards a successful response returned after caller cancellation", async () => {
    const controller = new AbortController();
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      pull() { /* keep the late success body unread */ },
      cancel() { cancelled = true; },
    });
    const fetchMock = vi.fn(async () => {
      controller.abort();
      return new Response(body, { status: 200 });
    });

    await expect(fetchProvider({
      provider: "Example",
      fetch: fetchMock,
      input: "https://example.test/api",
      init: { signal: controller.signal },
      timeoutMs: 1_000,
    })).rejects.toMatchObject({ kind: "cancelled", retryable: false, attempts: 1 });
    expect(cancelled).toBe(true);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("cancels immediately while waiting to retry", async () => {
    const controller = new AbortController();
    let requestCount = 0;
    const fetchMock = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      requestCount += 1;
      if (requestCount === 1) return new Response("busy", { status: 503 });
      throw init?.signal?.reason ?? new Error("aborted");
    });
    let releaseSleep = (): void => undefined;
    let markSleepStarted = (): void => undefined;
    const sleepStarted = new Promise<void>((resolve) => { markSleepStarted = resolve; });
    const pending = fetchProvider({
      provider: "Example",
      fetch: fetchMock,
      input: "https://example.test/api",
      init: { signal: controller.signal },
      timeoutMs: 1_000,
      retry: {
        maxAttempts: 2,
        baseDelayMs: 100,
        maxDelayMs: 100,
        sleep: async () => {
          markSleepStarted();
          await new Promise<void>((resolve) => { releaseSleep = resolve; });
        },
      },
    });
    const outcomePromise = pending.then(
      () => ({ status: "resolved" as const }),
      (error: unknown) => ({ status: "rejected" as const, error }),
    );
    await sleepStarted;

    controller.abort();
    const outcome = await Promise.race([
      outcomePromise,
      new Promise<{ status: "timed-out" }>((resolve) => setTimeout(() => resolve({ status: "timed-out" }), 50)),
    ]);
    releaseSleep();

    expect(outcome).toMatchObject({ status: "rejected", error: { kind: "cancelled", attempts: 1 } });
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
