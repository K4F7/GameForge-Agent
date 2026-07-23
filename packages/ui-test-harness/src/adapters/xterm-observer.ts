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

  async open(options: { session: HarnessSession; source: CodeArtsTuiDriver; visible: boolean; viewport: { width: number; height: number } }): Promise<TuiObserverSnapshot> {
    if (this.#terminal !== undefined) throw new Error("xterm observer is already open.");
    const source = await options.source.read();
    if (options.visible) {
      const helper = fileURLToPath(new URL("./xterm-window.js", import.meta.url)); this.#windowProcess = spawn("node", [helper, String(source.columns), String(source.rows)], { stdio: ["pipe", "pipe", "pipe"], windowsHide: false });
      await waitReady(this.#windowProcess, 35_000); this.#visible = true;
    }
    this.#session = options.session;
    this.#terminal = new Terminal({ cols: source.columns, rows: source.rows, scrollback: 10_000, allowProposedApi: true, logLevel: "off" });
    this.#unsubscribe = options.source.subscribeOutput((frame) => {
      if (frame.sessionId !== options.session.sessionId) throw new Error("xterm received output from another session.");
      this.#pending = this.#pending.then(async () => {
        await new Promise<void>((resolve) => this.#terminal?.write(frame.data, resolve));
        if (this.#windowProcess?.stdin?.writable) this.#windowProcess.stdin.write(`${JSON.stringify(frame.data)}\n`);
      });
    });
    return this.snapshot();
  }

  async snapshot(): Promise<TuiObserverSnapshot> {
    const session = this.#session; const terminal = this.#terminal;
    if (session === undefined || terminal === undefined) throw new Error("xterm observer has not opened.");
    await this.#pending;
    return { kind: this.kind, sessionId: session.sessionId, visible: this.#visible, status: "open", title: this.#visible ? "CodeArts TUI · xterm observer" : "CodeArts TUI · xterm headless",
      capturedAt: new Date().toISOString() };
  }

  async close(): Promise<void> {
    await this.#pending; this.#unsubscribe?.(); this.#unsubscribe = undefined;
    this.#terminal?.dispose(); this.#terminal = undefined; this.#session = undefined;
    this.#windowProcess?.stdin?.end(); this.#windowProcess = undefined; this.#visible = false;
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

function waitReady(child: ChildProcess, timeoutMs: number): Promise<void> { return new Promise((resolve, reject) => { let output = ""; let errors = ""; const timer = setTimeout(() => { child.kill(); reject(new Error(`xterm window startup timed out: ${errors}`)); }, timeoutMs); child.stderr?.on("data", (chunk) => errors += String(chunk)); child.once("error", reject); child.stdout?.on("data", (chunk) => { output += String(chunk); if (output.includes("ready\n")) { clearTimeout(timer); resolve(); } }); }); }
