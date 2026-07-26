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
});
