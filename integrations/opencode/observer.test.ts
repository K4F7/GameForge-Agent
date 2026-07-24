import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { appendFile, mkdtemp, readFile, rm, unlink, writeFile } from "node:fs/promises";
import os from "node:os"; import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createSdkEventSource, OpenCodeObserver, type OpenCodeEventFrame } from "./observer.js";
const roots: string[] = []; afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });
function frame(id: string, type = "session.created"): OpenCodeEventFrame { return { sseId: id, data: { directory: "D:/repo", payload: { type, properties: { id } } } as never }; }
describe("OpenCodeObserver", () => {
  it("preserves raw events, ordering, correlation, and after replay", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "gameforge-observer-")); roots.push(root);
    const observer = new OpenCodeObserver({ outputFile: path.join(root, "events.ndjson"), observerSessionId: "session-1", runId: "run-1",
      source: async () => (async function* () { yield frame("evt-1"); yield frame("evt-2", "session.idle"); })(), now: () => "2026-07-23T00:00:00.000Z" });
    await observer.observe(new AbortController().signal); const events = await observer.replay(1);
    expect(events).toHaveLength(1); expect(events[0]).toMatchObject({ sequence: 2, sseId: "evt-2", type: "session.idle", observerSessionId: "session-1", runId: "run-1" });
    expect(events[0]?.raw.payload.properties).toEqual({ id: "evt-2" });
  });
  it("resumes the cursor and drops a replayed SSE id after reconnect", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "gameforge-observer-")); roots.push(root); const outputFile = path.join(root, "events.ndjson");
    await new OpenCodeObserver({ outputFile, observerSessionId: "session-1", source: async () => (async function* () { yield frame("evt-1"); })() }).observe(new AbortController().signal);
    const observer = new OpenCodeObserver({ outputFile, observerSessionId: "session-1", source: async () => (async function* () { yield frame("evt-1"); yield frame("evt-2"); })() });
    await observer.observe(new AbortController().signal);
    expect((await observer.replay(0)).map(({ sequence, sseId }) => [sequence, sseId])).toEqual([[1, "evt-1"], [2, "evt-2"]]);
  });
  it("does not deduplicate events whose SSE id is empty", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "gameforge-observer-")); roots.push(root);
    const observer = new OpenCodeObserver({ outputFile: path.join(root, "events.ndjson"), observerSessionId: "session-empty-id",
      source: async () => (async function* () { yield frame(""); yield frame("", "session.idle"); })() });

    await observer.observe(new AbortController().signal);

    expect((await observer.replay()).map(({ sequence, sseId, type }) => [sequence, sseId, type])).toEqual([
      [1, null, "session.created"],
      [2, null, "session.idle"],
    ]);
  });
  it("reconnects the official SSE stream with Last-Event-ID after a transport failure", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "gameforge-observer-")); roots.push(root);
    const controller = new AbortController();
    const headers: Array<string | undefined> = [];
    let requests = 0;
    const server = createServer((request, response) => {
      if (request.url !== "/global/event") { response.writeHead(404); response.end(); return; }
      requests += 1; headers.push(headerValue(request.headers["last-event-id"]));
      response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
      const id = requests === 1 ? "evt-1" : "evt-2";
      response.write(`id: ${id}\nretry: 10\ndata: ${JSON.stringify({ directory: "D:/repo", payload: { type: "session.created", properties: { id } } })}\n\n`);
      if (requests === 1) setTimeout(() => response.socket?.destroy(), 25);
      else setTimeout(() => controller.abort(), 25);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const address = server.address() as AddressInfo;
      const source = createSdkEventSource({ baseUrl: `http://127.0.0.1:${address.port}`, directory: root });
      const observer = new OpenCodeObserver({ outputFile: path.join(root, "events.ndjson"), observerSessionId: "session-http", source });
      await observer.observe(controller.signal);

      expect(headers).toEqual([undefined, "evt-1"]);
      expect((await observer.replay()).map((event) => event.sseId)).toEqual(["evt-1", "evt-2"]);
    } finally { controller.abort(); await new Promise<void>((resolve) => server.close(() => resolve())); }
  }, 10_000);
  it("retries the official SSE subscription when connection setup is interrupted", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "gameforge-observer-")); roots.push(root);
    const controller = new AbortController();
    let requests = 0;
    const server = createServer((request, response) => {
      if (request.url !== "/global/event") { response.writeHead(404); response.end(); return; }
      requests += 1;
      if (requests === 1) { request.socket.destroy(); return; }
      response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
      response.write(`id: evt-after-setup-failure\nretry: 10\ndata: ${JSON.stringify({ directory: "D:/repo", payload: { type: "session.created", properties: { recovered: true } } })}\n\n`);
      setTimeout(() => controller.abort(), 25);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const address = server.address() as AddressInfo;
      const source = createSdkEventSource({ baseUrl: `http://127.0.0.1:${address.port}`, directory: root });
      const observer = new OpenCodeObserver({ outputFile: path.join(root, "events.ndjson"), observerSessionId: "session-setup-retry", source });
      await observer.observe(controller.signal);

      expect(requests).toBe(2);
      expect((await observer.replay()).map((event) => event.sseId)).toEqual(["evt-after-setup-failure"]);
    } finally { controller.abort(); await new Promise<void>((resolve) => server.close(() => resolve())); }
  }, 10_000);
  it("retries the official SSE subscription when the initial connection is refused", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "gameforge-observer-")); roots.push(root);
    const controller = new AbortController();
    let requests = 0;
    const server = createServer((request, response) => {
      if (request.url !== "/global/event") { response.writeHead(404); response.end(); return; }
      requests += 1;
      response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
      response.write(`id: evt-after-refusal\nretry: 10\ndata: ${JSON.stringify({ directory: "D:/repo", payload: { type: "session.created", properties: { recovered: true } } })}\n\n`);
      setTimeout(() => controller.abort(), 25);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address() as AddressInfo;
    await new Promise<void>((resolve) => server.close(() => resolve()));
    const source = createSdkEventSource({ baseUrl: `http://127.0.0.1:${address.port}`, directory: root });
    const observer = new OpenCodeObserver({ outputFile: path.join(root, "events.ndjson"), observerSessionId: "session-refused-retry", source });
    const observing = observer.observe(controller.signal);
    await new Promise<void>((resolve) => setTimeout(() => server.listen(address.port, "127.0.0.1", resolve), 100));
    try {
      await observing;
      expect(requests).toBe(1);
      expect((await observer.replay()).map((event) => event.sseId)).toEqual(["evt-after-refusal"]);
    } finally { controller.abort(); await new Promise<void>((resolve) => server.close(() => resolve())); }
  }, 10_000);
  it("resubscribes with Last-Event-ID after a normal SSE end", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "gameforge-observer-")); roots.push(root);
    const controller = new AbortController();
    const headers: Array<string | undefined> = [];
    const server = createServer((request, response) => {
      if (request.url !== "/global/event") { response.writeHead(404); response.end(); return; }
      headers.push(headerValue(request.headers["last-event-id"]));
      response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
      const id = headers.length === 1 ? "evt-normal-1" : "evt-normal-2";
      response.write(`id: ${id}\nretry: 10\ndata: ${JSON.stringify({ directory: "D:/repo", payload: { type: "session.created", properties: { id } } })}\n\n`);
      if (headers.length === 1) response.end();
      else setTimeout(() => controller.abort(), 25);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const address = server.address() as AddressInfo;
      const source = createSdkEventSource({ baseUrl: `http://127.0.0.1:${address.port}`, directory: root });
      const observer = new OpenCodeObserver({ outputFile: path.join(root, "events.ndjson"), observerSessionId: "session-normal-end", source });
      await observer.observe(controller.signal);

      expect(headers).toEqual([undefined, "evt-normal-1"]);
      expect((await observer.replay()).map((event) => event.sseId)).toEqual(["evt-normal-1", "evt-normal-2"]);
    } finally { controller.abort(); await new Promise<void>((resolve) => server.close(() => resolve())); }
  }, 10_000);
  it("clears Last-Event-ID after the server sends an empty SSE id", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "gameforge-observer-")); roots.push(root);
    const controller = new AbortController();
    const headers: Array<string | undefined> = [];
    const server = createServer((request, response) => {
      if (request.url !== "/global/event") { response.writeHead(404); response.end(); return; }
      headers.push(headerValue(request.headers["last-event-id"]));
      response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
      if (headers.length === 1) {
        response.write(`id: evt-before-reset\ndata: ${JSON.stringify({ directory: "D:/repo", payload: { type: "session.created", properties: {} } })}\n\n`);
        response.write(`id:\ndata: ${JSON.stringify({ directory: "D:/repo", payload: { type: "session.updated", properties: {} } })}\n\n`);
        response.end();
      } else {
        response.write(`id: evt-after-reset\ndata: ${JSON.stringify({ directory: "D:/repo", payload: { type: "session.idle", properties: {} } })}\n\n`);
        setTimeout(() => controller.abort(), 25);
      }
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const address = server.address() as AddressInfo;
      const source = createSdkEventSource({ baseUrl: `http://127.0.0.1:${address.port}`, directory: root });
      const observer = new OpenCodeObserver({ outputFile: path.join(root, "events.ndjson"), observerSessionId: "session-id-reset", source });
      await observer.observe(controller.signal);

      expect(headers).toEqual([undefined, undefined]);
      expect((await observer.replay()).map((event) => event.sseId)).toEqual(["evt-before-reset", null, "evt-after-reset"]);
    } finally { controller.abort(); await new Promise<void>((resolve) => server.close(() => resolve())); }
  }, 10_000);
  it("keeps a live writer lock and recovers it after the writer is no longer running", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "gameforge-observer-")); roots.push(root); const outputFile = path.join(root, "events.ndjson");
    const observer = new OpenCodeObserver({ outputFile, observerSessionId: "session-1", source: async () => (async function* () {})() });
    await writeFile(`${outputFile}.lock`, "invalid lock metadata\n");
    await expect(observer.observe(new AbortController().signal)).rejects.toThrow("active writer");
    await writeFile(`${outputFile}.lock`, `${JSON.stringify({ createdAt: "2026-07-24T00:00:00.000Z" })}\n`);
    await expect(observer.observe(new AbortController().signal)).rejects.toThrow("active writer");
    await writeFile(`${outputFile}.lock`, `${JSON.stringify({ pid: process.pid, createdAt: "2026-07-24T00:00:00.000Z" })}\n`);
    await expect(observer.observe(new AbortController().signal)).rejects.toThrow("active writer");
    await writeFile(`${outputFile}.lock`, `${JSON.stringify({ pid: 2_147_483_647, createdAt: "2026-07-24T00:00:00.000Z" })}\n`);
    await expect(observer.observe(new AbortController().signal)).resolves.toBeUndefined();
  });
  it("does not recover a writer lock owned by another host", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "gameforge-observer-")); roots.push(root); const outputFile = path.join(root, "events.ndjson");
    const observer = new OpenCodeObserver({ outputFile, observerSessionId: "session-remote-lock", source: async () => (async function* () {})() });
    await writeFile(`${outputFile}.lock`, `${JSON.stringify({ pid: 2_147_483_647, hostname: "remote-host.invalid", createdAt: "2026-07-24T00:00:00.000Z", token: "remote-writer" })}\n`);

    await expect(observer.observe(new AbortController().signal)).rejects.toThrow("active writer");
  });
  it("does not remove a replacement writer lock when the old writer exits", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "gameforge-observer-")); roots.push(root); const outputFile = path.join(root, "events.ndjson");
    const lockFile = `${outputFile}.lock`;
    const replacement = `${JSON.stringify({ pid: process.pid, createdAt: "2026-07-24T00:00:00.000Z", token: "replacement-writer" })}\n`;
    const observer = new OpenCodeObserver({ outputFile, observerSessionId: "session-lock-replacement", source: async () => (async function* () {
      await unlink(lockFile);
      await writeFile(lockFile, replacement, "utf8");
      yield frame("evt-1");
    })() });

    await observer.observe(new AbortController().signal);

    await expect(readFile(lockFile, "utf8")).resolves.toBe(replacement);
  });
  it("rejects malformed local ordering", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "gameforge-observer-")); roots.push(root); const outputFile = path.join(root, "events.ndjson");
    await writeFile(outputFile, `${JSON.stringify({ sequence: 2, observerSessionId: "session-1", sseId: null })}\n`);
    const observer = new OpenCodeObserver({ outputFile, observerSessionId: "session-1", source: async () => (async function* () {})() });
    await expect(observer.observe(new AbortController().signal)).rejects.toThrow("not contiguous");
  });
  it("recovers an incomplete final evidence record left by an interrupted writer", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "gameforge-observer-")); roots.push(root); const outputFile = path.join(root, "events.ndjson");
    await new OpenCodeObserver({ outputFile, observerSessionId: "session-1", source: async () => (async function* () { yield frame("evt-1"); })() }).observe(new AbortController().signal);
    await appendFile(outputFile, '{"evidenceVersion":"1.0","sequence":2', "utf8");
    const observer = new OpenCodeObserver({ outputFile, observerSessionId: "session-1", source: async () => (async function* () { yield frame("evt-2"); })() });

    await observer.observe(new AbortController().signal);

    expect((await observer.replay()).map(({ sequence, sseId }) => [sequence, sseId])).toEqual([[1, "evt-1"], [2, "evt-2"]]);
  });
  it("replays complete evidence before an incomplete final record", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "gameforge-observer-")); roots.push(root); const outputFile = path.join(root, "events.ndjson");
    const observer = new OpenCodeObserver({ outputFile, observerSessionId: "session-1", source: async () => (async function* () { yield frame("evt-1"); })() });
    await observer.observe(new AbortController().signal);
    await appendFile(outputFile, '{"evidenceVersion":"1.0","sequence":2', "utf8");

    expect((await observer.replay()).map(({ sequence, sseId }) => [sequence, sseId])).toEqual([[1, "evt-1"]]);
  });
  it("preserves the exact bytes before an incomplete tail when earlier evidence is invalid UTF-8", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "gameforge-observer-")); roots.push(root); const outputFile = path.join(root, "events.ndjson");
    const prefix = Buffer.from([0xff, 0x0a]);
    await writeFile(outputFile, Buffer.concat([prefix, Buffer.from('{"evidenceVersion":"1.0"', "utf8")]));
    const observer = new OpenCodeObserver({ outputFile, observerSessionId: "session-invalid-utf8", source: async () => (async function* () {})() });

    await expect(observer.observe(new AbortController().signal)).rejects.toThrow();

    await expect(readFile(outputFile)).resolves.toEqual(prefix);
  });
  it("rejects resuming evidence with a different run", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "gameforge-observer-")); roots.push(root); const outputFile = path.join(root, "events.ndjson");
    await new OpenCodeObserver({ outputFile, observerSessionId: "session-1", runId: "run-1", source: async () => (async function* () { yield frame("evt-1"); })() }).observe(new AbortController().signal);
    const observer = new OpenCodeObserver({ outputFile, observerSessionId: "session-1", runId: "run-2", source: async () => (async function* () {})() });
    await expect(observer.observe(new AbortController().signal)).rejects.toThrow("another run");
  });
});

function headerValue(value: string | string[] | undefined): string | undefined { return Array.isArray(value) ? value[0] : value; }
