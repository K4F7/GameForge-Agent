export const tuiKeys = [
  "enter",
  "escape",
  "up",
  "down",
  "left",
  "right",
  "tab",
  "backspace",
  "delete",
  "home",
  "end",
  "page-up",
  "page-down",
  "ctrl-c",
  "ctrl-d",
  "ctrl-l",
] as const;

export type TuiKey = (typeof tuiKeys)[number];
export type HarnessMode = "headed/watch" | "headless";
export type HarnessPhase = "idle" | "starting" | "running" | "observing" | "stopping" | "completed" | "failed";

export type HarnessSession = {
  sessionId: string;
  startedAt: string;
  mode: HarnessMode;
  taskId?: string;
  runId?: string;
  projectId?: string;
};

export type TuiOutputFrame = {
  sessionId: string;
  sequence: number;
  data: string;
};

export type TuiSnapshot = {
  sessionId: string;
  status: "starting" | "running" | "exited" | "failed";
  columns: number;
  rows: number;
  outputSequence: number;
  lastChangedAt: string;
  screen: string;
};

export type GuiDiagnostics = {
  consoleErrors: readonly string[];
  pageErrors: readonly string[];
  failedRequests: readonly string[];
};

export type GuiSnapshot = {
  sessionId?: string;
  runId?: string;
  url: string;
  title: string;
  capturedAt: string;
  diagnostics: GuiDiagnostics;
  screenshotPath?: string;
};

export type GuiWaitState = "attached" | "detached" | "visible" | "hidden";
export type GuiWaitOptions = { state: GuiWaitState; timeoutMs: number };

export type TuiObserverSnapshot = {
  kind: "independent-xterm";
  sessionId: string;
  visible: boolean;
  status: "opening" | "open" | "closed" | "failed";
  title: string;
  capturedAt: string;
};

export type AuthoritySnapshot = {
  sessionId?: string;
  taskId?: string;
  runId?: string;
  projectId?: string;
  taskStatus?: string;
  runStatus?: string;
  eventSequence: number;
  lastEventType?: string;
  capturedAt: string;
};

export interface CodeArtsTuiDriver {
  readonly kind: "codearts-original-tui";
  start(options: { session: HarnessSession; columns: number; rows: number }): Promise<TuiSnapshot>;
  read(): Promise<TuiSnapshot>;
  /**
   * With replayBuffered, the driver first delivers its bounded VT history as
   * one synthetic frame (original session id, current sequence) before live
   * frames, so a late subscriber still sees startup output. Evidence
   * subscribers must NOT request replay - they subscribe before start and a
   * replay would duplicate frames into the VT log.
   */
  subscribeOutput(listener: (frame: TuiOutputFrame) => void, options?: { replayBuffered?: boolean }): () => void;
  sendText(text: string, options: { appendEnter: boolean }): Promise<void>;
  sendKey(key: TuiKey): Promise<void>;
  resize(columns: number, rows: number): Promise<void>;
  stop(reason: "completed" | "failed" | "cancelled"): Promise<void>;
}

export interface CodeArtsTuiObserverDriver {
  readonly kind: "independent-xterm";
  open(options: {
    session: HarnessSession;
    source: CodeArtsTuiDriver;
    visible: boolean;
    viewport: { width: number; height: number };
  }): Promise<TuiObserverSnapshot>;
  snapshot(): Promise<TuiObserverSnapshot>;
  close(): Promise<void>;
}

export interface OpenChamberGuiDriver {
  readonly kind: "openchamber-original-gui";
  launch(options: { session: HarnessSession; mode: HarnessMode; viewport: { width: number; height: number } }): Promise<void>;
  navigate(url: string): Promise<void>;
  click(selector: string): Promise<void>;
  fill(selector: string, value: string): Promise<void>;
  press(selector: string, key: string): Promise<void>;
  waitFor(selector: string, options: GuiWaitOptions): Promise<void>;
  snapshot(label: string): Promise<GuiSnapshot>;
  close(): Promise<void>;
}

export interface GameForgeAuthorityDriver {
  readonly kind: "gameforge-authority";
  snapshot(): Promise<AuthoritySnapshot>;
}

export type ActivitySample = {
  sessionId?: string;
  sampledAt: string;
  tuiOutputSequence: number;
  authorityEventSequence: number;
  authorityEventType?: string;
  projectFingerprint?: string;
};

export interface EvidenceSink {
  recordSession(session: HarnessSession): Promise<void>;
  recordLifecycle(event: { sessionId: string; phase: HarnessPhase; at: string; detail?: string }): Promise<void>;
  recordActivity(sample: ActivitySample): Promise<void>;
  recordTuiInput(input: { kind: "text" | "key"; value: string; at: string }): Promise<void>;
  recordTuiOutput(frame: TuiOutputFrame): Promise<void>;
  recordTuiSnapshot(snapshot: TuiSnapshot): Promise<void>;
  recordTuiObserverSnapshot(snapshot: TuiObserverSnapshot): Promise<void>;
  recordGuiSnapshot(label: string, snapshot: GuiSnapshot): Promise<void>;
  recordAuthoritySnapshot(snapshot: AuthoritySnapshot): Promise<void>;
  finalize(result: HarnessResult): Promise<void>;
}

export type AuthorityGate = {
  description: string;
  timeoutMs: number;
  accepts(snapshot: AuthoritySnapshot): boolean;
};

export type HarnessStep =
  | { kind: "tui.text"; text: string; appendEnter: boolean }
  | { kind: "tui.key"; key: TuiKey }
  | { kind: "tui.resize"; columns: number; rows: number }
  | { kind: "gui.navigate"; url: string }
  | { kind: "gui.click"; selector: string }
  | { kind: "gui.fill"; selector: string; value: string }
  | { kind: "gui.press"; selector: string; key: string }
  | { kind: "gui.wait"; selector: string; options: GuiWaitOptions }
  | { kind: "capture"; label: string }
  | { kind: "authority.wait"; gate: AuthorityGate };

export type HarnessScenario = {
  name: string;
  steps: readonly HarnessStep[];
};

export type HarnessOptions = {
  sessionId?: string;
  mode: HarnessMode;
  terminal: { columns: number; rows: number };
  tuiObserverViewport: { width: number; height: number };
  viewport: { width: number; height: number };
  observationHoldMs: number;
  /** Headed only: how long failed windows stay on screen before teardown. */
  failureHoldMs?: number;
  /**
   * Invoked with the failure message before the failure hold and before any
   * teardown, so guidance can reach the operator while the windows are still
   * on screen. Failures thrown by the observer itself are swallowed.
   */
  onFailureObserved?: (failureMessage: string) => void | Promise<void>;
  activityPollMs: number;
  inactivityTimeoutMs: number;
  shutdownTimeoutMs?: number;
  taskId?: string;
  runId?: string;
  projectId?: string;
};

export type PhaseTiming = {
  label: string;
  durationMs: number;
};

export type HarnessResult = {
  status: "completed" | "failed";
  scenario: string;
  startedAt: string;
  finishedAt: string;
  failure?: string;
  phases?: PhaseTiming[];
};
