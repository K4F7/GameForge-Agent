const DEFAULT_RETRY_DELAYS_MS = [500, 1_000, 2_000, 4_000, 8_000] as const;

export type RunRecoveryEvent = { sequence: number; type: string; repairable?: boolean };

export type RunRecoveryState =
  | { status: "replaying"; cursor: number; attempt: number }
  | { status: "waiting"; cursor: number; attempt: number; delayMs: number; error: Error }
  | { status: "connected"; cursor: number; attempt: number }
  | { status: "terminal"; cursor: number; attempt: number }
  | { status: "failed"; cursor: number; attempt: number; error: Error };

export type RunRecoveryResult = { cursor: number; terminal: boolean; aborted: boolean };

export class RunRecoverySequenceError extends Error {
  constructor(readonly expected: number, readonly received: number) {
    super(`Run recovery expected sequence ${expected}, received ${received}.`);
    this.name = "RunRecoverySequenceError";
  }
}

export class RunRecoveryEofError extends Error {
  constructor() {
    super("Run stream returned without a terminal event.");
    this.name = "RunRecoveryEofError";
  }
}

export async function recoverRunEvents<Event extends RunRecoveryEvent>(options: {
  after: number;
  replay(after: number): Promise<ReadonlyArray<Event>>;
  stream(input: {
    after: number;
    onEvent(event: Event): void;
    onOpen(): void;
    signal?: AbortSignal;
  }): Promise<void>;
  onEvent(event: Event): void;
  onState?(state: RunRecoveryState): void;
  retry(error: Error): boolean;
  signal?: AbortSignal;
  retryDelaysMs?: ReadonlyArray<number>;
  replayPageSize?: number;
  maxReplayPages?: number;
  sleep?: (delayMs: number, signal?: AbortSignal) => Promise<void>;
}): Promise<RunRecoveryResult> {
  let cursor = nonnegativeInteger(options.after, "Run recovery cursor");
  const delays = [...(options.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS)];
  if (delays.some((delay) => !Number.isSafeInteger(delay) || delay < 0)) {
    throw new Error("Run recovery retry delays must be nonnegative safe integers.");
  }
  const pageSize = nonnegativeInteger(options.replayPageSize ?? 1_000, "Run replay page size");
  const maxPages = nonnegativeInteger(options.maxReplayPages ?? 11, "Run replay page limit");
  if (pageSize === 0 || maxPages === 0) throw new Error("Run replay page limits must be positive.");
  const sleep = options.sleep ?? abortableSleep;
  let terminal = false;
  let attempt = 0;

  const accept = (event: Event): void => {
    if (event.sequence <= cursor) return;
    if (terminal) throw new Error(`Run recovery received sequence ${event.sequence} after terminal event ${cursor}.`);
    if (event.sequence !== cursor + 1) throw new RunRecoverySequenceError(cursor + 1, event.sequence);
    options.onEvent(event);
    cursor = event.sequence;
    terminal = isTerminalRunEvent(event);
    attempt = 0;
  };

  while (true) {
    if (isAborted(options.signal)) return { cursor, terminal: false, aborted: true };
    try {
      options.onState?.({ status: "replaying", cursor, attempt });
      for (let page = 0; page < maxPages; page += 1) {
        const events = await options.replay(cursor);
        for (const event of events) accept(event);
        if (terminal || events.length < pageSize) break;
        if (page === maxPages - 1) throw new Error("Run event replay exceeded the retained event window.");
      }
      if (terminal) {
        options.onState?.({ status: "terminal", cursor, attempt });
        return { cursor, terminal: true, aborted: false };
      }
      await options.stream({
        after: cursor,
        onEvent: accept,
        onOpen() {
          options.onState?.({ status: "connected", cursor, attempt });
        },
        ...(options.signal === undefined ? {} : { signal: options.signal }),
      });
      if (isAborted(options.signal)) return { cursor, terminal: false, aborted: true };
      if (!terminal) throw new RunRecoveryEofError();
      options.onState?.({ status: "terminal", cursor, attempt });
      return { cursor, terminal: true, aborted: false };
    } catch (error) {
      if (isAborted(options.signal)) return { cursor, terminal: false, aborted: true };
      const failure = error instanceof Error ? error : new Error("Unknown run recovery failure.");
      const delay = delays[attempt];
      const retryable = options.retry(failure);
      if (!retryable || delay === undefined) {
        options.onState?.({ status: "failed", cursor, attempt, error: failure });
        if (delay === undefined && retryable) {
          throw new Error(`Run recovery exhausted at cursor ${cursor}: ${failure.message}`);
        }
        throw failure;
      }
      attempt += 1;
      options.onState?.({ status: "waiting", cursor, attempt, delayMs: delay, error: failure });
      await sleep(delay, options.signal);
    }
  }
}

export function isTerminalRunEvent(event: RunRecoveryEvent | undefined): boolean {
  return event?.type === "run.completed" || event?.type === "run.stopped" ||
    (event?.type === "phase.failed" && !event.repairable);
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

function nonnegativeInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${label} must be a nonnegative safe integer.`);
  return value;
}

function isAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true;
}
