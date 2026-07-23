import { randomUUID } from "node:crypto";
import type {
  ActivitySample,
  AuthorityGate,
  CodeArtsTuiDriver,
  CodeArtsTuiObserverDriver,
  EvidenceSink,
  GameForgeAuthorityDriver,
  HarnessOptions,
  HarnessPhase,
  HarnessResult,
  HarnessScenario,
  HarnessSession,
  HarnessStep,
  OpenChamberGuiDriver,
} from "./contracts.js";
import { compareActivity, inactiveForMs } from "./watchdog.js";

export type HarnessDrivers = {
  tui: CodeArtsTuiDriver;
  tuiObserver: CodeArtsTuiObserverDriver;
  gui: OpenChamberGuiDriver;
  authority: GameForgeAuthorityDriver;
  evidence: EvidenceSink;
  projectFingerprint?(): Promise<string>;
};

export class UiTestController {
  constructor(
    private readonly drivers: HarnessDrivers,
    private readonly options: HarnessOptions,
  ) {}

  async run(scenario: HarnessScenario): Promise<HarnessResult> {
    const startedAt = new Date().toISOString();
    const session: HarnessSession = { sessionId: this.options.sessionId ?? randomUUID(), startedAt, mode: this.options.mode,
      ...(this.options.taskId === undefined ? {} : { taskId: this.options.taskId }), ...(this.options.runId === undefined ? {} : { runId: this.options.runId }),
      ...(this.options.projectId === undefined ? {} : { projectId: this.options.projectId }) };
    await this.drivers.evidence.recordSession(session);
    await this.recordLifecycle(session, "starting");
    let failure: unknown;
    let tuiStarted = false;
    let observerOpened = false;
    let guiLaunched = false;
    let failureCaptured = false;
    let unsubscribeOutput: (() => void) | undefined;

    try {
      unsubscribeOutput = this.drivers.tui.subscribeOutput((frame) => {
        void this.drivers.evidence.recordTuiOutput(frame);
      });
      tuiStarted = true;
      const tui = await this.drivers.tui.start({ session, ...this.options.terminal });
      this.assertTuiSession(session, tui.sessionId);
      await this.drivers.evidence.recordTuiSnapshot(tui);
      const observer = await this.drivers.tuiObserver.open({
        session,
        source: this.drivers.tui,
        visible: this.options.mode === "headed/watch",
        viewport: this.options.tuiObserverViewport,
      });
      observerOpened = true;
      this.assertTuiSession(session, observer.sessionId);
      await this.drivers.evidence.recordTuiObserverSnapshot(observer);
      guiLaunched = true;
      await this.drivers.gui.launch({ session, mode: this.options.mode, viewport: this.options.viewport });
      await this.captureGui(session, "loaded");
      await this.recordLifecycle(session, "running");

      for (const step of scenario.steps) await this.execute(session, step);

      if (this.options.mode === "headed/watch" && this.options.observationHoldMs > 0) {
        await this.recordLifecycle(session, "observing");
        await delay(this.options.observationHoldMs);
      }
    } catch (error) {
      failure = error;
      if (guiLaunched) { await this.captureGui(session, "failed").catch(() => undefined); failureCaptured = true; }
    }

    if (tuiStarted) {
      const finalTui = await this.drivers.tui.read().catch(() => undefined);
      if (finalTui !== undefined) await this.drivers.evidence.recordTuiSnapshot(finalTui);
    }
    if (guiLaunched && failure === undefined) await this.captureGui(session, "success", true).catch((error) => { failure = error; });
    if (guiLaunched && failure !== undefined && !failureCaptured) await this.captureGui(session, "failed").catch(() => undefined);
    await this.recordLifecycle(session, "stopping");
    const cleanup = await Promise.allSettled([
      guiLaunched ? this.drivers.gui.close() : Promise.resolve(),
      observerOpened ? this.drivers.tuiObserver.close() : Promise.resolve(),
      tuiStarted ? this.drivers.tui.stop(failure === undefined ? "completed" : "failed") : Promise.resolve(),
    ]);
    const cleanupFailure = cleanup.find((result) => result.status === "rejected");
    unsubscribeOutput?.();
    if (failure === undefined && cleanupFailure?.status === "rejected") failure = cleanupFailure.reason;

    const result: HarnessResult = {
      status: failure === undefined ? "completed" : "failed",
      scenario: scenario.name,
      startedAt,
      finishedAt: new Date().toISOString(),
      ...(failure === undefined ? {} : { failure: errorMessage(failure) }),
    };
    await this.recordLifecycle(session, result.status);
    await this.drivers.evidence.finalize(result);
    return result;
  }

  private async execute(session: HarnessSession, step: HarnessStep): Promise<void> {
    switch (step.kind) {
      case "tui.text":
        await this.drivers.tui.sendText(step.text, { appendEnter: step.appendEnter });
        await this.drivers.evidence.recordTuiInput({ kind: "text", value: step.text, at: new Date().toISOString() });
        return;
      case "tui.key":
        await this.drivers.tui.sendKey(step.key);
        await this.drivers.evidence.recordTuiInput({ kind: "key", value: step.key, at: new Date().toISOString() });
        return;
      case "tui.resize":
        await this.drivers.tui.resize(step.columns, step.rows);
        return;
      case "gui.navigate":
        await this.captureGui(session, "before-interaction");
        await this.drivers.gui.navigate(step.url);
        await this.captureGui(session, "after-interaction");
        return;
      case "gui.click":
        await this.captureGui(session, "before-interaction");
        await this.drivers.gui.click(step.selector);
        await this.captureGui(session, "after-interaction");
        return;
      case "gui.fill":
        await this.captureGui(session, "before-interaction");
        await this.drivers.gui.fill(step.selector, step.value);
        await this.captureGui(session, "after-interaction");
        return;
      case "gui.press":
        await this.captureGui(session, "before-interaction");
        await this.drivers.gui.press(step.selector, step.key);
        await this.captureGui(session, "after-interaction");
        return;
      case "capture": {
        const [tui, gui, authority] = await Promise.all([
          this.drivers.tui.read(),
          this.drivers.gui.snapshot(step.label),
          this.drivers.authority.snapshot(),
        ]);
        this.assertTuiSession(session, tui.sessionId);
        const observer = await this.drivers.tuiObserver.snapshot();
        this.assertTuiSession(session, observer.sessionId);
        await Promise.all([
          this.drivers.evidence.recordTuiSnapshot(tui),
          this.drivers.evidence.recordTuiObserverSnapshot(observer),
          this.drivers.evidence.recordGuiSnapshot(step.label, { ...gui, sessionId: session.sessionId, ...(session.runId === undefined ? {} : { runId: session.runId }) }),
          this.drivers.evidence.recordAuthoritySnapshot({ ...authority, sessionId: session.sessionId }),
        ]);
        return;
      }
      case "authority.wait":
        await this.waitForAuthority(session, step.gate);
    }
  }

  private async waitForAuthority(session: HarnessSession, gate: AuthorityGate): Promise<void> {
    const startedAt = Date.now();
    let lastActivityAt = startedAt;
    let previous = await this.sampleActivity(session);
    await this.drivers.evidence.recordActivity(previous);

    while (Date.now() - startedAt <= gate.timeoutMs) {
      const authority = await this.drivers.authority.snapshot();
      await this.drivers.evidence.recordAuthoritySnapshot({ ...authority, sessionId: session.sessionId });
      if (gate.accepts(authority)) return;

      await delay(this.options.activityPollMs);
      const current = await this.sampleActivity(session);
      await this.drivers.evidence.recordActivity(current);
      if (compareActivity(previous, current).active) lastActivityAt = Date.now();
      if (inactiveForMs(lastActivityAt, Date.now()) >= this.options.inactivityTimeoutMs) {
        throw new Error(`Activity watchdog timed out while waiting for: ${gate.description}`);
      }
      previous = current;
    }
    throw new Error(`Authority gate timed out: ${gate.description}`);
  }

  private async sampleActivity(session: HarnessSession): Promise<ActivitySample> {
    const [tui, authority, projectFingerprint] = await Promise.all([
      this.drivers.tui.read(),
      this.drivers.authority.snapshot(),
      this.drivers.projectFingerprint?.(),
    ]);
    return {
      sessionId: session.sessionId,
      sampledAt: new Date().toISOString(),
      tuiOutputSequence: tui.outputSequence,
      authorityEventSequence: authority.eventSequence,
      ...(authority.lastEventType === undefined ? {} : { authorityEventType: authority.lastEventType }),
      ...(projectFingerprint === undefined ? {} : { projectFingerprint }),
    };
  }

  private async captureGui(session: HarnessSession, label: string, requireHealthy = false): Promise<void> {
    const snapshot = await this.drivers.gui.snapshot(label);
    await this.drivers.evidence.recordGuiSnapshot(label, { ...snapshot, sessionId: session.sessionId,
      ...(session.runId === undefined ? {} : { runId: session.runId }) });
    if (requireHealthy) {
      const count = snapshot.diagnostics.consoleErrors.length + snapshot.diagnostics.pageErrors.length + snapshot.diagnostics.failedRequests.length;
      if (count > 0) throw new Error(`OpenChamber browser diagnostics are not clean: ${count} issue(s)`);
    }
  }

  private async recordLifecycle(session: HarnessSession, phase: HarnessPhase): Promise<void> {
    await this.drivers.evidence.recordLifecycle({ sessionId: session.sessionId, phase, at: new Date().toISOString() });
  }

  private assertTuiSession(session: HarnessSession, observedSessionId: string): void {
    if (observedSessionId !== session.sessionId) {
      throw new Error(`TUI session mismatch: expected ${session.sessionId}, received ${observedSessionId}`);
    }
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
