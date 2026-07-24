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

const MAX_GUI_WAIT_TIMEOUT_MS = 900_000;
const DEFAULT_SHUTDOWN_TIMEOUT_MS = 10_000;
const MAX_PENDING_TUI_OUTPUT_FRAMES = 1_024;

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
    let failure: unknown;
    let tuiStarted = false;
    let observerOpened = false;
    let guiLaunched = false;
    let failureCaptured = false;
    let unsubscribeOutput: (() => void) | undefined;
    let outputQueue = Promise.resolve();
    let outputFailure: unknown;
    let pendingOutputFrames = 0;
    const shutdownTimeoutMs = this.options.shutdownTimeoutMs ?? DEFAULT_SHUTDOWN_TIMEOUT_MS;
    if (!Number.isSafeInteger(shutdownTimeoutMs) || shutdownTimeoutMs < 1 || shutdownTimeoutMs > 60_000) {
      throw new Error("Harness shutdownTimeoutMs must be an integer between 1 and 60000.");
    }

    try {
      await this.drivers.evidence.recordSession(session);
      await this.recordLifecycle(session, "starting");
      unsubscribeOutput = this.drivers.tui.subscribeOutput((frame) => {
        if (pendingOutputFrames >= MAX_PENDING_TUI_OUTPUT_FRAMES) {
          outputFailure ??= new Error(`TUI output evidence queue exceeded ${MAX_PENDING_TUI_OUTPUT_FRAMES} pending frames.`);
          return;
        }
        pendingOutputFrames += 1;
        outputQueue = outputQueue.then(async () => {
          try {
            await this.drivers.evidence.recordTuiOutput(frame);
          } catch (error) {
            outputFailure ??= error;
          } finally {
            pendingOutputFrames -= 1;
          }
        });
      });
      tuiStarted = true;
      const tui = await this.drivers.tui.start({ session, ...this.options.terminal });
      this.assertTuiSession(session, tui.sessionId);
      await this.drivers.evidence.recordTuiSnapshot(tui);
      observerOpened = true;
      const observer = await this.drivers.tuiObserver.open({
        session,
        source: this.drivers.tui,
        visible: this.options.mode === "headed/watch",
        viewport: this.options.tuiObserverViewport,
      });
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

    try { await withTimeout(outputQueue, shutdownTimeoutMs, "TUI output drain"); }
    catch (error) { failure = combineFailure(failure, "TUI output drain failed", error); }
    if (outputFailure !== undefined) {
      failure = combineFailure(failure, "TUI output evidence failed", outputFailure);
      outputFailure = undefined;
    }
    if (tuiStarted) {
      try {
        const finalTui = await withTimeout(this.drivers.tui.read(), shutdownTimeoutMs, "Final TUI read");
        await withTimeout(this.drivers.evidence.recordTuiSnapshot(finalTui), shutdownTimeoutMs, "Final TUI evidence");
      } catch (error) {
        failure = combineFailure(failure, "Final TUI evidence failed", error);
      }
    }
    if (guiLaunched && failure === undefined) await this.captureGui(session, "success", true).catch((error) => { failure = error; });
    if (guiLaunched && failure !== undefined && !failureCaptured) await this.captureGui(session, "failed").catch(() => undefined);
    try {
      await withTimeout(this.recordLifecycle(session, "stopping"), shutdownTimeoutMs, "Stopping lifecycle evidence");
    } catch (error) {
      failure ??= error;
    }
    const cleanup = await Promise.allSettled([
      guiLaunched ? withTimeout(this.drivers.gui.close(), shutdownTimeoutMs, "GUI cleanup") : Promise.resolve(),
      observerOpened ? withTimeout(this.drivers.tuiObserver.close(), shutdownTimeoutMs, "TUI observer cleanup") : Promise.resolve(),
      tuiStarted ? withTimeout(this.drivers.tui.stop(failure === undefined ? "completed" : "failed"), shutdownTimeoutMs, "TUI cleanup") : Promise.resolve(),
    ]);
    const cleanupFailure = cleanup.find((result) => result.status === "rejected");
    unsubscribeOutput?.();
    try { await withTimeout(outputQueue, shutdownTimeoutMs, "Shutdown TUI output drain"); }
    catch (error) { failure = combineFailure(failure, "Shutdown TUI output drain failed", error); }
    if (outputFailure !== undefined) {
      failure = combineFailure(failure, "TUI output evidence failed", outputFailure);
      outputFailure = undefined;
    }
    if (cleanupFailure?.status === "rejected") failure = combineFailure(failure, "Cleanup failed", cleanupFailure.reason);

    let result: HarnessResult = {
      status: failure === undefined ? "completed" : "failed",
      scenario: scenario.name,
      startedAt,
      finishedAt: new Date().toISOString(),
      ...(failure === undefined ? {} : { failure: errorMessage(failure) }),
    };
    try {
      await withTimeout(this.recordLifecycle(session, result.status), shutdownTimeoutMs, "Final lifecycle evidence");
    } catch (error) {
      failure ??= error;
    }
    if (failure !== undefined && result.status === "completed") {
      result = { ...result, status: "failed", finishedAt: new Date().toISOString(), failure: errorMessage(failure) };
    } else if (failure !== undefined && result.failure === undefined) {
      result = { ...result, failure: errorMessage(failure) };
    }
    try {
      await this.drivers.evidence.finalize(result);
    } catch (error) {
      if (result.status === "completed") {
        result = { ...result, status: "failed", finishedAt: new Date().toISOString(), failure: errorMessage(error) };
      } else {
        result = { ...result, finishedAt: new Date().toISOString(), failure: `${result.failure ?? "Scenario failed"}; Evidence finalization failed: ${errorMessage(error)}` };
      }
    }
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
      case "gui.wait":
        if (!Number.isSafeInteger(step.options.timeoutMs) || step.options.timeoutMs <= 0) {
          throw new Error("GUI wait timeout must be a positive safe integer.");
        }
        if (step.options.timeoutMs > MAX_GUI_WAIT_TIMEOUT_MS) {
          throw new Error(`GUI wait timeout must not exceed ${MAX_GUI_WAIT_TIMEOUT_MS} milliseconds.`);
        }
        await this.drivers.gui.waitFor(step.selector, step.options);
        await this.captureGui(session, "after-gui-wait");
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
    const deadline = startedAt + gate.timeoutMs;
    let lastActivityAt = startedAt;
    let previous = await this.withAuthorityDeadline(() => this.sampleActivity(session), deadline, gate.description);
    await this.withAuthorityDeadline(() => this.drivers.evidence.recordActivity(previous), deadline, gate.description);

    while (Date.now() <= deadline) {
      const authority = await this.withAuthorityDeadline(() => this.drivers.authority.snapshot(), deadline, gate.description);
      await this.withAuthorityDeadline(
        () => this.drivers.evidence.recordAuthoritySnapshot({ ...authority, sessionId: session.sessionId }),
        deadline,
        gate.description,
      );
      if (Date.now() > deadline) {
        throw new Error(`Authority gate timed out: ${gate.description}`);
      }
      if (gate.accepts(authority)) return;

      await this.withAuthorityDeadline(() => delay(this.options.activityPollMs), deadline, gate.description);
      const current = await this.withAuthorityDeadline(() => this.sampleActivity(session), deadline, gate.description);
      await this.withAuthorityDeadline(() => this.drivers.evidence.recordActivity(current), deadline, gate.description);
      if (compareActivity(previous, current).active) lastActivityAt = Date.now();
      if (inactiveForMs(lastActivityAt, Date.now()) >= this.options.inactivityTimeoutMs) {
        throw new Error(`Activity watchdog timed out while waiting for: ${gate.description}`);
      }
      previous = current;
    }
    throw new Error(`Authority gate timed out: ${gate.description}`);
  }

  private async withAuthorityDeadline<T>(operation: () => Promise<T>, deadline: number, description: string): Promise<T> {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error(`Authority gate timed out: ${description}`);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        operation(),
        new Promise<T>((_, reject) => {
          timer = setTimeout(() => reject(new Error(`Authority gate timed out: ${description}`)), remaining);
        }),
      ]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
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

function combineFailure(primary: unknown, context: string, secondary: unknown): unknown {
  if (primary === undefined) return secondary;
  return new Error(`${errorMessage(primary)}; ${context}: ${errorMessage(secondary)}`);
}

async function withTimeout<T>(operation: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<T>((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs} milliseconds.`)), timeoutMs); }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
