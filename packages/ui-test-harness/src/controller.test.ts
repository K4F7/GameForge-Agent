import { describe, expect, it } from "vitest";
import type {
  ActivitySample,
  AuthoritySnapshot,
  CodeArtsTuiDriver,
  CodeArtsTuiObserverDriver,
  EvidenceSink,
  GuiSnapshot,
  HarnessSession,
  OpenChamberGuiDriver,
  TuiObserverSnapshot,
  TuiSnapshot,
} from "./contracts.js";
import { UiTestController } from "./controller.js";

describe("UiTestController", () => {
  it("binds the ConPTY, independent xterm observer, GUI and evidence to one session", async () => {
    const calls: string[] = [];
    const sessions: HarnessSession[] = [];
    let session: HarnessSession | undefined;

    const tui: CodeArtsTuiDriver = {
      kind: "codearts-original-tui",
      async start(options) {
        session = options.session;
        calls.push("tui:start");
        return tuiSnapshot(options.session.sessionId);
      },
      async read() {
        if (session === undefined) throw new Error("TUI has not started.");
        return tuiSnapshot(session.sessionId);
      },
      subscribeOutput() { return () => undefined; },
      async sendText() { calls.push("tui:text"); },
      async sendKey() { calls.push("tui:key"); },
      async resize() { calls.push("tui:resize"); },
      async stop() { calls.push("tui:stop"); },
    };
    const observer: CodeArtsTuiObserverDriver = {
      kind: "independent-xterm",
      async open(options) {
        calls.push("xterm:open");
        return observerSnapshot(options.session.sessionId);
      },
      async snapshot() {
        if (session === undefined) throw new Error("Observer has not opened.");
        return observerSnapshot(session.sessionId);
      },
      async close() { calls.push("xterm:close"); },
    };
    const gui: OpenChamberGuiDriver = {
      kind: "openchamber-original-gui",
      async launch(options) {
        expect(options.session.sessionId).toBe(session?.sessionId);
        calls.push("gui:launch");
      },
      async navigate() { calls.push("gui:navigate"); },
      async click() { calls.push("gui:click"); },
      async fill() { calls.push("gui:fill"); },
      async press() { calls.push("gui:press"); },
      async snapshot(): Promise<GuiSnapshot> {
        return { url: "http://127.0.0.1/", title: "OpenChamber", capturedAt: new Date().toISOString(), diagnostics: { consoleErrors: [], pageErrors: [], failedRequests: [] } };
      },
      async close() { calls.push("gui:close"); },
    };
    const authority = {
      kind: "gameforge-authority" as const,
      async snapshot(): Promise<AuthoritySnapshot> {
        return { eventSequence: 1, runStatus: "completed", capturedAt: new Date().toISOString() };
      },
    };
    const evidence: EvidenceSink = {
      async recordSession(value) { sessions.push(value); },
      async recordLifecycle() {},
      async recordActivity(_sample: ActivitySample) {},
      async recordTuiInput() {},
      async recordTuiSnapshot() {},
      async recordTuiObserverSnapshot() {},
      async recordGuiSnapshot() {},
      async recordAuthoritySnapshot() {},
      async finalize() {},
    };

    const controller = new UiTestController({ tui, tuiObserver: observer, gui, authority, evidence }, {
      mode: "headed/watch",
      terminal: { columns: 120, rows: 36 },
      tuiObserverViewport: { width: 1280, height: 800 },
      viewport: { width: 1440, height: 900 },
      observationHoldMs: 0,
      activityPollMs: 1,
      inactivityTimeoutMs: 100,
    });
    const result = await controller.run({ name: "contract", steps: [
      { kind: "capture", label: "initial" },
      { kind: "authority.wait", gate: { description: "completed", timeoutMs: 10, accepts: (value) => value.runStatus === "completed" } },
    ] });

    expect(result.status).toBe("completed");
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.sessionId).toBe(session?.sessionId);
    expect(calls).toEqual(["tui:start", "xterm:open", "gui:launch", "gui:close", "xterm:close", "tui:stop"]);
  });
});

function tuiSnapshot(sessionId: string): TuiSnapshot {
  return { sessionId, status: "running", columns: 120, rows: 36, outputSequence: 1, lastChangedAt: new Date().toISOString(), screen: "CodeArts" };
}

function observerSnapshot(sessionId: string): TuiObserverSnapshot {
  return { kind: "independent-xterm", sessionId, visible: true, status: "open", title: "CodeArts TUI", capturedAt: new Date().toISOString() };
}
