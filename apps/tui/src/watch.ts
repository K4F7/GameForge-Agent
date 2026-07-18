import type { WireRunEvent } from "@gameforge/contracts";
import { RunRelayClientError, type RunRelayClient } from "@gameforge/run-relay/client";
import {
  recoverRunEvents,
  RunRecoveryEofError,
  RunRecoverySequenceError,
} from "@gameforge/run-relay/recovery";
import { RunStreamError, streamRunEvents } from "./stream.js";

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
  authToken?: string;
  stream?: typeof streamRunEvents;
  sleep?: (delayMs: number, signal?: AbortSignal) => Promise<void>;
}): Promise<{ cursor: number; terminal: boolean; aborted: boolean }> {
  const stream = options.stream ?? streamRunEvents;
  return recoverRunEvents({
    after: options.after,
    replay: async (after) => (await options.client.replayEvents({ runId: options.runId, after })).events,
    stream: async ({ after, onEvent, onOpen, signal }) => {
      onOpen();
      await stream({
        baseUrl: options.baseUrl,
        runId: options.runId,
        after,
        onEvent,
        ...(options.authToken === undefined ? {} : { authToken: options.authToken }),
        ...(signal === undefined ? {} : { signal }),
      });
    },
    onEvent: options.onEvent,
    retry: isRetryable,
    onState(state) {
      if (state.status === "waiting") {
        options.onRetry?.({ attempt: state.attempt, delayMs: state.delayMs, cursor: state.cursor, error: state.error });
      }
    },
    ...(options.signal === undefined ? {} : { signal: options.signal }),
    ...(options.retryDelaysMs === undefined ? {} : { retryDelaysMs: options.retryDelaysMs }),
    ...(options.sleep === undefined ? {} : { sleep: options.sleep }),
  });
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
  if (error instanceof RunRecoveryEofError || error instanceof RunRecoverySequenceError) return true;
  return false;
}
