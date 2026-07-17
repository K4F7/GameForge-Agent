import type { WireRunEvent } from "@gameforge/contracts";
import { RunRelayClientError, type RunRelayClient } from "@gameforge/run-relay/client";
import { isTerminalRunEvent, RunStreamError, streamRunEvents } from "./stream.js";

const DEFAULT_RETRY_DELAYS_MS = [500, 1_000, 2_000, 4_000, 8_000] as const;

export type WatchRetry = { attempt: number; delayMs: number; cursor: number; error: Error };

export async function watchRun(options: {
  client: Pick<RunRelayClient, "replayEvents">;
  baseUrl: string;
  runId: string;
  after: number;
  onEvent(event: WireRunEvent): void;
  onRetry?(retry: WatchRetry): void;
  signal?: AbortSignal;
  retryDelaysMs?: ReadonlyArray<number>;
  stream?: typeof streamRunEvents;
  sleep?: (delayMs: number, signal?: AbortSignal) => Promise<void>;
}): Promise<{ cursor: number; terminal: boolean; aborted: boolean }> {
  const delays = [...(options.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS)];
  if (delays.some((delay) => !Number.isSafeInteger(delay) || delay < 0)) {
    throw new Error("TUI watch retry delays must be nonnegative safe integers.");
  }
  const stream = options.stream ?? streamRunEvents;
  const sleep = options.sleep ?? abortableSleep;
  let cursor = options.after;
  let attempt = 0;
  let lastEvent: WireRunEvent | undefined;

  const accept = (event: WireRunEvent): void => {
    if (event.sequence <= cursor) return;
    if (event.sequence !== cursor + 1) {
      throw new RunStreamError("gap", `Run watch expected sequence ${cursor + 1}, received ${event.sequence}.`);
    }
    options.onEvent(event);
    cursor = event.sequence;
    lastEvent = event;
    attempt = 0;
  };

  while (true) {
    if (isAborted(options.signal)) return { cursor, terminal: false, aborted: true };
    try {
      const replay = await options.client.replayEvents({ runId: options.runId, after: cursor });
      for (const event of replay.events) accept(event);
      if (isTerminalRunEvent(replay.events.at(-1))) return { cursor, terminal: true, aborted: false };
      await stream({
        baseUrl: options.baseUrl,
        runId: options.runId,
        after: cursor,
        onEvent: accept,
        ...(options.signal === undefined ? {} : { signal: options.signal }),
      });
      if (!isTerminalRunEvent(lastEvent)) {
        throw new RunStreamError("eof", "Run stream returned without a terminal event.");
      }
      return { cursor, terminal: true, aborted: false };
    } catch (error) {
      if (isAborted(options.signal)) return { cursor, terminal: false, aborted: true };
      const failure = error instanceof Error ? error : new Error("Unknown TUI watch failure.");
      if (!isRetryable(failure)) throw failure;
      const delay = delays[attempt];
      if (delay === undefined) {
        throw new Error(`TUI watch recovery exhausted at cursor ${cursor}: ${failure.message}`);
      }
      attempt += 1;
      options.onRetry?.({ attempt, delayMs: delay, cursor, error: failure });
      await sleep(delay, options.signal);
    }
  }
}

function isAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true;
}

function isRetryable(error: Error): boolean {
  if (error instanceof RunStreamError) {
    return error.code === "network" || error.code === "eof" || error.code === "gap" ||
      (error.code === "http" && (error.statusCode === 429 || (error.statusCode ?? 0) >= 500));
  }
  if (error instanceof RunRelayClientError) {
    return error.code === "network" || error.code === "timeout" ||
      (error.code === "http" && (error.statusCode === 429 || (error.statusCode ?? 0) >= 500));
  }
  return false;
}

async function abortableSleep(delayMs: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted === true) return;
  await new Promise<void>((resolve) => {
    const timer = setTimeout(done, delayMs);
    const onAbort = (): void => done();
    function done(): void {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
