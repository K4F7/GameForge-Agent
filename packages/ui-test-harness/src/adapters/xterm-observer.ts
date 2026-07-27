import { Terminal } from "@xterm/headless";
import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { CodeArtsTuiDriver, CodeArtsTuiObserverDriver, HarnessSession, TuiObserverSnapshot } from "../contracts.js";

export class XtermTuiObserverDriver implements CodeArtsTuiObserverDriver {
  readonly kind = "independent-xterm" as const;
  #session: HarnessSession | undefined;
  #terminal: Terminal | undefined;
  #unsubscribe: (() => void) | undefined;
  #pending: Promise<void> = Promise.resolve();
  #windowProcess: ChildProcess | undefined; #visible = false;
  #closePromise: Promise<void> | undefined;

  constructor(private readonly options: { browserChannel?: string } = {}) {}

  async open(options: { session: HarnessSession; source: CodeArtsTuiDriver; visible: boolean; viewport: { width: number; height: number } }): Promise<TuiObserverSnapshot> {
    if (this.#terminal !== undefined || this.#closePromise !== undefined) throw new Error("xterm observer is already open.");
    const source = await options.source.read();
    try {
      if (options.visible) {
        const helper = fileURLToPath(new URL("./xterm-window.js", import.meta.url)); this.#windowProcess = spawn("node", [helper, String(source.columns), String(source.rows)], {
          stdio: ["pipe", "pipe", "pipe"], windowsHide: false,
          env: { ...process.env, ...(this.options.browserChannel === undefined ? {} : { GAMEFORGE_BROWSER_CHANNEL: this.options.browserChannel }) },
        });
        await waitReady(this.#windowProcess, 35_000); this.#visible = true;
      }
      this.#session = options.session;
      this.#terminal = new Terminal({ cols: source.columns, rows: source.rows, scrollback: 10_000, allowProposedApi: true, logLevel: "off" });
      // replayBuffered: the observer opens after the TUI has started, and the
      // startup output - exactly the part that answers "did it come up" - would
      // otherwise never reach the visible window. Evidence keeps its own
      // replay-free subscription, so nothing is duplicated into the VT log.
      this.#unsubscribe = options.source.subscribeOutput((frame) => {
        if (frame.sessionId !== options.session.sessionId) throw new Error("xterm received output from another session.");
        this.#pending = this.#pending.then(async () => {
          await new Promise<void>((resolve) => {
            if (this.#terminal === undefined) { resolve(); return; }
            this.#terminal.write(frame.data, resolve);
          });
          if (this.#windowProcess?.stdin?.writable) this.#windowProcess.stdin.write(`${JSON.stringify(frame.data)}\n`);
        });
      }, { replayBuffered: true });
      return await this.snapshot();
    } catch (error) {
      await this.close();
      throw error;
    }
  }

  async snapshot(): Promise<TuiObserverSnapshot> {
    const session = this.#session; const terminal = this.#terminal;
    if (session === undefined || terminal === undefined) throw new Error("xterm observer has not opened.");
    await this.#pending;
    if (this.#visible && (this.#windowProcess === undefined || this.#windowProcess.exitCode !== null || this.#windowProcess.signalCode !== null)) {
      throw new Error("xterm observer window exited before the readiness snapshot.");
    }
    return { kind: this.kind, sessionId: session.sessionId, visible: this.#visible, status: "open", title: this.#visible ? "CodeArts TUI · xterm observer" : "CodeArts TUI · xterm headless",
      capturedAt: new Date().toISOString() };
  }

  async close(): Promise<void> {
    if (this.#closePromise !== undefined) return await this.#closePromise;
    const closePromise = this.#closeOwnedResources(); this.#closePromise = closePromise;
    try { await closePromise; } finally { if (this.#closePromise === closePromise) this.#closePromise = undefined; }
  }

  async #closeOwnedResources(): Promise<void> {
    const unsubscribe = this.#unsubscribe; this.#unsubscribe = undefined; unsubscribe?.();
    await this.#pending;
    this.#terminal?.dispose(); this.#terminal = undefined; this.#session = undefined;
    const windowProcess = this.#windowProcess; this.#windowProcess = undefined; this.#visible = false;
    if (windowProcess !== undefined) {
      windowProcess.stdin?.end();
      await waitForExit(windowProcess, 5_000);
    }
  }

  async screen(): Promise<string> {
    await this.#pending;
    const terminal = this.#terminal;
    if (terminal === undefined) throw new Error("xterm observer has not opened.");
    const buffer = terminal.buffer.active; const lines: string[] = [];
    for (let index = buffer.viewportY; index < Math.min(buffer.length, buffer.viewportY + terminal.rows); index++)
      lines.push(buffer.getLine(index)?.translateToString(true) ?? "");
    return lines.join("\n");
  }
}

function waitReady(child: ChildProcess, timeoutMs: number): Promise<void> { return new Promise((resolve, reject) => { let output = ""; let errors = ""; let settled = false;
  const cleanup = (): void => { clearTimeout(timer); child.stderr?.off("data", onStderr); child.stdout?.off("data", onStdout); child.off("exit", onExit); };
  const fail = (error: Error): void => { if (settled) return; settled = true; cleanup(); reject(error); };
  const succeed = (): void => { if (settled) return; settled = true; cleanup(); resolve(); };
  const onStderr = (chunk: unknown): void => { errors += String(chunk); };
  const onStdout = (chunk: unknown): void => { output += String(chunk); if (output.includes("ready\n")) succeed(); };
  const onExit = (code: number | null): void => { if (!output.includes("ready\n")) fail(new Error(`xterm window exited ${code}: ${errors}`)); };
  const timer = setTimeout(() => { child.kill(); fail(new Error(`xterm window startup timed out: ${errors}`)); }, timeoutMs);
  child.stderr?.on("data", onStderr); child.stdout?.on("data", onStdout); child.once("error", fail); child.once("exit", onExit);
}); }

function waitForExit(child: ChildProcess, timeoutMs: number): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = (): void => { clearTimeout(timer); child.off("error", onError); child.off("exit", onExit); };
    const succeed = (): void => { if (settled) return; settled = true; cleanup(); resolve(); };
    const fail = (error: Error): void => { if (settled) return; settled = true; cleanup(); reject(error); };
    const onError = (error: Error): void => fail(error);
    const onExit = (): void => succeed();
    const timer = setTimeout(() => { child.kill(); fail(new Error("xterm window did not exit within " + timeoutMs + " milliseconds.")); }, timeoutMs);
    child.once("error", onError); child.once("exit", onExit);
    if (child.exitCode !== null || child.signalCode !== null) succeed();
  });
}
