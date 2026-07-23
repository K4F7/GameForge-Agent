import { describe, expect, it } from "vitest";
import type {
  ActivitySample,
  AuthoritySnapshot,
  CodeArtsTuiDriver,
  CodeArtsTuiObserverDriver,
  EvidenceSink,
  GuiSnapshot,
  HarnessResult,
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
    const guiLabels: string[] = [];
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
      async snapshot(label): Promise<GuiSnapshot> {
        guiLabels.push(label);
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
      async recordTuiOutput() {},
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
      { kind: "gui.click", selector: "#continue" },
      { kind: "authority.wait", gate: { description: "completed", timeoutMs: 10, accepts: (value) => value.runStatus === "completed" } },
    ] });

    expect(result.status).toBe("completed");
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.sessionId).toBe(session?.sessionId);
    expect(calls).toEqual(["tui:start", "xterm:open", "gui:launch", "gui:click", "gui:close", "xterm:close", "tui:stop"]);
    expect(guiLabels).toEqual(["loaded", "initial", "before-interaction", "after-interaction", "success"]);
  });

  it("captures failed when final browser diagnostics are not clean", async () => {
    const labels: string[] = []; const sessionId = "failure-session";
    const tui = { kind: "codearts-original-tui" as const, async start() { return tuiSnapshot(sessionId); }, async read() { return tuiSnapshot(sessionId); }, subscribeOutput() { return () => undefined; }, async sendText() {}, async sendKey() {}, async resize() {}, async stop() {} };
    const observer = { kind: "independent-xterm" as const, async open() { return observerSnapshot(sessionId); }, async snapshot() { return observerSnapshot(sessionId); }, async close() {} };
    const gui: OpenChamberGuiDriver = { kind: "openchamber-original-gui", async launch() {}, async navigate() {}, async click() {}, async fill() {}, async press() {},
      async snapshot(label) { labels.push(label); return { url: "http://127.0.0.1/", title: "OpenChamber", capturedAt: new Date().toISOString(), diagnostics: { consoleErrors: label === "success" ? ["broken"] : [], pageErrors: [], failedRequests: [] } }; }, async close() {} };
    const evidence = { async recordSession() {}, async recordLifecycle() {}, async recordActivity() {}, async recordTuiInput() {}, async recordTuiOutput() {}, async recordTuiSnapshot() {}, async recordTuiObserverSnapshot() {}, async recordGuiSnapshot() {}, async recordAuthoritySnapshot() {}, async finalize() {} };
    const controller = new UiTestController({ tui, tuiObserver: observer, gui, authority: { kind: "gameforge-authority", async snapshot() { return { eventSequence: 1, capturedAt: new Date().toISOString() }; } }, evidence },
      { sessionId, mode: "headless", terminal: { columns: 80, rows: 24 }, tuiObserverViewport: { width: 800, height: 600 }, viewport: { width: 800, height: 600 }, observationHoldMs: 0, activityPollMs: 1, inactivityTimeoutMs: 100 });
    expect((await controller.run({ name: "browser-failure", steps: [] })).status).toBe("failed"); expect(labels).toEqual(["loaded", "success", "failed"]);
  });

  it("closes a GUI driver whose launch fails after allocating resources", async () => {
    const sessionId = "launch-failure-session"; let guiClosed = false; let finalized: HarnessResult | undefined;
    const tui = { kind: "codearts-original-tui" as const, async start() { return tuiSnapshot(sessionId); }, async read() { return tuiSnapshot(sessionId); }, subscribeOutput() { return () => undefined; }, async sendText() {}, async sendKey() {}, async resize() {}, async stop() {} };
    const observer = { kind: "independent-xterm" as const, async open() { return observerSnapshot(sessionId); }, async snapshot() { return observerSnapshot(sessionId); }, async close() {} };
    const gui: OpenChamberGuiDriver = { kind: "openchamber-original-gui", async launch() { throw new Error("browser startup failed"); }, async navigate() {}, async click() {}, async fill() {}, async press() {},
      async snapshot() { throw new Error("browser page unavailable"); }, async close() { guiClosed = true; } };
    const evidence = { async recordSession() {}, async recordLifecycle() {}, async recordActivity() {}, async recordTuiInput() {}, async recordTuiOutput() {}, async recordTuiSnapshot() {}, async recordTuiObserverSnapshot() {}, async recordGuiSnapshot() {}, async recordAuthoritySnapshot() {}, async finalize(result: HarnessResult) { finalized = result; } };
    const controller = new UiTestController({ tui, tuiObserver: observer, gui, authority: { kind: "gameforge-authority", async snapshot() { return { eventSequence: 0, capturedAt: new Date().toISOString() }; } }, evidence },
      { sessionId, mode: "headless", terminal: { columns: 80, rows: 24 }, tuiObserverViewport: { width: 800, height: 600 }, viewport: { width: 800, height: 600 }, observationHoldMs: 0, activityPollMs: 1, inactivityTimeoutMs: 100 });

    await expect(controller.run({ name: "launch-rollback", steps: [] })).resolves.toMatchObject({ status: "failed", failure: "browser startup failed" });
    expect(guiClosed).toBe(true);
    expect(finalized).toMatchObject({ status: "failed" });
  });

  it("finalizes and cleans up when queued TUI evidence fails", async () => {
    const calls: string[] = []; const sessionId = "output-failure-session"; let finalized: HarnessResult | undefined;
    const tui = { kind: "codearts-original-tui" as const, async start() { calls.push("tui:start"); return tuiSnapshot(sessionId); }, async read() { return tuiSnapshot(sessionId); }, subscribeOutput(callback: (frame: any) => void) { callback({ sequence: 1, text: "output" }); return () => calls.push("tui:unsubscribe"); }, async sendText() {}, async sendKey() {}, async resize() {}, async stop() { calls.push("tui:stop"); } };
    const observer = { kind: "independent-xterm" as const, async open() { return observerSnapshot(sessionId); }, async snapshot() { return observerSnapshot(sessionId); }, async close() { calls.push("xterm:close"); } };
    const gui = { kind: "openchamber-original-gui" as const, async launch() { calls.push("gui:launch"); }, async navigate() {}, async click() {}, async fill() {}, async press() {}, async snapshot() { return { url: "http://127.0.0.1/", title: "OpenChamber", capturedAt: new Date().toISOString(), diagnostics: { consoleErrors: [], pageErrors: [], failedRequests: [] } }; }, async close() { calls.push("gui:close"); } };
    const evidence = { async recordSession() {}, async recordLifecycle() {}, async recordActivity() {}, async recordTuiInput() {}, async recordTuiOutput() { throw new Error("evidence disk full"); }, async recordTuiSnapshot() {}, async recordTuiObserverSnapshot() {}, async recordGuiSnapshot() {}, async recordAuthoritySnapshot() {}, async finalize(result: HarnessResult) { finalized = result; } };
    const controller = new UiTestController({ tui, tuiObserver: observer, gui, authority: { kind: "gameforge-authority", async snapshot() { return { eventSequence: 1, runStatus: "completed", capturedAt: new Date().toISOString() }; } }, evidence },
      { sessionId, mode: "headless", terminal: { columns: 80, rows: 24 }, tuiObserverViewport: { width: 800, height: 600 }, viewport: { width: 800, height: 600 }, observationHoldMs: 0, activityPollMs: 1, inactivityTimeoutMs: 100 });
    await expect(controller.run({ name: "output-failure", steps: [] })).resolves.toMatchObject({ status: "failed", failure: "evidence disk full" });
    expect(calls).toEqual(["tui:start", "gui:launch", "gui:close", "xterm:close", "tui:stop", "tui:unsubscribe"]);
    expect(finalized).toMatchObject({ status: "failed" });
  });
});

function tuiSnapshot(sessionId: string): TuiSnapshot {
  return { sessionId, status: "running", columns: 120, rows: 36, outputSequence: 1, lastChangedAt: new Date().toISOString(), screen: "CodeArts" };
}

function observerSnapshot(sessionId: string): TuiObserverSnapshot {
  return { kind: "independent-xterm", sessionId, visible: true, status: "open", title: "CodeArts TUI", capturedAt: new Date().toISOString() };
}
