import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os"; import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { OpenCodeObserver, type OpenCodeEventFrame } from "./observer.js";
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
  it("rejects malformed local ordering", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "gameforge-observer-")); roots.push(root); const outputFile = path.join(root, "events.ndjson");
    await writeFile(outputFile, `${JSON.stringify({ sequence: 2, observerSessionId: "session-1", sseId: null })}\n`);
    const observer = new OpenCodeObserver({ outputFile, observerSessionId: "session-1", source: async () => (async function* () {})() });
    await expect(observer.observe(new AbortController().signal)).rejects.toThrow("not contiguous");
  });
});
