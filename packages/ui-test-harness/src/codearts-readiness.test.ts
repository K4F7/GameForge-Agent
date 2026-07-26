import { describe, expect, it } from "vitest";
import { correlateAfterCodeArtsReady } from "./codearts-readiness.js";
import type { CodeArtsTuiDriver, EvidenceSink, HarnessSession } from "./contracts.js";

describe("correlateAfterCodeArtsReady", () => {
  it("starts and stops the real TUI before invoking Authority correlation", async () => {
    const calls: string[] = [];
    const session: HarnessSession = { sessionId: "preflight-session", startedAt: "2026-07-27T00:00:00.000Z", mode: "headed/watch", tier: "readiness" };
    const tui = {
      kind: "codearts-original-tui" as const,
      subscribeOutput() { return () => { calls.push("unsubscribe"); }; },
      async start() { calls.push("tui:start"); return { sessionId: session.sessionId, status: "running" as const, columns: 120, rows: 36, screen: "Ask anything", outputSequence: 1, lastChangedAt: session.startedAt }; },
      async read() { throw new Error("unused"); }, async sendText() {}, async sendKey() {}, async resize() {},
      async stop() { calls.push("tui:stop"); },
    } satisfies CodeArtsTuiDriver;
    const evidence = { async recordTuiOutput() {}, async recordTuiSnapshot() { calls.push("evidence:snapshot"); } } as unknown as EvidenceSink;

    const result = await correlateAfterCodeArtsReady({ tui, evidence, session, terminal: { columns: 120, rows: 36 }, correlate: async () => { calls.push("authority:create"); return "task"; } });

    expect(result).toBe("task");
    expect(calls).toEqual(["tui:start", "evidence:snapshot", "authority:create", "unsubscribe", "tui:stop"]);
  });

  it("does not invoke Authority correlation when the CodeArts TUI is not ready", async () => {
    let correlated = false;
    const session: HarnessSession = { sessionId: "unauthorized-session", startedAt: "2026-07-27T00:00:00.000Z", mode: "headed/watch", tier: "readiness" };
    const tui = {
      kind: "codearts-original-tui" as const,
      subscribeOutput() { return () => undefined; },
      async start(): Promise<never> { throw new Error("CodeArts authorization is required or expired."); },
      async read(): Promise<never> { throw new Error("unused"); }, async sendText() {}, async sendKey() {}, async resize() {}, async stop() {},
    } satisfies CodeArtsTuiDriver;
    const evidence = { async recordTuiOutput() {}, async recordTuiSnapshot() {} } as unknown as EvidenceSink;

    await expect(correlateAfterCodeArtsReady({
      tui, evidence, session, terminal: { columns: 120, rows: 36 }, correlate: async () => { correlated = true; return "task"; },
    })).rejects.toThrow(/authorization/i);
    expect(correlated).toBe(false);
  });

  it("records startup output frames serially in delivery order", async () => {
    const session: HarnessSession = { sessionId: "ordered-output", startedAt: "2026-07-27T00:00:00.000Z", mode: "headed/watch", tier: "readiness" };
    let listener: ((frame: { sessionId: string; sequence: number; data: string }) => void) | undefined;
    const tui = {
      kind: "codearts-original-tui" as const,
      subscribeOutput(value: typeof listener) { listener = value; return () => { listener = undefined; }; },
      async start() { listener?.({ sessionId: session.sessionId, sequence: 1, data: "first" }); listener?.({ sessionId: session.sessionId, sequence: 2, data: "second" }); return { sessionId: session.sessionId, status: "running" as const, columns: 120, rows: 36, screen: "Ask anything", outputSequence: 2, lastChangedAt: session.startedAt }; },
      async read() { throw new Error("unused"); }, async sendText() {}, async sendKey() {}, async resize() {}, async stop() {},
    } satisfies CodeArtsTuiDriver;
    let writing = false; const order: number[] = [];
    const evidence = { async recordTuiOutput(frame: { sequence: number }) { if (writing) throw new Error("concurrent output write"); writing = true; await new Promise((resolve) => setTimeout(resolve, frame.sequence === 1 ? 10 : 0)); order.push(frame.sequence); writing = false; }, async recordTuiSnapshot() {} } as unknown as EvidenceSink;

    await expect(correlateAfterCodeArtsReady({ tui, evidence, session, terminal: { columns: 120, rows: 36 }, correlate: async () => "task" })).resolves.toBe("task");
    expect(order).toEqual([1, 2]);
  });

  it("preserves the primary failure when TUI cleanup also fails", async () => {
    const session: HarnessSession = { sessionId: "combined-failure", startedAt: "2026-07-27T00:00:00.000Z", mode: "headed/watch", tier: "readiness" };
    const tui = {
      kind: "codearts-original-tui" as const,
      subscribeOutput() { return () => undefined; },
      async start() { return { sessionId: session.sessionId, status: "running" as const, columns: 120, rows: 36, screen: "Ask anything", outputSequence: 0, lastChangedAt: session.startedAt }; },
      async read() { throw new Error("unused"); }, async sendText() {}, async sendKey() {}, async resize() {}, async stop() { throw new Error("stop failed"); },
    } satisfies CodeArtsTuiDriver;
    const evidence = { async recordTuiOutput() {}, async recordTuiSnapshot() {} } as unknown as EvidenceSink;

    await expect(correlateAfterCodeArtsReady({ tui, evidence, session, terminal: { columns: 120, rows: 36 }, correlate: async () => { throw new Error("correlation failed"); } }))
      .rejects.toThrow(/correlation failed.*stop failed/i);
  });
});
