import { describe, expect, it, vi } from "vitest";
import { recoverRunEvents, RunRecoveryEofError, RunRecoverySequenceError } from "./recovery.js";

type Event = { type: "run.started" | "log.appended" | "run.completed"; sequence: number };

describe("shared run recovery", () => {
  it("replays the missing suffix after a stream gap and delivers each event once", async () => {
    const replays: number[] = [];
    const received: number[] = [];
    let streamAttempt = 0;
    const result = await recoverRunEvents<Event>({
      after: 0,
      replay: async (after) => {
        replays.push(after);
        return after === 0 ? [{ type: "run.started", sequence: 1 }] : [
          { type: "log.appended", sequence: 2 },
          { type: "run.completed", sequence: 3 },
        ];
      },
      async stream({ onEvent, onOpen }) {
        onOpen();
        streamAttempt += 1;
        if (streamAttempt === 1) throw new RunRecoverySequenceError(2, 3);
        onEvent({ type: "run.completed", sequence: 3 });
      },
      onEvent: (event) => received.push(event.sequence),
      retry: (error) => error instanceof RunRecoverySequenceError,
      retryDelaysMs: [0],
      sleep: async () => undefined,
    });

    expect(replays).toEqual([0, 1]);
    expect(received).toEqual([1, 2, 3]);
    expect(result).toEqual({ cursor: 3, terminal: true, aborted: false });
  });

  it("bounds repeated opened-stream EOF failures until a new event advances the cursor", async () => {
    const stream = vi.fn(async ({ onOpen }: { onOpen(): void }) => {
      onOpen();
      throw new RunRecoveryEofError();
    });
    const retry = vi.fn(() => true);
    await expect(recoverRunEvents<Event>({
      after: 4,
      replay: async () => [],
      stream,
      onEvent() {},
      retry,
      retryDelaysMs: [0, 0],
      sleep: async () => undefined,
    })).rejects.toThrow("exhausted at cursor 4");
    expect(stream).toHaveBeenCalledTimes(3);
    expect(retry).toHaveBeenCalledTimes(3);
  });

  it("fails immediately when the caller classifies a replay error as fatal", async () => {
    let streamed = false;
    await expect(recoverRunEvents<Event>({
      after: 2,
      replay: async () => { throw new Error("cursor expired"); },
      stream: async () => { streamed = true; },
      onEvent() {},
      retry: () => false,
      retryDelaysMs: [0],
    })).rejects.toThrow("cursor expired");
    expect(streamed).toBe(false);
  });

  it("stops without retry when aborted during backoff", async () => {
    const controller = new AbortController();
    const result = await recoverRunEvents<Event>({
      after: 0,
      replay: async () => { throw new Error("offline"); },
      stream: async () => undefined,
      onEvent() {},
      retry: () => true,
      signal: controller.signal,
      retryDelaysMs: [5],
      sleep: async () => controller.abort(),
    });
    expect(result).toEqual({ cursor: 0, terminal: false, aborted: true });
  });
});
