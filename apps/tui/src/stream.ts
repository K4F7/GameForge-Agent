import { runEventSchema, type WireRunEvent } from "@gameforge/contracts";

export class RunStreamError extends Error {
  constructor(
    readonly code: "network" | "http" | "protocol" | "gap" | "eof",
    message: string,
    readonly statusCode?: number,
  ) {
    super(message);
    this.name = "RunStreamError";
  }
}

export async function streamRunEvents(options: {
  baseUrl: string;
  runId: string;
  after: number;
  onEvent(event: WireRunEvent): void;
  signal?: AbortSignal;
  fetch?: typeof globalThis.fetch;
  authToken?: string;
}): Promise<void> {
  const base = safeBaseUrl(options.baseUrl);
  const url = new URL(`runs/${encodeURIComponent(options.runId)}/stream`, base);
  url.searchParams.set("after", String(options.after));
  let response: Response;
  try {
    response = await (options.fetch ?? globalThis.fetch)(url, {
      headers: {
        Accept: "text/event-stream",
        ...(options.authToken === undefined ? {} : { Authorization: bearerHeader(options.authToken) }),
      },
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    });
  } catch (error) {
    if (options.signal?.aborted === true) throw error;
    throw new RunStreamError("network", "Run stream network request failed.");
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new RunStreamError("http", `Run stream failed with HTTP ${response.status}.`, response.status);
  }
  if (response.body === null) throw new RunStreamError("protocol", "Run stream response body was empty.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let cursor = options.after;
  const emitBlock = (block: string): boolean => {
    const data = block.split("\n").filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart()).join("\n");
    if (data.length === 0) return false;
    let input: unknown;
    try {
      input = JSON.parse(data) as unknown;
    } catch {
      throw new RunStreamError("protocol", "Run stream emitted invalid JSON.");
    }
    const parsed = runEventSchema.safeParse(input);
    if (!parsed.success) throw new RunStreamError("protocol", "Run stream emitted an invalid event.");
    const event = parsed.data;
    if (event.runId !== options.runId) throw new RunStreamError("protocol", "Run stream emitted an event for another run.");
    if (event.sequence <= cursor) return false;
    if (event.sequence !== cursor + 1) {
      throw new RunStreamError("gap", `Run stream sequence gap: expected ${cursor + 1}, received ${event.sequence}.`);
    }
    cursor = event.sequence;
    options.onEvent(event);
    return event.type === "run.completed" || event.type === "run.stopped" ||
      (event.type === "phase.failed" && !event.repairable);
  };
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      buffer += decoder.decode(chunk.value, { stream: true }).replaceAll("\r\n", "\n");
      let boundary = buffer.indexOf("\n\n");
      while (boundary >= 0) {
        const block = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        if (emitBlock(block)) {
          return;
        }
        boundary = buffer.indexOf("\n\n");
      }
    }
    buffer += decoder.decode();
    if (buffer.trim().length > 0 && emitBlock(buffer.replaceAll("\r\n", "\n"))) {
      return;
    }
    throw new RunStreamError("eof", "Run stream ended before a terminal event; reconnect from the last sequence.");
  } catch (error) {
    if (options.signal?.aborted === true || error instanceof RunStreamError) throw error;
    throw new RunStreamError("network", "Run stream connection failed while reading.");
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

function bearerHeader(value: string): string {
  const token = value.trim();
  if (token.length < 32 || token.length > 512 || /[\r\n]/.test(token)) {
    throw new Error("Run relay auth token must contain between 32 and 512 characters without newlines.");
  }
  return `Bearer ${token}`;
}

export function isTerminalRunEvent(event: WireRunEvent | undefined): boolean {
  return event?.type === "run.completed" || event?.type === "run.stopped" ||
    (event?.type === "phase.failed" && !event.repairable);
}

function safeBaseUrl(value: string): URL {
  const url = new URL(value);
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.username || url.password || url.search || url.hash ||
      (url.protocol !== "https:" && !(url.protocol === "http:" && loopback))) {
    throw new Error("Run relay URL must use HTTPS, or HTTP on loopback, without credentials or query data.");
  }
  if (!url.pathname.endsWith("/")) url.pathname += "/";
  return url;
}
