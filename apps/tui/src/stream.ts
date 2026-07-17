import { runEventSchema, type WireRunEvent } from "@gameforge/contracts";

export async function streamRunEvents(options: {
  baseUrl: string;
  runId: string;
  after: number;
  onEvent(event: WireRunEvent): void;
  signal?: AbortSignal;
  fetch?: typeof globalThis.fetch;
}): Promise<void> {
  const base = safeBaseUrl(options.baseUrl);
  const url = new URL(`runs/${encodeURIComponent(options.runId)}/stream`, base);
  url.searchParams.set("after", String(options.after));
  const response = await (options.fetch ?? globalThis.fetch)(url, {
    headers: { Accept: "text/event-stream" },
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  });
  if (!response.ok || response.body === null) throw new Error(`Run stream failed with HTTP ${response.status}.`);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let cursor = options.after;
  const emitBlock = (block: string): boolean => {
    const data = block.split("\n").filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart()).join("\n");
    if (data.length === 0) return false;
    const event = runEventSchema.parse(JSON.parse(data) as unknown);
    if (event.runId !== options.runId) throw new Error("Run stream emitted an event for another run.");
    if (event.sequence <= cursor) return false;
    if (event.sequence !== cursor + 1) throw new Error(`Run stream sequence gap: expected ${cursor + 1}, received ${event.sequence}.`);
    cursor = event.sequence;
    options.onEvent(event);
    return event.type === "run.completed" || event.type === "run.stopped" ||
      (event.type === "phase.failed" && !event.repairable);
  };
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    buffer += decoder.decode(chunk.value, { stream: true }).replaceAll("\r\n", "\n");
    let boundary = buffer.indexOf("\n\n");
    while (boundary >= 0) {
      const block = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      if (emitBlock(block)) {
        await reader.cancel();
        return;
      }
      boundary = buffer.indexOf("\n\n");
    }
  }
  buffer += decoder.decode();
  if (buffer.trim().length > 0 && emitBlock(buffer.replaceAll("\r\n", "\n"))) return;
  throw new Error("Run stream ended before a terminal event; reconnect from the last sequence.");
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
