import type {
  CodeArtsTuiObserverDriver, GuiSnapshot, HarnessMode, HarnessSession, OpenChamberGuiDriver,
  TuiObserverSnapshot,
} from "../contracts.js";

export class HeadlessTuiObserverDriver implements CodeArtsTuiObserverDriver {
  readonly kind = "independent-xterm" as const;
  #session: HarnessSession | undefined;
  async open(options: { session: HarnessSession; visible: boolean }): Promise<TuiObserverSnapshot> {
    if (options.visible) throw new Error("The independent xterm observer is not implemented; use headless mode.");
    this.#session = options.session;
    return this.snapshot();
  }
  async snapshot(): Promise<TuiObserverSnapshot> {
    if (this.#session === undefined) throw new Error("Headless TUI observer has not opened.");
    return { kind: this.kind, sessionId: this.#session.sessionId, visible: false, status: "open", title: "headless", capturedAt: new Date().toISOString() };
  }
  async close(): Promise<void> { this.#session = undefined; }
}

export class HeadlessGuiDriver implements OpenChamberGuiDriver {
  readonly kind = "openchamber-original-gui" as const;
  #launched = false;
  async launch(options: { mode: HarnessMode }): Promise<void> {
    if (options.mode !== "headless") throw new Error("The OpenChamber browser driver is not implemented; use headless mode.");
    this.#launched = true;
  }
  async navigate(): Promise<void> { throw new Error("Headless minimal closure does not include OpenChamber navigation."); }
  async click(): Promise<void> { throw new Error("Headless minimal closure does not include OpenChamber clicks."); }
  async fill(): Promise<void> { throw new Error("Headless minimal closure does not include OpenChamber input."); }
  async press(): Promise<void> { throw new Error("Headless minimal closure does not include OpenChamber keys."); }
  async snapshot(): Promise<GuiSnapshot> {
    if (!this.#launched) throw new Error("Headless GUI placeholder has not launched.");
    return { url: "about:blank", title: "headless-minimal-closure", capturedAt: new Date().toISOString(), diagnostics: { consoleErrors: [], pageErrors: [], failedRequests: [] } };
  }
  async close(): Promise<void> { this.#launched = false; }
}
