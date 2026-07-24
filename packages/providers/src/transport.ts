import type { FetchLike } from "./seedream.js";

export type ProviderErrorKind =
  | "authentication"
  | "authorization"
  | "rate-limit"
  | "quota"
  | "cancelled"
  | "timeout"
  | "network"
  | "server"
  | "request";

export class ProviderRequestError extends Error {
  readonly provider: string;
  readonly kind: ProviderErrorKind;
  readonly retryable: boolean;
  readonly attempts: number;
  readonly status?: number;

  constructor(options: {
    provider: string;
    kind: ProviderErrorKind;
    message: string;
    retryable: boolean;
    attempts: number;
    status?: number;
  }) {
    super(options.message);
    this.name = "ProviderRequestError";
    this.provider = options.provider;
    this.kind = options.kind;
    this.retryable = options.retryable;
    this.attempts = options.attempts;
    if (options.status !== undefined) this.status = options.status;
  }
}

export type ProviderRetryOptions = {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  sleep?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
  random?: () => number;
};

export async function fetchProvider(options: {
  provider: string;
  fetch: FetchLike;
  input: string | URL | Request;
  init: RequestInit;
  timeoutMs: number;
  retry?: ProviderRetryOptions;
}): Promise<Response> {
  const policy = retryPolicy(options.retry);
  let lastError: ProviderRequestError | undefined;
  for (let attempt = 1; attempt <= policy.maxAttempts; attempt += 1) {
    const timeoutSignal = AbortSignal.timeout(options.timeoutMs);
    const callerSignal = options.init.signal ?? undefined;
    const signal = callerSignal === undefined
      ? timeoutSignal
      : AbortSignal.any([callerSignal, timeoutSignal]);
    try {
      const response = await options.fetch(options.input, { ...options.init, signal });
      if (callerSignal?.aborted === true || timeoutSignal.aborted) {
        await discardResponse(response);
        throw networkError(options.provider, callerSignal?.aborted === true, timeoutSignal.aborted, attempt);
      }
      if (response.ok) return response;
      const classified = classifyHttp(options.provider, response.status, attempt);
      await discardResponse(response);
      if (!classified.retryable || attempt === policy.maxAttempts) throw classified;
      lastError = classified;
      await waitForRetry(options.provider, attempt, retryDelay(response, attempt, policy), policy.sleep, callerSignal);
    } catch (error) {
      const classified = error instanceof ProviderRequestError
        ? error
        : networkError(options.provider, callerSignal?.aborted === true, timeoutSignal.aborted, attempt);
      if (!classified.retryable || attempt === policy.maxAttempts) throw classified;
      lastError = classified;
      await waitForRetry(options.provider, attempt, backoffDelay(attempt, policy), policy.sleep, callerSignal);
    }
  }
  throw lastError ?? new Error(`${options.provider} request failed.`);
}

function classifyHttp(provider: string, status: number, attempts: number): ProviderRequestError {
  const kind: ProviderErrorKind = status === 401
    ? "authentication"
    : status === 403
      ? "authorization"
      : status === 429
        ? "rate-limit"
        : status === 402
          ? "quota"
          : status >= 500
            ? "server"
            : "request";
  const retryable = status === 408 || status === 429 || status >= 500;
  return new ProviderRequestError({
    provider,
    kind,
    retryable,
    attempts,
    status,
    message: `${provider} request failed with HTTP ${status} (${kind}) after ${attempts} attempt${attempts === 1 ? "" : "s"}.`,
  });
}

function networkError(provider: string, cancelled: boolean, timedOut: boolean, attempts: number): ProviderRequestError {
  return new ProviderRequestError({
    provider,
    kind: cancelled ? "cancelled" : timedOut ? "timeout" : "network",
    retryable: !cancelled,
    attempts,
    message: `${provider} ${cancelled ? "request was cancelled" : timedOut ? "request timed out" : "network request failed"} after ${attempts} attempt${attempts === 1 ? "" : "s"}.`,
  });
}

function retryPolicy(options: ProviderRetryOptions | undefined) {
  const maxAttempts = options?.maxAttempts ?? 3;
  const baseDelayMs = options?.baseDelayMs ?? 250;
  const maxDelayMs = options?.maxDelayMs ?? 5_000;
  if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 6) {
    throw new Error("Provider maxAttempts must be an integer between 1 and 6.");
  }
  if (!Number.isSafeInteger(baseDelayMs) || baseDelayMs < 0 || baseDelayMs > 60_000) {
    throw new Error("Provider baseDelayMs must be an integer between 0 and 60000.");
  }
  if (!Number.isSafeInteger(maxDelayMs) || maxDelayMs < baseDelayMs || maxDelayMs > 60_000) {
    throw new Error("Provider maxDelayMs must be an integer between baseDelayMs and 60000.");
  }
  return {
    maxAttempts,
    baseDelayMs,
    maxDelayMs,
    sleep: options?.sleep ?? abortableSleep,
    random: options?.random ?? Math.random,
  };
}

async function waitForRetry(
  provider: string,
  attempt: number,
  milliseconds: number,
  sleep: (milliseconds: number, signal?: AbortSignal) => Promise<void>,
  callerSignal: AbortSignal | undefined,
): Promise<void> {
  if (callerSignal?.aborted === true) throw networkError(provider, true, false, attempt);
  if (callerSignal === undefined) {
    await sleep(milliseconds);
    return;
  }
  let onAbort = (): void => undefined;
  const cancelled = new Promise<never>((_, reject) => {
    onAbort = () => reject(networkError(provider, true, false, attempt));
    callerSignal.addEventListener("abort", onAbort, { once: true });
  });
  try {
    await Promise.race([sleep(milliseconds, callerSignal), cancelled]);
  } finally {
    callerSignal.removeEventListener("abort", onAbort);
  }
  if (callerSignal.aborted) throw networkError(provider, true, false, attempt);
}

function abortableSleep(milliseconds: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted === true) { reject(signal.reason); return; }
    const onAbort = (): void => { clearTimeout(timer); reject(signal?.reason); };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, milliseconds);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function retryDelay(response: Response, attempt: number, policy: ReturnType<typeof retryPolicy>): number {
  const retryAfter = parseRetryAfter(response.headers.get("retry-after"));
  return retryAfter === undefined ? backoffDelay(attempt, policy) : Math.min(retryAfter, policy.maxDelayMs);
}

function parseRetryAfter(value: string | null): number | undefined {
  if (value === null) return undefined;
  const seconds = Number(value.trim());
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1_000);
  const date = Date.parse(value);
  if (!Number.isFinite(date)) return undefined;
  return Math.max(0, date - Date.now());
}

function backoffDelay(attempt: number, policy: ReturnType<typeof retryPolicy>): number {
  const ceiling = Math.min(policy.maxDelayMs, policy.baseDelayMs * (2 ** (attempt - 1)));
  return Math.round(ceiling * (0.5 + policy.random() * 0.5));
}

async function discardResponse(response: Response): Promise<void> {
  if (response.body !== null) await response.body.cancel().catch(() => undefined);
}
