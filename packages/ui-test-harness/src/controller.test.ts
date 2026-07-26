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
  it("flushes queued TUI output before final evidence", async () => {
    let listener: ((frame: { sessionId: string; sequence: number; data: string }) => void) | undefined;
    let releaseOutput: (() => void) | undefined;
    const outputReleased = new Promise<void>((resolve) => { releaseOutput = resolve; });
    const recorded: string[] = [];
    const sessionId = "output-flush-session";
    const tui: CodeArtsTuiDriver = {
      kind: "codearts-original-tui",
      async start() { listener?.({ sessionId, sequence: 1, data: "latest" }); return tuiSnapshot(sessionId); },
      async read() { return tuiSnapshot(sessionId); },
      subscribeOutput(value) { listener = value; return () => { listener = undefined; }; },
      async sendText() {}, async sendKey() {}, async resize() {}, async stop() {},
    };
    const observer = { kind: "independent-xterm" as const, async open() { return observerSnapshot(sessionId); }, async snapshot() { return observerSnapshot(sessionId); }, async close() {} };
    const gui = { kind: "openchamber-original-gui" as const, async launch() {}, async navigate() {}, async click() {}, async fill() {}, async press() {}, async waitFor() {}, async snapshot() { return { url: "http://127.0.0.1/", title: "OpenChamber", capturedAt: new Date().toISOString(), diagnostics: { consoleErrors: [], pageErrors: [], failedRequests: [] } }; }, async close() {} };
    const evidence: EvidenceSink = {
      async recordSession() {}, async recordLifecycle() {}, async recordActivity() {}, async recordTuiInput() {},
      async recordTuiOutput(frame) { await outputReleased; recorded.push(frame.data); }, async recordTuiSnapshot() {},
      async recordTuiObserverSnapshot() {}, async recordGuiSnapshot() {}, async recordAuthoritySnapshot() {},
      async finalize() { expect(recorded).toEqual(["latest"]); },
    };
    const controller = new UiTestController({ tui, tuiObserver: observer, gui, authority: { kind: "gameforge-authority", async snapshot() { return { eventSequence: 1, runStatus: "completed", capturedAt: new Date().toISOString() }; } }, evidence }, {
      sessionId, mode: "headless", terminal: { columns: 80, rows: 24 }, tuiObserverViewport: { width: 800, height: 600 }, viewport: { width: 800, height: 600 }, observationHoldMs: 0, activityPollMs: 1, inactivityTimeoutMs: 100,
    });
    const resultPromise = controller.run({ name: "output-flush", steps: [] });
    await Promise.resolve();
    releaseOutput?.();
    await expect(resultPromise).resolves.toMatchObject({ status: "completed" });
  });

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
      async waitFor(selector, options) { expect(selector).toBe("#ready"); expect(options).toEqual({ state: "visible", timeoutMs: 1_000 }); calls.push("gui:wait"); },
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
      { kind: "gui.wait", selector: "#ready", options: { state: "visible", timeoutMs: 1_000 } },
      { kind: "authority.wait", gate: { description: "completed", timeoutMs: 10, accepts: (value) => value.runStatus === "completed" } },
    ] });

    expect(result.status).toBe("completed");
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.sessionId).toBe(session?.sessionId);
    expect(calls).toEqual(["tui:start", "xterm:open", "gui:launch", "gui:click", "gui:wait", "gui:close", "xterm:close", "tui:stop"]);
    expect(guiLabels).toEqual(["loaded", "initial", "before-interaction", "after-interaction", "after-gui-wait", "success"]);
  });

  it("rejects unsafe GUI wait timeouts before calling the browser driver", async () => {
    const sessionId = "invalid-gui-wait"; let waitCalled = false;
    const tui = { kind: "codearts-original-tui" as const, async start() { return tuiSnapshot(sessionId); }, async read() { return tuiSnapshot(sessionId); }, subscribeOutput() { return () => undefined; }, async sendText() {}, async sendKey() {}, async resize() {}, async stop() {} };
    const observer = { kind: "independent-xterm" as const, async open() { return observerSnapshot(sessionId); }, async snapshot() { return observerSnapshot(sessionId); }, async close() {} };
    const gui: OpenChamberGuiDriver = { kind: "openchamber-original-gui", async launch() {}, async navigate() {}, async click() {}, async fill() {}, async press() {}, async waitFor() { waitCalled = true; },
      async snapshot() { return { url: "http://127.0.0.1/", title: "OpenChamber", capturedAt: new Date().toISOString(), diagnostics: { consoleErrors: [], pageErrors: [], failedRequests: [] } }; }, async close() {} };
    const evidence = { async recordSession() {}, async recordLifecycle() {}, async recordActivity() {}, async recordTuiInput() {}, async recordTuiOutput() {}, async recordTuiSnapshot() {}, async recordTuiObserverSnapshot() {}, async recordGuiSnapshot() {}, async recordAuthoritySnapshot() {}, async finalize() {} };
    const controller = new UiTestController({ tui, tuiObserver: observer, gui, authority: { kind: "gameforge-authority", async snapshot() { return { eventSequence: 0, capturedAt: new Date().toISOString() }; } }, evidence },
      { sessionId, mode: "headless", terminal: { columns: 80, rows: 24 }, tuiObserverViewport: { width: 800, height: 600 }, viewport: { width: 800, height: 600 }, observationHoldMs: 0, activityPollMs: 1, inactivityTimeoutMs: 100 });

    await expect(controller.run({ name: "invalid-gui-wait", steps: [{ kind: "gui.wait", selector: "#ready", options: { state: "visible", timeoutMs: 0 } }] }))
      .resolves.toMatchObject({ status: "failed", failure: "GUI wait timeout must be a positive safe integer." });
    expect(waitCalled).toBe(false);

    await expect(controller.run({ name: "excessive-gui-wait", steps: [{ kind: "gui.wait", selector: "#ready", options: { state: "visible", timeoutMs: 900_001 } }] }))
      .resolves.toMatchObject({ status: "failed", failure: "GUI wait timeout must not exceed 900000 milliseconds." });
    expect(waitCalled).toBe(false);
  });

  it("rejects an Authority result that arrives after the gate timeout", async () => {
    const sessionId = "late-authority-result";
    let snapshotCalls = 0;
    const tui = { kind: "codearts-original-tui" as const, async start() { return tuiSnapshot(sessionId); }, async read() { return tuiSnapshot(sessionId); }, subscribeOutput() { return () => undefined; }, async sendText() {}, async sendKey() {}, async resize() {}, async stop() {} };
    const observer = { kind: "independent-xterm" as const, async open() { return observerSnapshot(sessionId); }, async snapshot() { return observerSnapshot(sessionId); }, async close() {} };
    const gui = { kind: "openchamber-original-gui" as const, async launch() {}, async navigate() {}, async click() {}, async fill() {}, async press() {}, async waitFor() {}, async snapshot() { return { url: "http://127.0.0.1/", title: "OpenChamber", capturedAt: new Date().toISOString(), diagnostics: { consoleErrors: [], pageErrors: [], failedRequests: [] } }; }, async close() {} };
    const authority = { kind: "gameforge-authority" as const, async snapshot() {
      snapshotCalls += 1;
      if (snapshotCalls > 1) await new Promise((resolve) => setTimeout(resolve, 150));
      return { eventSequence: snapshotCalls, runStatus: snapshotCalls > 1 ? "completed" : "running", capturedAt: new Date().toISOString() };
    } };
    const evidence = { async recordSession() {}, async recordLifecycle() {}, async recordActivity() {}, async recordTuiInput() {}, async recordTuiOutput() {}, async recordTuiSnapshot() {}, async recordTuiObserverSnapshot() {}, async recordGuiSnapshot() {}, async recordAuthoritySnapshot() {}, async finalize() {} };
    const controller = new UiTestController({ tui, tuiObserver: observer, gui, authority, evidence },
      { sessionId, mode: "headless", terminal: { columns: 80, rows: 24 }, tuiObserverViewport: { width: 800, height: 600 }, viewport: { width: 800, height: 600 }, observationHoldMs: 0, activityPollMs: 1, inactivityTimeoutMs: 1_000 });

    await expect(controller.run({ name: "late-authority-result", steps: [
      { kind: "authority.wait", gate: { description: "completed", timeoutMs: 100, accepts: (value) => value.runStatus === "completed" } },
    ] })).resolves.toMatchObject({ status: "failed", failure: "Authority gate timed out: completed" });
    expect(snapshotCalls).toBe(2);
  });

  it("accepts an Authority snapshot captured before the deadline even when evidence finishes later", async () => {
    const sessionId = "accepted-authority-slow-evidence";
    let snapshotCalls = 0;
    const tui = { kind: "codearts-original-tui" as const, async start() { return tuiSnapshot(sessionId); }, async read() { return tuiSnapshot(sessionId); }, subscribeOutput() { return () => undefined; }, async sendText() {}, async sendKey() {}, async resize() {}, async stop() {} };
    const observer = { kind: "independent-xterm" as const, async open() { return observerSnapshot(sessionId); }, async snapshot() { return observerSnapshot(sessionId); }, async close() {} };
    const gui = { kind: "openchamber-original-gui" as const, async launch() {}, async navigate() {}, async click() {}, async fill() {}, async press() {}, async waitFor() {}, async snapshot() { return { url: "http://127.0.0.1/", title: "OpenChamber", capturedAt: new Date().toISOString(), diagnostics: { consoleErrors: [], pageErrors: [], failedRequests: [] } }; }, async close() {} };
    const authority = { kind: "gameforge-authority" as const, async snapshot() { snapshotCalls += 1; return { eventSequence: snapshotCalls, runStatus: snapshotCalls > 1 ? "completed" : "running", capturedAt: new Date().toISOString() }; } };
    const evidence = { async recordSession() {}, async recordLifecycle() {}, async recordActivity() {}, async recordTuiInput() {}, async recordTuiOutput() {}, async recordTuiSnapshot() {}, async recordTuiObserverSnapshot() {}, async recordGuiSnapshot() {}, async recordAuthoritySnapshot() { await new Promise((resolve) => setTimeout(resolve, 30)); }, async finalize() {} };
    const controller = new UiTestController({ tui, tuiObserver: observer, gui, authority, evidence },
      { sessionId, mode: "headless", terminal: { columns: 80, rows: 24 }, tuiObserverViewport: { width: 800, height: 600 }, viewport: { width: 800, height: 600 }, observationHoldMs: 0, activityPollMs: 1, inactivityTimeoutMs: 100 });

    await expect(controller.run({ name: "accepted-authority-slow-evidence", steps: [
      { kind: "authority.wait", gate: { description: "completed", timeoutMs: 20, accepts: (value) => value.runStatus === "completed" } },
    ] })).resolves.toMatchObject({ status: "completed" });
  });

  it("settles a timed-out Authority evidence write before finalizing", async () => {
    const sessionId = "late-authority-evidence-rejection";
    let lateWriteSettled = false;
    let snapshotCalls = 0;
    const tui = { kind: "codearts-original-tui" as const, async start() { return tuiSnapshot(sessionId); }, async read() { return tuiSnapshot(sessionId); }, subscribeOutput() { return () => undefined; }, async sendText() {}, async sendKey() {}, async resize() {}, async stop() {} };
    const observer = { kind: "independent-xterm" as const, async open() { return observerSnapshot(sessionId); }, async snapshot() { return observerSnapshot(sessionId); }, async close() {} };
    const gui = { kind: "openchamber-original-gui" as const, async launch() {}, async navigate() {}, async click() {}, async fill() {}, async press() {}, async waitFor() {}, async snapshot() { return { url: "http://127.0.0.1/", title: "OpenChamber", capturedAt: new Date().toISOString(), diagnostics: { consoleErrors: [], pageErrors: [], failedRequests: [] } }; }, async close() {} };
    const authority = { kind: "gameforge-authority" as const, async snapshot() { snapshotCalls += 1; return { eventSequence: snapshotCalls, runStatus: "running", capturedAt: new Date().toISOString() }; } };
    const evidence = { async recordSession() {}, async recordLifecycle() {}, async recordActivity() {}, async recordTuiInput() {}, async recordTuiOutput() {}, async recordTuiSnapshot() {}, async recordTuiObserverSnapshot() {}, async recordGuiSnapshot() {}, async recordAuthoritySnapshot() { await new Promise((resolve) => setTimeout(resolve, 30)); lateWriteSettled = true; throw new Error("late authority evidence failure"); }, async finalize() { if (!lateWriteSettled) throw new Error("finalized before authority evidence settled"); } };
    const controller = new UiTestController({ tui, tuiObserver: observer, gui, authority, evidence },
      { sessionId, mode: "headless", terminal: { columns: 80, rows: 24 }, tuiObserverViewport: { width: 800, height: 600 }, viewport: { width: 800, height: 600 }, observationHoldMs: 0, activityPollMs: 1, inactivityTimeoutMs: 100 });

    const result = await controller.run({ name: "late-authority-evidence-rejection", steps: [
      { kind: "authority.wait", gate: { description: "completed", timeoutMs: 10, accepts: (value) => value.runStatus === "completed" } },
    ] });
    expect(result).toMatchObject({ status: "failed", failure: "Authority gate timed out: completed" });
    expect(lateWriteSettled).toBe(true);
  });

  it("bounds an Authority gate when the initial activity sample hangs", async () => {
    const sessionId = "hung-authority-sample";
    const tui = { kind: "codearts-original-tui" as const, async start() { return tuiSnapshot(sessionId); }, async read() { return tuiSnapshot(sessionId); }, subscribeOutput() { return () => undefined; }, async sendText() {}, async sendKey() {}, async resize() {}, async stop() {} };
    const observer = { kind: "independent-xterm" as const, async open() { return observerSnapshot(sessionId); }, async snapshot() { return observerSnapshot(sessionId); }, async close() {} };
    const gui = { kind: "openchamber-original-gui" as const, async launch() {}, async navigate() {}, async click() {}, async fill() {}, async press() {}, async waitFor() {}, async snapshot() { return { url: "http://127.0.0.1/", title: "OpenChamber", capturedAt: new Date().toISOString(), diagnostics: { consoleErrors: [], pageErrors: [], failedRequests: [] } }; }, async close() {} };
    const authority = { kind: "gameforge-authority" as const, async snapshot() { return new Promise<never>(() => undefined); } };
    const evidence = { async recordSession() {}, async recordLifecycle() {}, async recordActivity() {}, async recordTuiInput() {}, async recordTuiOutput() {}, async recordTuiSnapshot() {}, async recordTuiObserverSnapshot() {}, async recordGuiSnapshot() {}, async recordAuthoritySnapshot() {}, async finalize() {} };
    const controller = new UiTestController({ tui, tuiObserver: observer, gui, authority, evidence },
      { sessionId, mode: "headless", terminal: { columns: 80, rows: 24 }, tuiObserverViewport: { width: 800, height: 600 }, viewport: { width: 800, height: 600 }, observationHoldMs: 0, activityPollMs: 1, inactivityTimeoutMs: 1_000 });

    const result = await Promise.race([
      controller.run({ name: "hung-authority-sample", steps: [{ kind: "authority.wait", gate: { description: "completed", timeoutMs: 20, accepts: (value) => value.runStatus === "completed" } }] }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("controller hung past safety bound")), 200)),
    ]);
    expect(result).toMatchObject({ status: "failed", failure: "Authority gate timed out: completed" });
  });

  it("captures failed when final browser diagnostics are not clean", async () => {
    const labels: string[] = []; const sessionId = "failure-session";
    const tui = { kind: "codearts-original-tui" as const, async start() { return tuiSnapshot(sessionId); }, async read() { return tuiSnapshot(sessionId); }, subscribeOutput() { return () => undefined; }, async sendText() {}, async sendKey() {}, async resize() {}, async stop() {} };
    const observer = { kind: "independent-xterm" as const, async open() { return observerSnapshot(sessionId); }, async snapshot() { return observerSnapshot(sessionId); }, async close() {} };
    const gui: OpenChamberGuiDriver = { kind: "openchamber-original-gui", async launch() {}, async navigate() {}, async click() {}, async fill() {}, async press() {}, async waitFor() {},
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
    const gui: OpenChamberGuiDriver = { kind: "openchamber-original-gui", async launch() { throw new Error("browser startup failed"); }, async navigate() {}, async click() {}, async fill() {}, async press() {}, async waitFor() {},
      async snapshot() { throw new Error("browser page unavailable"); }, async close() { guiClosed = true; } };
    const evidence = { async recordSession() {}, async recordLifecycle() {}, async recordActivity() {}, async recordTuiInput() {}, async recordTuiOutput() {}, async recordTuiSnapshot() {}, async recordTuiObserverSnapshot() {}, async recordGuiSnapshot() {}, async recordAuthoritySnapshot() {}, async finalize(result: HarnessResult) { finalized = result; } };
    const controller = new UiTestController({ tui, tuiObserver: observer, gui, authority: { kind: "gameforge-authority", async snapshot() { return { eventSequence: 0, capturedAt: new Date().toISOString() }; } }, evidence },
      { sessionId, mode: "headless", terminal: { columns: 80, rows: 24 }, tuiObserverViewport: { width: 800, height: 600 }, viewport: { width: 800, height: 600 }, observationHoldMs: 0, activityPollMs: 1, inactivityTimeoutMs: 100 });

    await expect(controller.run({ name: "launch-rollback", steps: [] })).resolves.toMatchObject({ status: "failed", failure: "browser startup failed" });
    expect(guiClosed).toBe(true);
    expect(finalized).toMatchObject({ status: "failed" });
  });

  it("closes an observer whose open fails after allocating resources", async () => {
    const sessionId = "observer-open-failure"; let observerClosed = false; let guiLaunched = false;
    const tui = { kind: "codearts-original-tui" as const, async start() { return tuiSnapshot(sessionId); }, async read() { return tuiSnapshot(sessionId); }, subscribeOutput() { return () => undefined; }, async sendText() {}, async sendKey() {}, async resize() {}, async stop() {} };
    const observer: CodeArtsTuiObserverDriver = { kind: "independent-xterm", async open() { throw new Error("observer startup failed"); }, async snapshot() { return observerSnapshot(sessionId); }, async close() { observerClosed = true; } };
    const gui = { kind: "openchamber-original-gui" as const, async launch() { guiLaunched = true; }, async navigate() {}, async click() {}, async fill() {}, async press() {}, async waitFor() {}, async snapshot() { return { url: "http://127.0.0.1/", title: "OpenChamber", capturedAt: new Date().toISOString(), diagnostics: { consoleErrors: [], pageErrors: [], failedRequests: [] } }; }, async close() {} };
    const evidence = { async recordSession() {}, async recordLifecycle() {}, async recordActivity() {}, async recordTuiInput() {}, async recordTuiOutput() {}, async recordTuiSnapshot() {}, async recordTuiObserverSnapshot() {}, async recordGuiSnapshot() {}, async recordAuthoritySnapshot() {}, async finalize() {} };
    const controller = new UiTestController({ tui, tuiObserver: observer, gui, authority: { kind: "gameforge-authority", async snapshot() { return { eventSequence: 0, capturedAt: new Date().toISOString() }; } }, evidence },
      { sessionId, mode: "headed/watch", terminal: { columns: 80, rows: 24 }, tuiObserverViewport: { width: 800, height: 600 }, viewport: { width: 800, height: 600 }, observationHoldMs: 0, activityPollMs: 1, inactivityTimeoutMs: 100 });

    await expect(controller.run({ name: "observer-open-rollback", steps: [] })).resolves.toMatchObject({ status: "failed", failure: "observer startup failed" });
    expect(observerClosed).toBe(true);
    expect(guiLaunched).toBe(false);
  });

  it("preserves observer startup and rollback failures together", async () => {
    const sessionId = "observer-open-double-failure";
    const tui = { kind: "codearts-original-tui" as const, async start() { return tuiSnapshot(sessionId); }, async read() { return tuiSnapshot(sessionId); }, subscribeOutput() { return () => undefined; }, async sendText() {}, async sendKey() {}, async resize() {}, async stop() {} };
    const observer: CodeArtsTuiObserverDriver = { kind: "independent-xterm", async open() { throw new Error("observer startup failed"); }, async snapshot() { return observerSnapshot(sessionId); }, async close() { throw new Error("observer rollback failed"); } };
    const gui = { kind: "openchamber-original-gui" as const, async launch() {}, async navigate() {}, async click() {}, async fill() {}, async press() {}, async waitFor() {}, async snapshot() { return { url: "http://127.0.0.1/", title: "OpenChamber", capturedAt: new Date().toISOString(), diagnostics: { consoleErrors: [], pageErrors: [], failedRequests: [] } }; }, async close() {} };
    const evidence = { async recordSession() {}, async recordLifecycle() {}, async recordActivity() {}, async recordTuiInput() {}, async recordTuiOutput() {}, async recordTuiSnapshot() {}, async recordTuiObserverSnapshot() {}, async recordGuiSnapshot() {}, async recordAuthoritySnapshot() {}, async finalize() {} };
    const controller = new UiTestController({ tui, tuiObserver: observer, gui, authority: { kind: "gameforge-authority", async snapshot() { return { eventSequence: 0, capturedAt: new Date().toISOString() }; } }, evidence },
      { sessionId, mode: "headed/watch", terminal: { columns: 80, rows: 24 }, tuiObserverViewport: { width: 800, height: 600 }, viewport: { width: 800, height: 600 }, observationHoldMs: 0, activityPollMs: 1, inactivityTimeoutMs: 100 });

    await expect(controller.run({ name: "observer-open-double-failure", steps: [] })).resolves.toMatchObject({
      status: "failed",
      failure: "observer startup failed; Cleanup failed: observer rollback failed",
    });
  });

  it("finalizes and cleans up when queued TUI evidence fails", async () => {
    const calls: string[] = []; const sessionId = "output-failure-session"; let finalized: HarnessResult | undefined;
    const tui = { kind: "codearts-original-tui" as const, async start() { calls.push("tui:start"); return tuiSnapshot(sessionId); }, async read() { return tuiSnapshot(sessionId); }, subscribeOutput(callback: (frame: any) => void) { callback({ sequence: 1, text: "output" }); return () => calls.push("tui:unsubscribe"); }, async sendText() {}, async sendKey() {}, async resize() {}, async stop() { calls.push("tui:stop"); } };
    const observer = { kind: "independent-xterm" as const, async open() { return observerSnapshot(sessionId); }, async snapshot() { return observerSnapshot(sessionId); }, async close() { calls.push("xterm:close"); } };
    const gui = { kind: "openchamber-original-gui" as const, async launch() { calls.push("gui:launch"); }, async navigate() {}, async click() {}, async fill() {}, async press() {}, async waitFor() {}, async snapshot() { return { url: "http://127.0.0.1/", title: "OpenChamber", capturedAt: new Date().toISOString(), diagnostics: { consoleErrors: [], pageErrors: [], failedRequests: [] } }; }, async close() { calls.push("gui:close"); } };
    const evidence = { async recordSession() {}, async recordLifecycle() {}, async recordActivity() {}, async recordTuiInput() {}, async recordTuiOutput() { throw new Error("evidence disk full"); }, async recordTuiSnapshot() {}, async recordTuiObserverSnapshot() {}, async recordGuiSnapshot() {}, async recordAuthoritySnapshot() {}, async finalize(result: HarnessResult) { finalized = result; } };
    const controller = new UiTestController({ tui, tuiObserver: observer, gui, authority: { kind: "gameforge-authority", async snapshot() { return { eventSequence: 1, runStatus: "completed", capturedAt: new Date().toISOString() }; } }, evidence },
      { sessionId, mode: "headless", terminal: { columns: 80, rows: 24 }, tuiObserverViewport: { width: 800, height: 600 }, viewport: { width: 800, height: 600 }, observationHoldMs: 0, activityPollMs: 1, inactivityTimeoutMs: 100 });
    await expect(controller.run({ name: "output-failure", steps: [] })).resolves.toMatchObject({ status: "failed", failure: "evidence disk full" });
    expect(calls).toEqual(["tui:start", "gui:launch", "gui:close", "xterm:close", "tui:stop", "tui:unsubscribe"]);
    expect(finalized).toMatchObject({ status: "failed" });
  });

  it("reports queued TUI evidence failure alongside an existing scenario failure", async () => {
    const sessionId = "output-and-scenario-failure";
    let listener: ((frame: any) => void) | undefined;
    const tui = { kind: "codearts-original-tui" as const, async start() { listener?.({ sessionId, sequence: 1, data: "output" }); return tuiSnapshot(sessionId); }, async read() { return tuiSnapshot(sessionId); }, subscribeOutput(callback: (frame: any) => void) { listener = callback; return () => undefined; }, async sendText() {}, async sendKey() {}, async resize() {}, async stop() {} };
    const observer = { kind: "independent-xterm" as const, async open() { return observerSnapshot(sessionId); }, async snapshot() { return observerSnapshot(sessionId); }, async close() {} };
    const gui = { kind: "openchamber-original-gui" as const, async launch() { throw new Error("browser startup failed"); }, async navigate() {}, async click() {}, async fill() {}, async press() {}, async waitFor() {}, async snapshot() { throw new Error("browser page unavailable"); }, async close() {} };
    const evidence = { async recordSession() {}, async recordLifecycle() {}, async recordActivity() {}, async recordTuiInput() {}, async recordTuiOutput() { throw new Error("evidence disk full"); }, async recordTuiSnapshot() {}, async recordTuiObserverSnapshot() {}, async recordGuiSnapshot() {}, async recordAuthoritySnapshot() {}, async finalize() {} };
    const controller = new UiTestController({ tui, tuiObserver: observer, gui, authority: { kind: "gameforge-authority", async snapshot() { return { eventSequence: 0, capturedAt: new Date().toISOString() }; } }, evidence },
      { sessionId, mode: "headless", terminal: { columns: 80, rows: 24 }, tuiObserverViewport: { width: 800, height: 600 }, viewport: { width: 800, height: 600 }, observationHoldMs: 0, activityPollMs: 1, inactivityTimeoutMs: 100 });

    await expect(controller.run({ name: "output-and-scenario-failure", steps: [] })).resolves.toMatchObject({
      status: "failed",
      failure: "browser startup failed; TUI output evidence failed: evidence disk full",
    });
  });

  it("drains terminal output emitted during stop before finalizing", async () => {
    const sessionId = "shutdown-output-session"; let listener: ((frame: any) => void) | undefined; let outputWritten = false;
    const tui = { kind: "codearts-original-tui" as const, async start() { return tuiSnapshot(sessionId); }, async read() { return tuiSnapshot(sessionId); }, subscribeOutput(callback: (frame: any) => void) { listener = callback; return () => undefined; }, async sendText() {}, async sendKey() {}, async resize() {}, async stop() { listener?.({ sequence: 2, text: "shutdown output" }); } };
    const observer = { kind: "independent-xterm" as const, async open() { return observerSnapshot(sessionId); }, async snapshot() { return observerSnapshot(sessionId); }, async close() {} };
    const gui = { kind: "openchamber-original-gui" as const, async launch() {}, async navigate() {}, async click() {}, async fill() {}, async press() {}, async waitFor() {}, async snapshot() { return { url: "http://127.0.0.1/", title: "OpenChamber", capturedAt: new Date().toISOString(), diagnostics: { consoleErrors: [], pageErrors: [], failedRequests: [] } }; }, async close() {} };
    const evidence = { async recordSession() {}, async recordLifecycle() {}, async recordActivity() {}, async recordTuiInput() {}, async recordTuiOutput() { await new Promise((resolve) => setTimeout(resolve, 10)); outputWritten = true; }, async recordTuiSnapshot() {}, async recordTuiObserverSnapshot() {}, async recordGuiSnapshot() {}, async recordAuthoritySnapshot() {}, async finalize() { if (!outputWritten) throw new Error("finalized before shutdown output"); } };
    const controller = new UiTestController({ tui, tuiObserver: observer, gui, authority: { kind: "gameforge-authority", async snapshot() { return { eventSequence: 1, runStatus: "completed", capturedAt: new Date().toISOString() }; } }, evidence },
      { sessionId, mode: "headless", terminal: { columns: 80, rows: 24 }, tuiObserverViewport: { width: 800, height: 600 }, viewport: { width: 800, height: 600 }, observationHoldMs: 0, activityPollMs: 1, inactivityTimeoutMs: 100 });
    await expect(controller.run({ name: "shutdown-output", steps: [] })).resolves.toMatchObject({ status: "completed" });
  });

  it("returns a failed result without starting components when initial lifecycle evidence fails", async () => {
    const sessionId = "initial-evidence-failure"; const calls: string[] = []; let finalized: HarnessResult | undefined; let firstLifecycle = true;
    const tui = { kind: "codearts-original-tui" as const, async start() { calls.push("tui:start"); return tuiSnapshot(sessionId); }, async read() { return tuiSnapshot(sessionId); }, subscribeOutput() { return () => undefined; }, async sendText() {}, async sendKey() {}, async resize() {}, async stop() { calls.push("tui:stop"); } };
    const observer = { kind: "independent-xterm" as const, async open() { calls.push("xterm:open"); return observerSnapshot(sessionId); }, async snapshot() { return observerSnapshot(sessionId); }, async close() { calls.push("xterm:close"); } };
    const gui = { kind: "openchamber-original-gui" as const, async launch() { calls.push("gui:launch"); }, async navigate() {}, async click() {}, async fill() {}, async press() {}, async waitFor() {}, async snapshot() { return { url: "http://127.0.0.1/", title: "OpenChamber", capturedAt: new Date().toISOString(), diagnostics: { consoleErrors: [], pageErrors: [], failedRequests: [] } }; }, async close() { calls.push("gui:close"); } };
    const evidence = { async recordSession() {}, async recordLifecycle() { if (firstLifecycle) { firstLifecycle = false; throw new Error("evidence directory is read-only"); } }, async recordActivity() {}, async recordTuiInput() {}, async recordTuiOutput() {}, async recordTuiSnapshot() {}, async recordTuiObserverSnapshot() {}, async recordGuiSnapshot() {}, async recordAuthoritySnapshot() {}, async finalize(result: HarnessResult) { finalized = result; } };
    const controller = new UiTestController({ tui, tuiObserver: observer, gui, authority: { kind: "gameforge-authority", async snapshot() { return { eventSequence: 0, capturedAt: new Date().toISOString() }; } }, evidence },
      { sessionId, mode: "headless", terminal: { columns: 80, rows: 24 }, tuiObserverViewport: { width: 800, height: 600 }, viewport: { width: 800, height: 600 }, observationHoldMs: 0, activityPollMs: 1, inactivityTimeoutMs: 100 });

    await expect(controller.run({ name: "initial-evidence-failure", steps: [] })).resolves.toMatchObject({ status: "failed", failure: "evidence directory is read-only" });
    expect(calls).toEqual([]);
    expect(finalized).toMatchObject({ status: "failed" });
  });

  it("observes and holds a headed stopping lifecycle failure before cleanup", async () => {
    const sessionId = "stopping-evidence-failure"; let finalized: HarnessResult | undefined; const events: string[] = [];
    const tui = { kind: "codearts-original-tui" as const, async start() { return tuiSnapshot(sessionId); }, async read() { return tuiSnapshot(sessionId); }, subscribeOutput() { return () => undefined; }, async sendText() {}, async sendKey() {}, async resize() {}, async stop() {} };
    const observer = { kind: "independent-xterm" as const, async open() { return observerSnapshot(sessionId); }, async snapshot() { return observerSnapshot(sessionId); }, async close() { events.push("observer:close"); } };
    const gui = { kind: "openchamber-original-gui" as const, async launch() {}, async navigate() {}, async click() {}, async fill() {}, async press() {}, async waitFor() {}, async snapshot() { return { url: "http://127.0.0.1/", title: "OpenChamber", capturedAt: new Date().toISOString(), diagnostics: { consoleErrors: [], pageErrors: [], failedRequests: [] } }; }, async close() { events.push("gui:close"); } };
    let stoppingFailed = false;
    const evidence = { async recordSession() {}, async recordLifecycle(event: { phase: string }) { events.push(`lifecycle:${event.phase}`); if (event.phase === "stopping" && !stoppingFailed) { stoppingFailed = true; throw new Error("stopping evidence unavailable"); } }, async recordActivity() {}, async recordTuiInput() {}, async recordTuiOutput() {}, async recordTuiSnapshot() {}, async recordTuiObserverSnapshot() {}, async recordGuiSnapshot() {}, async recordAuthoritySnapshot() {}, async finalize(result: HarnessResult) { finalized = result; } };
    const controller = new UiTestController({ tui, tuiObserver: observer, gui, authority: { kind: "gameforge-authority", async snapshot() { return { eventSequence: 0, runStatus: "completed", capturedAt: new Date().toISOString() }; } }, evidence },
      { sessionId, mode: "headed/watch", terminal: { columns: 80, rows: 24 }, tuiObserverViewport: { width: 800, height: 600 }, viewport: { width: 800, height: 600 }, observationHoldMs: 0, failureHoldMs: 10, activityPollMs: 1, inactivityTimeoutMs: 100, onFailureObserved(message) { events.push(`observed:${message}`); } });

    await expect(controller.run({ name: "stopping-evidence-failure", steps: [] })).resolves.toMatchObject({ status: "failed", failure: "stopping evidence unavailable" });
    expect(finalized).toMatchObject({ status: "failed", failure: "stopping evidence unavailable" });
    expect(events).toContain("observed:stopping evidence unavailable");
    expect(events).toContain("lifecycle:observing");
    expect(events.indexOf("observed:stopping evidence unavailable")).toBeLessThan(events.indexOf("gui:close"));
    expect(events.indexOf("lifecycle:observing")).toBeLessThan(events.indexOf("observer:close"));
  });

  it("reports evidence finalization failure alongside an existing scenario failure", async () => {
    const sessionId = "double-failure-session";
    const tui = { kind: "codearts-original-tui" as const, async start() { return tuiSnapshot(sessionId); }, async read() { return tuiSnapshot(sessionId); }, subscribeOutput() { return () => undefined; }, async sendText() {}, async sendKey() {}, async resize() {}, async stop() {} };
    const observer = { kind: "independent-xterm" as const, async open() { return observerSnapshot(sessionId); }, async snapshot() { return observerSnapshot(sessionId); }, async close() {} };
    const gui = { kind: "openchamber-original-gui" as const, async launch() { throw new Error("browser startup failed"); }, async navigate() {}, async click() {}, async fill() {}, async press() {}, async waitFor() {}, async snapshot() { throw new Error("browser page unavailable"); }, async close() {} };
    const evidence = { async recordSession() {}, async recordLifecycle() {}, async recordActivity() {}, async recordTuiInput() {}, async recordTuiOutput() {}, async recordTuiSnapshot() {}, async recordTuiObserverSnapshot() {}, async recordGuiSnapshot() {}, async recordAuthoritySnapshot() {}, async finalize() { throw new Error("metadata disk full"); } };
    const controller = new UiTestController({ tui, tuiObserver: observer, gui, authority: { kind: "gameforge-authority", async snapshot() { return { eventSequence: 0, capturedAt: new Date().toISOString() }; } }, evidence },
      { sessionId, mode: "headless", terminal: { columns: 80, rows: 24 }, tuiObserverViewport: { width: 800, height: 600 }, viewport: { width: 800, height: 600 }, observationHoldMs: 0, activityPollMs: 1, inactivityTimeoutMs: 100 });

    await expect(controller.run({ name: "double-failure", steps: [] })).resolves.toMatchObject({
      status: "failed",
      failure: "browser startup failed; Evidence finalization failed: metadata disk full",
    });
  });

  it("does not return before final evidence is committed", async () => {
    const sessionId = "slow-finalization-session";
    let finalized = false;
    const tui = { kind: "codearts-original-tui" as const, async start() { return tuiSnapshot(sessionId); }, async read() { return tuiSnapshot(sessionId); }, subscribeOutput() { return () => undefined; }, async sendText() {}, async sendKey() {}, async resize() {}, async stop() {} };
    const observer = { kind: "independent-xterm" as const, async open() { return observerSnapshot(sessionId); }, async snapshot() { return observerSnapshot(sessionId); }, async close() {} };
    const gui = { kind: "openchamber-original-gui" as const, async launch() {}, async navigate() {}, async click() {}, async fill() {}, async press() {}, async waitFor() {}, async snapshot() { return { url: "http://127.0.0.1/", title: "OpenChamber", capturedAt: new Date().toISOString(), diagnostics: { consoleErrors: [], pageErrors: [], failedRequests: [] } }; }, async close() {} };
    const evidence = { async recordSession() {}, async recordLifecycle() {}, async recordActivity() {}, async recordTuiInput() {}, async recordTuiOutput() {}, async recordTuiSnapshot() {}, async recordTuiObserverSnapshot() {}, async recordGuiSnapshot() {}, async recordAuthoritySnapshot() {}, async finalize() { await new Promise((resolve) => setTimeout(resolve, 30)); finalized = true; } };
    const controller = new UiTestController({ tui, tuiObserver: observer, gui, authority: { kind: "gameforge-authority", async snapshot() { return { eventSequence: 0, capturedAt: new Date().toISOString() }; } }, evidence },
      { sessionId, mode: "headless", terminal: { columns: 80, rows: 24 }, tuiObserverViewport: { width: 800, height: 600 }, viewport: { width: 800, height: 600 }, observationHoldMs: 0, activityPollMs: 1, inactivityTimeoutMs: 100, shutdownTimeoutMs: 10 });

    await expect(controller.run({ name: "slow-finalization", steps: [] })).resolves.toMatchObject({ status: "completed" });
    expect(finalized).toBe(true);
  });

  it("bounds hanging cleanup and still finalizes a failed result", async () => {
    const sessionId = "cleanup-timeout-session"; let finalized: HarnessResult | undefined;
    const tui = { kind: "codearts-original-tui" as const, async start() { return tuiSnapshot(sessionId); }, async read() { return tuiSnapshot(sessionId); }, subscribeOutput() { return () => undefined; }, async sendText() {}, async sendKey() {}, async resize() {}, async stop() {} };
    const observer = { kind: "independent-xterm" as const, async open() { return observerSnapshot(sessionId); }, async snapshot() { return observerSnapshot(sessionId); }, async close() {} };
    const gui = { kind: "openchamber-original-gui" as const, async launch() {}, async navigate() {}, async click() {}, async fill() {}, async press() {}, async waitFor() {}, async snapshot() { return { url: "http://127.0.0.1/", title: "OpenChamber", capturedAt: new Date().toISOString(), diagnostics: { consoleErrors: [], pageErrors: [], failedRequests: [] } }; }, async close() { await new Promise(() => undefined); } };
    const evidence = { async recordSession() {}, async recordLifecycle() {}, async recordActivity() {}, async recordTuiInput() {}, async recordTuiOutput() {}, async recordTuiSnapshot() {}, async recordTuiObserverSnapshot() {}, async recordGuiSnapshot() {}, async recordAuthoritySnapshot() {}, async finalize(result: HarnessResult) { finalized = result; } };
    const controller = new UiTestController({ tui, tuiObserver: observer, gui, authority: { kind: "gameforge-authority", async snapshot() { return { eventSequence: 0, capturedAt: new Date().toISOString() }; } }, evidence },
      { sessionId, mode: "headless", terminal: { columns: 80, rows: 24 }, tuiObserverViewport: { width: 800, height: 600 }, viewport: { width: 800, height: 600 }, observationHoldMs: 0, activityPollMs: 1, inactivityTimeoutMs: 100, shutdownTimeoutMs: 20 });

    await expect(controller.run({ name: "cleanup-timeout", steps: [] })).resolves.toMatchObject({ status: "failed", failure: expect.stringContaining("GUI cleanup timed out") });
    expect(finalized).toMatchObject({ status: "failed" });
  });

  it("continues cleanup when the final TUI evidence snapshot fails", async () => {
    const sessionId = "final-snapshot-failure"; let snapshots = 0; let stopped = false; let finalized: HarnessResult | undefined;
    const tui = { kind: "codearts-original-tui" as const, async start() { return tuiSnapshot(sessionId); }, async read() { return tuiSnapshot(sessionId); }, subscribeOutput() { return () => undefined; }, async sendText() {}, async sendKey() {}, async resize() {}, async stop() { stopped = true; } };
    const observer = { kind: "independent-xterm" as const, async open() { return observerSnapshot(sessionId); }, async snapshot() { return observerSnapshot(sessionId); }, async close() {} };
    const gui = { kind: "openchamber-original-gui" as const, async launch() {}, async navigate() {}, async click() {}, async fill() {}, async press() {}, async waitFor() {}, async snapshot() { return { url: "http://127.0.0.1/", title: "OpenChamber", capturedAt: new Date().toISOString(), diagnostics: { consoleErrors: [], pageErrors: [], failedRequests: [] } }; }, async close() {} };
    const evidence = { async recordSession() {}, async recordLifecycle() {}, async recordActivity() {}, async recordTuiInput() {}, async recordTuiOutput() {}, async recordTuiSnapshot() { snapshots += 1; if (snapshots > 1) throw new Error("final snapshot disk full"); }, async recordTuiObserverSnapshot() {}, async recordGuiSnapshot() {}, async recordAuthoritySnapshot() {}, async finalize(result: HarnessResult) { finalized = result; } };
    const controller = new UiTestController({ tui, tuiObserver: observer, gui, authority: { kind: "gameforge-authority", async snapshot() { return { eventSequence: 0, capturedAt: new Date().toISOString() }; } }, evidence },
      { sessionId, mode: "headless", terminal: { columns: 80, rows: 24 }, tuiObserverViewport: { width: 800, height: 600 }, viewport: { width: 800, height: 600 }, observationHoldMs: 0, activityPollMs: 1, inactivityTimeoutMs: 100 });

    await expect(controller.run({ name: "final-snapshot-failure", steps: [] })).resolves.toMatchObject({ status: "failed", failure: "final snapshot disk full" });
    expect(stopped).toBe(true);
    expect(finalized).toMatchObject({ status: "failed" });
  });

  it("holds headed windows open after a failure before tearing them down", async () => {
    const sessionId = "failure-hold"; const events: string[] = [];
    const tui = { kind: "codearts-original-tui" as const, async start() { return tuiSnapshot(sessionId); }, async read() { return tuiSnapshot(sessionId); }, subscribeOutput() { return () => undefined; }, async sendText() {}, async sendKey() {}, async resize() {}, async stop() { events.push("tui:stop"); } };
    const observer = { kind: "independent-xterm" as const, async open() { return observerSnapshot(sessionId); }, async snapshot() { return observerSnapshot(sessionId); }, async close() { events.push("observer:close"); } };
    const gui = { kind: "openchamber-original-gui" as const, async launch() {}, async navigate() { throw new Error("navigation failed"); }, async click() {}, async fill() {}, async press() {}, async waitFor() {}, async snapshot() { return { url: "http://127.0.0.1/", title: "OpenChamber", capturedAt: new Date().toISOString(), diagnostics: { consoleErrors: [], pageErrors: [], failedRequests: [] } }; }, async close() { events.push("gui:close"); } };
    const evidence = { async recordSession() {}, async recordLifecycle(event: { phase: string }) { events.push(`lifecycle:${event.phase}`); }, async recordActivity() {}, async recordTuiInput() {}, async recordTuiOutput() {}, async recordTuiSnapshot() {}, async recordTuiObserverSnapshot() {}, async recordGuiSnapshot() {}, async recordAuthoritySnapshot() {}, async finalize() {} };
    const controller = new UiTestController({ tui, tuiObserver: observer, gui, authority: { kind: "gameforge-authority", async snapshot() { return { eventSequence: 0, capturedAt: new Date().toISOString() }; } }, evidence },
      { sessionId, mode: "headed/watch", terminal: { columns: 80, rows: 24 }, tuiObserverViewport: { width: 800, height: 600 }, viewport: { width: 800, height: 600 }, observationHoldMs: 0, failureHoldMs: 30, activityPollMs: 1, inactivityTimeoutMs: 100 });

    const result = await controller.run({ name: "failure-hold", steps: [{ kind: "gui.navigate", url: "http://127.0.0.1/" }] });

    expect(result).toMatchObject({ status: "failed", failure: "navigation failed" });
    expect(events).toContain("lifecycle:observing");
    expect(events.indexOf("lifecycle:observing")).toBeLessThan(events.indexOf("gui:close"));
    expect(events.indexOf("lifecycle:observing")).toBeLessThan(events.indexOf("observer:close"));
    // The interrupted phase and the hold keep their own labels; their time
    // must not be misattributed to teardown on exactly the path timings exist for.
    expect(result.phases?.map((phase) => phase.label)).toEqual(["tui.start", "observer.open", "gui.launch", "steps", "hold", "teardown", "finalize"]);
  });

  it("reports and holds a headed failure discovered by the final GUI health snapshot", async () => {
    const sessionId = "final-gui-diagnostic-hold"; const events: string[] = []; let snapshots = 0;
    const tui = { kind: "codearts-original-tui" as const, async start() { return tuiSnapshot(sessionId); }, async read() { return tuiSnapshot(sessionId); }, subscribeOutput() { return () => undefined; }, async sendText() {}, async sendKey() {}, async resize() {}, async stop() {} };
    const observer = { kind: "independent-xterm" as const, async open() { return observerSnapshot(sessionId); }, async snapshot() { return observerSnapshot(sessionId); }, async close() {} };
    const gui = { kind: "openchamber-original-gui" as const, async launch() {}, async navigate() {}, async click() {}, async fill() {}, async press() {}, async waitFor() {}, async snapshot() { snapshots += 1; return { url: "http://127.0.0.1/", title: "OpenChamber", capturedAt: new Date().toISOString(), diagnostics: { consoleErrors: snapshots > 1 ? ["late failure"] : [], pageErrors: [], failedRequests: [] } }; }, async close() { events.push("gui:close"); } };
    const evidence = { async recordSession() {}, async recordLifecycle(event: { phase: string }) { events.push(`lifecycle:${event.phase}`); }, async recordActivity() {}, async recordTuiInput() {}, async recordTuiOutput() {}, async recordTuiSnapshot() {}, async recordTuiObserverSnapshot() {}, async recordGuiSnapshot() {}, async recordAuthoritySnapshot() {}, async finalize() {} };
    const controller = new UiTestController({ tui, tuiObserver: observer, gui, authority: { kind: "gameforge-authority", async snapshot() { return { eventSequence: 0, capturedAt: new Date().toISOString() }; } }, evidence },
      { sessionId, mode: "headed/watch", terminal: { columns: 80, rows: 24 }, tuiObserverViewport: { width: 800, height: 600 }, viewport: { width: 800, height: 600 }, observationHoldMs: 0, failureHoldMs: 1, activityPollMs: 1, inactivityTimeoutMs: 100, onFailureObserved: async () => { events.push("failure:reported"); } });

    await expect(controller.run({ name: "final-gui-diagnostic-hold", steps: [] })).resolves.toMatchObject({ status: "failed", failure: expect.stringContaining("browser diagnostics") });
    expect(events).toEqual(expect.arrayContaining(["failure:reported", "lifecycle:observing", "gui:close"]));
    expect(events.indexOf("failure:reported")).toBeLessThan(events.indexOf("lifecycle:observing"));
    expect(events.indexOf("lifecycle:observing")).toBeLessThan(events.indexOf("gui:close"));
  });

  it("carries the run tier into the evidence session it records", async () => {
    const sessionId = "tier-session"; let recorded: HarnessSession | undefined;
    const tui = { kind: "codearts-original-tui" as const, async start() { return tuiSnapshot(sessionId); }, async read() { return tuiSnapshot(sessionId); }, subscribeOutput() { return () => undefined; }, async sendText() {}, async sendKey() {}, async resize() {}, async stop() {} };
    const observer = { kind: "independent-xterm" as const, async open() { return observerSnapshot(sessionId); }, async snapshot() { return observerSnapshot(sessionId); }, async close() {} };
    const gui = { kind: "openchamber-original-gui" as const, async launch() {}, async navigate() {}, async click() {}, async fill() {}, async press() {}, async waitFor() {}, async snapshot() { return { url: "http://127.0.0.1/", title: "OpenChamber", capturedAt: new Date().toISOString(), diagnostics: { consoleErrors: [], pageErrors: [], failedRequests: [] } }; }, async close() {} };
    const evidence = { async recordSession(session: HarnessSession) { recorded = session; }, async recordLifecycle() {}, async recordActivity() {}, async recordTuiInput() {}, async recordTuiOutput() {}, async recordTuiSnapshot() {}, async recordTuiObserverSnapshot() {}, async recordGuiSnapshot() {}, async recordAuthoritySnapshot() {}, async finalize() {} };
    const controller = new UiTestController({ tui, tuiObserver: observer, gui, authority: { kind: "gameforge-authority", async snapshot() { return { eventSequence: 0, capturedAt: new Date().toISOString() }; } }, evidence },
      { sessionId, mode: "headless", tier: "readiness", terminal: { columns: 80, rows: 24 }, tuiObserverViewport: { width: 800, height: 600 }, viewport: { width: 800, height: 600 }, observationHoldMs: 0, activityPollMs: 1, inactivityTimeoutMs: 100 });

    await expect(controller.run({ name: "tier-session", steps: [] })).resolves.toMatchObject({ status: "completed" });
    expect(recorded?.tier).toBe("readiness");
  });

  it("fails a capture when the main CodeArts TUI has exited", async () => {
    const sessionId = "exited-at-capture";
    const tui = { kind: "codearts-original-tui" as const, async start() { return tuiSnapshot(sessionId); }, async read() { return { ...tuiSnapshot(sessionId), status: "exited" as const }; }, subscribeOutput() { return () => undefined; }, async sendText() {}, async sendKey() {}, async resize() {}, async stop() {} };
    const observer = { kind: "independent-xterm" as const, async open() { return observerSnapshot(sessionId); }, async snapshot() { return observerSnapshot(sessionId); }, async close() {} };
    const gui = { kind: "openchamber-original-gui" as const, async launch() {}, async navigate() {}, async click() {}, async fill() {}, async press() {}, async waitFor() {}, async snapshot() { return { url: "http://127.0.0.1/", title: "OpenChamber", capturedAt: new Date().toISOString(), diagnostics: { consoleErrors: [], pageErrors: [], failedRequests: [] } }; }, async close() {} };
    const evidence = { async recordSession() {}, async recordLifecycle() {}, async recordActivity() {}, async recordTuiInput() {}, async recordTuiOutput() {}, async recordTuiSnapshot() {}, async recordTuiObserverSnapshot() {}, async recordGuiSnapshot() {}, async recordAuthoritySnapshot() {}, async finalize() {} };
    const controller = new UiTestController({ tui, tuiObserver: observer, gui, authority: { kind: "gameforge-authority" as const, async snapshot() { return { eventSequence: 0, capturedAt: new Date().toISOString() }; } }, evidence },
      { sessionId, mode: "headless", terminal: { columns: 80, rows: 24 }, tuiObserverViewport: { width: 800, height: 600 }, viewport: { width: 800, height: 600 }, observationHoldMs: 0, activityPollMs: 1, inactivityTimeoutMs: 100 });

    const result = await controller.run({ name: "capture-liveness", steps: [{ kind: "capture", label: "readiness" }] });

    expect(result).toMatchObject({ status: "failed", failure: "CodeArts TUI is not running at capture: exited." });
  });

  it("includes bootstrap time in the first recorded phase", async () => {
    const sessionId = "bootstrap-timing";
    const startedAt = new Date(Date.now() - 100).toISOString();
    const tui = { kind: "codearts-original-tui" as const, async start() { return tuiSnapshot(sessionId); }, async read() { return tuiSnapshot(sessionId); }, subscribeOutput() { return () => undefined; }, async sendText() {}, async sendKey() {}, async resize() {}, async stop() {} };
    const observer = { kind: "independent-xterm" as const, async open() { return observerSnapshot(sessionId); }, async snapshot() { return observerSnapshot(sessionId); }, async close() {} };
    const gui = { kind: "openchamber-original-gui" as const, async launch() {}, async navigate() {}, async click() {}, async fill() {}, async press() {}, async waitFor() {}, async snapshot() { return { url: "http://127.0.0.1/", title: "OpenChamber", capturedAt: new Date().toISOString(), diagnostics: { consoleErrors: [], pageErrors: [], failedRequests: [] } }; }, async close() {} };
    const evidence = { async recordSession() {}, async recordLifecycle() {}, async recordActivity() {}, async recordTuiInput() {}, async recordTuiOutput() {}, async recordTuiSnapshot() {}, async recordTuiObserverSnapshot() {}, async recordGuiSnapshot() {}, async recordAuthoritySnapshot() {}, async finalize() {} };
    const controller = new UiTestController({ tui, tuiObserver: observer, gui, authority: { kind: "gameforge-authority" as const, async snapshot() { return { eventSequence: 0, capturedAt: new Date().toISOString() }; } }, evidence },
      { sessionId, startedAt, mode: "headless", terminal: { columns: 80, rows: 24 }, tuiObserverViewport: { width: 800, height: 600 }, viewport: { width: 800, height: 600 }, observationHoldMs: 0, activityPollMs: 1, inactivityTimeoutMs: 100 });

    const result = await controller.run({ name: "bootstrap-timing", steps: [] });

    expect(result.startedAt).toBe(startedAt);
    expect(result.phases?.[0]).toMatchObject({ label: "tui.start" });
    expect(result.phases?.[0]?.durationMs).toBeGreaterThanOrEqual(75);
  });

  it("records how long each run phase took", async () => {
    const sessionId = "phase-timings";
    const tui = { kind: "codearts-original-tui" as const, async start() { return tuiSnapshot(sessionId); }, async read() { return tuiSnapshot(sessionId); }, subscribeOutput() { return () => undefined; }, async sendText() {}, async sendKey() {}, async resize() {}, async stop() {} };
    const observer = { kind: "independent-xterm" as const, async open() { return observerSnapshot(sessionId); }, async snapshot() { return observerSnapshot(sessionId); }, async close() {} };
    const gui = { kind: "openchamber-original-gui" as const, async launch() {}, async navigate() {}, async click() {}, async fill() {}, async press() {}, async waitFor() {}, async snapshot() { return { url: "http://127.0.0.1/", title: "OpenChamber", capturedAt: new Date().toISOString(), diagnostics: { consoleErrors: [], pageErrors: [], failedRequests: [] } }; }, async close() {} };
    const evidence = { async recordSession() {}, async recordLifecycle() {}, async recordActivity() {}, async recordTuiInput() {}, async recordTuiOutput() {}, async recordTuiSnapshot() {}, async recordTuiObserverSnapshot() {}, async recordGuiSnapshot() {}, async recordAuthoritySnapshot() {}, async finalize() {} };
    const controller = new UiTestController({ tui, tuiObserver: observer, gui, authority: { kind: "gameforge-authority", async snapshot() { return { eventSequence: 0, capturedAt: new Date().toISOString() }; } }, evidence },
      { sessionId, mode: "headless", terminal: { columns: 80, rows: 24 }, tuiObserverViewport: { width: 800, height: 600 }, viewport: { width: 800, height: 600 }, observationHoldMs: 0, activityPollMs: 1, inactivityTimeoutMs: 100 });

    const result = await controller.run({ name: "phase-timings", steps: [] });

    expect(result.status).toBe("completed");
    expect(result.phases?.map((phase) => phase.label)).toEqual(["tui.start", "observer.open", "gui.launch", "steps", "teardown", "finalize"]);
    for (const phase of result.phases ?? []) {
      expect(Number.isSafeInteger(phase.durationMs)).toBe(true);
      expect(phase.durationMs).toBeGreaterThanOrEqual(0);
    }
  });

  it("includes evidence finalization in the reported run phases", async () => {
    const sessionId = "finalize-phase-timing"; let committed: HarnessResult | undefined;
    const tui = { kind: "codearts-original-tui" as const, async start() { return tuiSnapshot(sessionId); }, async read() { return tuiSnapshot(sessionId); }, subscribeOutput() { return () => undefined; }, async sendText() {}, async sendKey() {}, async resize() {}, async stop() {} };
    const observer = { kind: "independent-xterm" as const, async open() { return observerSnapshot(sessionId); }, async snapshot() { return observerSnapshot(sessionId); }, async close() {} };
    const gui = { kind: "openchamber-original-gui" as const, async launch() {}, async navigate() {}, async click() {}, async fill() {}, async press() {}, async waitFor() {}, async snapshot() { return { url: "http://127.0.0.1/", title: "OpenChamber", capturedAt: new Date().toISOString(), diagnostics: { consoleErrors: [], pageErrors: [], failedRequests: [] } }; }, async close() {} };
    const evidence = { async recordSession() {}, async recordLifecycle() {}, async recordActivity() {}, async recordTuiInput() {}, async recordTuiOutput() {}, async recordTuiSnapshot() {}, async recordTuiObserverSnapshot() {}, async recordGuiSnapshot() {}, async recordAuthoritySnapshot() {}, async finalize(result: HarnessResult, beforeCommit?: () => void) { await new Promise((resolve) => setTimeout(resolve, 120)); beforeCommit?.(); committed = structuredClone(result); } };
    const controller = new UiTestController({ tui, tuiObserver: observer, gui, authority: { kind: "gameforge-authority", async snapshot() { return { eventSequence: 0, capturedAt: new Date().toISOString() }; } }, evidence },
      { sessionId, mode: "headless", terminal: { columns: 80, rows: 24 }, tuiObserverViewport: { width: 800, height: 600 }, viewport: { width: 800, height: 600 }, observationHoldMs: 0, activityPollMs: 1, inactivityTimeoutMs: 100 });

    const result = await controller.run({ name: "finalize-phase-timing", steps: [] });

    expect(result.phases?.at(-1)).toMatchObject({ label: "finalize" });
    expect(result.phases?.at(-1)?.durationMs).toBeGreaterThanOrEqual(100);
    expect(committed?.phases?.at(-1)).toMatchObject({ label: "finalize" });
    expect(committed?.phases?.at(-1)?.durationMs).toBeGreaterThanOrEqual(100);
  });

  it("notifies the failure observer before the hold and before teardown", async () => {
    const sessionId = "failure-observer"; const events: string[] = [];
    const tui = { kind: "codearts-original-tui" as const, async start() { return tuiSnapshot(sessionId); }, async read() { return tuiSnapshot(sessionId); }, subscribeOutput() { return () => undefined; }, async sendText() {}, async sendKey() {}, async resize() {}, async stop() {} };
    const observer = { kind: "independent-xterm" as const, async open() { return observerSnapshot(sessionId); }, async snapshot() { return observerSnapshot(sessionId); }, async close() { events.push("observer:close"); } };
    const gui = { kind: "openchamber-original-gui" as const, async launch() {}, async navigate() { throw new Error("navigation failed"); }, async click() {}, async fill() {}, async press() {}, async waitFor() {}, async snapshot() { return { url: "http://127.0.0.1/", title: "OpenChamber", capturedAt: new Date().toISOString(), diagnostics: { consoleErrors: [], pageErrors: [], failedRequests: [] } }; }, async close() { events.push("gui:close"); } };
    const evidence = { async recordSession() {}, async recordLifecycle(event: { phase: string }) { events.push(`lifecycle:${event.phase}`); }, async recordActivity() {}, async recordTuiInput() {}, async recordTuiOutput() {}, async recordTuiSnapshot() {}, async recordTuiObserverSnapshot() {}, async recordGuiSnapshot() {}, async recordAuthoritySnapshot() {}, async finalize() {} };
    const controller = new UiTestController({ tui, tuiObserver: observer, gui, authority: { kind: "gameforge-authority", async snapshot() { return { eventSequence: 0, capturedAt: new Date().toISOString() }; } }, evidence },
      { sessionId, mode: "headed/watch", terminal: { columns: 80, rows: 24 }, tuiObserverViewport: { width: 800, height: 600 }, viewport: { width: 800, height: 600 }, observationHoldMs: 0, failureHoldMs: 20, activityPollMs: 1, inactivityTimeoutMs: 100,
        onFailureObserved: (message) => { events.push(`observed:${message}`); } });

    await expect(controller.run({ name: "failure-observer", steps: [{ kind: "gui.navigate", url: "http://127.0.0.1/" }] })).resolves.toMatchObject({ status: "failed" });

    const observedIndex = events.indexOf("observed:navigation failed");
    expect(observedIndex).toBeGreaterThanOrEqual(0);
    expect(observedIndex).toBeLessThan(events.indexOf("lifecycle:observing"));
    expect(observedIndex).toBeLessThan(events.indexOf("gui:close"));
    expect(observedIndex).toBeLessThan(events.indexOf("observer:close"));
  });

  it("rejects a failure hold long enough to strand an unattended run", async () => {
    const sessionId = "failure-hold-bound";
    const tui = { kind: "codearts-original-tui" as const, async start() { return tuiSnapshot(sessionId); }, async read() { return tuiSnapshot(sessionId); }, subscribeOutput() { return () => undefined; }, async sendText() {}, async sendKey() {}, async resize() {}, async stop() {} };
    const observer = { kind: "independent-xterm" as const, async open() { return observerSnapshot(sessionId); }, async snapshot() { return observerSnapshot(sessionId); }, async close() {} };
    const gui = { kind: "openchamber-original-gui" as const, async launch() {}, async navigate() {}, async click() {}, async fill() {}, async press() {}, async waitFor() {}, async snapshot() { return { url: "http://127.0.0.1/", title: "OpenChamber", capturedAt: new Date().toISOString(), diagnostics: { consoleErrors: [], pageErrors: [], failedRequests: [] } }; }, async close() {} };
    const evidence = { async recordSession() {}, async recordLifecycle() {}, async recordActivity() {}, async recordTuiInput() {}, async recordTuiOutput() {}, async recordTuiSnapshot() {}, async recordTuiObserverSnapshot() {}, async recordGuiSnapshot() {}, async recordAuthoritySnapshot() {}, async finalize() {} };
    const controller = new UiTestController({ tui, tuiObserver: observer, gui, authority: { kind: "gameforge-authority", async snapshot() { return { eventSequence: 0, capturedAt: new Date().toISOString() }; } }, evidence },
      { sessionId, mode: "headed/watch", terminal: { columns: 80, rows: 24 }, tuiObserverViewport: { width: 800, height: 600 }, viewport: { width: 800, height: 600 }, observationHoldMs: 0, failureHoldMs: 3_600_000, activityPollMs: 1, inactivityTimeoutMs: 100 });

    await expect(controller.run({ name: "failure-hold-bound", steps: [] })).rejects.toThrow("failureHoldMs");
  });

  it("does not hold windows open after a headless failure", async () => {
    const sessionId = "failure-hold-headless"; const events: string[] = [];
    const tui = { kind: "codearts-original-tui" as const, async start() { return tuiSnapshot(sessionId); }, async read() { return tuiSnapshot(sessionId); }, subscribeOutput() { return () => undefined; }, async sendText() {}, async sendKey() {}, async resize() {}, async stop() {} };
    const observer = { kind: "independent-xterm" as const, async open() { return observerSnapshot(sessionId); }, async snapshot() { return observerSnapshot(sessionId); }, async close() {} };
    const gui = { kind: "openchamber-original-gui" as const, async launch() {}, async navigate() { throw new Error("navigation failed"); }, async click() {}, async fill() {}, async press() {}, async waitFor() {}, async snapshot() { return { url: "http://127.0.0.1/", title: "OpenChamber", capturedAt: new Date().toISOString(), diagnostics: { consoleErrors: [], pageErrors: [], failedRequests: [] } }; }, async close() {} };
    const evidence = { async recordSession() {}, async recordLifecycle(event: { phase: string }) { events.push(event.phase); }, async recordActivity() {}, async recordTuiInput() {}, async recordTuiOutput() {}, async recordTuiSnapshot() {}, async recordTuiObserverSnapshot() {}, async recordGuiSnapshot() {}, async recordAuthoritySnapshot() {}, async finalize() {} };
    const controller = new UiTestController({ tui, tuiObserver: observer, gui, authority: { kind: "gameforge-authority", async snapshot() { return { eventSequence: 0, capturedAt: new Date().toISOString() }; } }, evidence },
      { sessionId, mode: "headless", terminal: { columns: 80, rows: 24 }, tuiObserverViewport: { width: 800, height: 600 }, viewport: { width: 800, height: 600 }, observationHoldMs: 0, failureHoldMs: 30, activityPollMs: 1, inactivityTimeoutMs: 100 });

    await expect(controller.run({ name: "failure-hold-headless", steps: [{ kind: "gui.navigate", url: "http://127.0.0.1/" }] })).resolves.toMatchObject({ status: "failed" });
    expect(events).not.toContain("observing");
  });
});

function tuiSnapshot(sessionId: string): TuiSnapshot {
  return { sessionId, status: "running", columns: 120, rows: 36, outputSequence: 1, lastChangedAt: new Date().toISOString(), screen: "CodeArts" };
}

function observerSnapshot(sessionId: string): TuiObserverSnapshot {
  return { kind: "independent-xterm", sessionId, visible: true, status: "open", title: "CodeArts TUI", capturedAt: new Date().toISOString() };
}
