import { mkdir } from "node:fs/promises";
import { execFile } from "node:child_process";
import path from "node:path";
import { createOpencodeClient } from "@opencode-ai/sdk";
import { spawn, type IDisposable, type IExitEvent, type IPty } from "bun-pty";
import { safeCodeArtsServerUrl, safeEvidenceSegment } from "../cli-safety.js";
import type { CodeArtsTuiDriver, HarnessSession, TuiKey, TuiOutputFrame, TuiSnapshot } from "../contracts.js";

const MAX_INPUT_CHARACTERS = 65_536;
const MAX_HISTORY_CHARACTERS = 2 * 1024 * 1024;

const keySequences: Record<TuiKey, string> = {
  enter: "\r", escape: "\x1b", up: "\x1b[A", down: "\x1b[B", left: "\x1b[D", right: "\x1b[C",
  tab: "\t", backspace: "\x7f", delete: "\x1b[3~", home: "\x1b[H", end: "\x1b[F",
  "page-up": "\x1b[5~", "page-down": "\x1b[6~", "ctrl-c": "\x03", "ctrl-d": "\x04", "ctrl-l": "\x0c",
};

export type ConPtyCodeArtsOptions = {
  repoRoot: string;
  sessionRoot: string;
  environment?: Readonly<Record<string, string>>;
  model?: string;
  attach?: {
    serverUrl: string;
    sessionId: string;
  };
};

export class ConPtyCodeArtsDriver implements CodeArtsTuiDriver {
  readonly kind = "codearts-original-tui" as const;
  readonly #listeners = new Set<(frame: TuiOutputFrame) => void>();
  #pty?: IPty;
  #dataDisposable?: IDisposable;
  #exitDisposable?: IDisposable;
  #session?: HarnessSession;
  #columns = 0;
  #rows = 0;
  #sequence = 0;
  #history = "";
  #win32InputMode = false;
  #status: TuiSnapshot["status"] = "starting";
  #starting = false;
  #startupCancellationReason: "completed" | "failed" | "cancelled" | undefined;
  readonly #startupStopWaiters = new Set<() => void>();
  #stopPromise: Promise<void> | undefined;
  #lastChangedAt = new Date().toISOString();

  constructor(private readonly options: ConPtyCodeArtsOptions) {}

  async start(options: { session: HarnessSession; columns: number; rows: number }): Promise<TuiSnapshot> {
    if (this.#pty !== undefined || this.#starting || this.#stopPromise !== undefined) throw new Error("CodeArts ConPTY session has already started.");
    assertTerminalSize(options.columns, options.rows);
    this.#starting = true;
    try {
    this.#history = "";
    this.#sequence = 0;
    this.#win32InputMode = false;
    this.#session = options.session;
    this.#columns = options.columns;
    this.#rows = options.rows;
    const privateRoot = path.join(this.options.sessionRoot, "codearts-private");
    const auditDirectory = path.join(this.options.sessionRoot, "mcp-audit");
    await Promise.all([mkdir(privateRoot, { recursive: true }), mkdir(auditDirectory, { recursive: true })]);
    this.#throwIfStartupCancelled();
    const args = this.options.attach === undefined
      ? ["run", "codearts", ...(this.options.model === undefined ? [] : ["--model", this.options.model])]
      : [
          "run", "codearts", "--", "attach",
          safeCodeArtsServerUrl(this.options.attach.serverUrl),
          "--session", safeEvidenceSegment(this.options.attach.sessionId, "CodeArts session id"),
        ];
    const environment = stringEnvironment({
      ...process.env,
      ...this.options.environment,
      TERM: "xterm-256color",
      COLORTERM: "truecolor",
      GAMEFORGE_MCP_AUDIT_DIR: auditDirectory,
      GAMEFORGE_INTEGRATION_RUNTIME_DIR: path.join(this.options.sessionRoot, "integration-runtime"),
      KERNEL_DATA_DIR: path.join(privateRoot, "data"),
      KERNEL_CONFIG_DIR: path.join(privateRoot, "config"),
    });
    if (this.options.model === undefined) {
      environment.GAMEFORGE_FALLBACK_API_KEY = "";
      environment.GAMEFORGE_CODEARTS_FALLBACK_BASE_URL = "";
      environment.GAMEFORGE_CODEARTS_FALLBACK_MODEL = "";
    }
    try {
      this.#pty = spawn(process.env.GAMEFORGE_BUN_BIN?.trim() || "bun", args, {
        name: "xterm-256color",
        cwd: this.options.repoRoot,
        cols: options.columns,
        rows: options.rows,
        env: environment,
      });
    } catch (error) {
      this.#status = "failed";
      throw new Error(`Windows ConPTY could not start CodeArts: ${errorMessage(error)}`);
    }
    this.#status = "running";
    const pty = this.#pty;
    this.#dataDisposable = pty.onData((data: string) => { if (this.#pty === pty) this.#onData(data); });
    this.#exitDisposable = pty.onExit(({ exitCode }: IExitEvent) => {
      if (this.#pty !== pty) return;
      this.#status = exitCode === 0 ? "exited" : "failed";
      this.#lastChangedAt = new Date().toISOString();
    });
    await this.#waitUntilReady(30_000);
    return this.read();
    } catch (error) {
      if (this.#pty !== undefined) await this.stop("failed");
      throw error;
    } finally {
      this.#starting = false;
      this.#startupCancellationReason = undefined;
      for (const resolve of this.#startupStopWaiters) resolve();
      this.#startupStopWaiters.clear();
    }
  }

  async read(): Promise<TuiSnapshot> {
    const session = this.#requireSession();
    return {
      sessionId: session.sessionId,
      status: this.#status,
      columns: this.#columns,
      rows: this.#rows,
      outputSequence: this.#sequence,
      lastChangedAt: this.#lastChangedAt,
      screen: renderPlainScreen(this.#history, this.#rows),
    };
  }

  subscribeOutput(listener: (frame: TuiOutputFrame) => void, options?: { replayBuffered?: boolean }): () => void {
    if (options?.replayBuffered === true && this.#session !== undefined && this.#history.length > 0) {
      // One synthetic frame carrying the bounded history. Delivered
      // synchronously before registration: no data event can interleave, so
      // live frames observed afterwards keep the sequence monotonic.
      listener({ sessionId: this.#session.sessionId, sequence: this.#sequence, data: this.#history });
    }
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  async sendText(text: string, options: { appendEnter: boolean }): Promise<void> {
    if (text.length === 0 || text.length > MAX_INPUT_CHARACTERS || /\0/.test(text)) {
      throw new Error(`TUI text must contain between 1 and ${MAX_INPUT_CHARACTERS} characters without NUL bytes.`);
    }
    if (options.appendEnter && this.options.attach !== undefined) {
      await this.#submitAttachedPrompt(text);
      return;
    }
    if (options.appendEnter && this.#win32InputMode) throw unsupportedWin32InputMode();
    const pty = this.#requirePty();
    pty.write(`\x1b[200~${text}\x1b[201~`);
    if (options.appendEnter) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      this.#requirePty().write("\r");
    }
  }

  async #submitAttachedPrompt(text: string): Promise<void> {
    const attach = this.options.attach;
    if (attach === undefined) throw new Error("CodeArts attach configuration is unavailable.");
    const client = createOpencodeClient({
      baseUrl: safeCodeArtsServerUrl(attach.serverUrl),
      directory: path.resolve(this.options.repoRoot),
      signal: AbortSignal.timeout(15_000),
      throwOnError: true,
    });
    await client.session.promptAsync({
      path: { id: safeEvidenceSegment(attach.sessionId, "CodeArts session id") },
      body: { parts: [{ type: "text", text }] },
    });
  }

  async sendKey(key: TuiKey): Promise<void> {
    if (this.#win32InputMode) throw unsupportedWin32InputMode();
    this.#requirePty().write(keySequences[key]);
  }

  async resize(columns: number, rows: number): Promise<void> {
    assertTerminalSize(columns, rows);
    this.#requirePty().resize(columns, rows);
    this.#columns = columns;
    this.#rows = rows;
  }

  async stop(reason: "completed" | "failed" | "cancelled"): Promise<void> {
    if (this.#stopPromise !== undefined) return await this.#stopPromise;
    const pty = this.#pty;
    if (pty === undefined) {
      if (!this.#starting) return;
      this.#startupCancellationReason ??= reason;
      await new Promise<void>((resolve) => this.#startupStopWaiters.add(resolve));
      return;
    }
    const stopPromise = this.#stopOwnedProcess(pty, reason); this.#stopPromise = stopPromise;
    try { await stopPromise; } finally { if (this.#stopPromise === stopPromise) this.#stopPromise = undefined; }
  }

  #throwIfStartupCancelled(): void {
    const reason = this.#startupCancellationReason;
    if (reason === undefined) return;
    this.#status = reason === "failed" ? "failed" : "exited";
    this.#lastChangedAt = new Date().toISOString();
    throw new Error(`CodeArts ConPTY start was ${reason}.`);
  }

  async #stopOwnedProcess(pty: IPty, reason: "completed" | "failed" | "cancelled"): Promise<void> {
    const pid = pty.pid;
    this.#pty = undefined;
    this.#dataDisposable?.dispose();
    this.#exitDisposable?.dispose();
    try {
      if (process.platform === "win32") await killWindowsProcessTree(pid);
      try { pty.kill(); } catch { /* The managed process has already exited. */ }
      await waitForProcessExit(pid, 5_000);
      this.#status = reason === "failed" ? "failed" : "exited";
    } catch (error) {
      this.#status = "failed";
      throw error;
    } finally {
      this.#lastChangedAt = new Date().toISOString();
    }
  }

  #onData(data: string): void {
    const session = this.#requireSession();
    this.#sequence += 1;
    this.#lastChangedAt = new Date().toISOString();
    this.#history = (this.#history + data).slice(-MAX_HISTORY_CHARACTERS);
    if (data.includes("\x1b[?9001h")) this.#win32InputMode = true;
    const frame = { sessionId: session.sessionId, sequence: this.#sequence, data };
    for (const listener of this.#listeners) listener(frame);
  }

  #requirePty(): IPty {
    if (this.#pty === undefined || this.#status !== "running") throw new Error("CodeArts ConPTY is not running.");
    return this.#pty;
  }

  #requireSession(): HarnessSession {
    if (this.#session === undefined) throw new Error("CodeArts ConPTY session has not started.");
    return this.#session;
  }

  async #waitUntilReady(timeoutMs: number): Promise<void> {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      const screen = renderPlainScreen(this.#history, this.#rows);
      const ready = this.options.attach === undefined
        ? /Ask anything|What is the tech stack|\bBuild\b|tab agents|tab commands/i.test(screen)
        : /Ask anything|What is the tech stack|tab agents|tab commands/i.test(screen);
      if (ready) return;
      if (/authorization (?:is )?required|authentication (?:is )?required|(?:sign|log) in to continue/i.test(screen)) {
        throw new Error("CodeArts authorization is required or expired.");
      }
      if (this.#status === "failed" || this.#status === "exited") throw new Error("CodeArts exited before the TUI became ready.");
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error("CodeArts TUI readiness timed out after 30000 milliseconds.");
  }
}

function assertTerminalSize(columns: number, rows: number): void {
  if (!Number.isInteger(columns) || columns < 20 || columns > 500 || !Number.isInteger(rows) || rows < 5 || rows > 200) {
    throw new Error("Terminal size is outside the supported range.");
  }
}

function stringEnvironment(input: NodeJS.ProcessEnv & Readonly<Record<string, string | undefined>>): Record<string, string> {
  return Object.fromEntries(Object.entries(input).filter((entry): entry is [string, string] => entry[1] !== undefined));
}

function renderPlainScreen(value: string, rows: number): string {
  const plain = value
    .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, "")
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/\r(?!\n)/g, "\n");
  return plain.split("\n").slice(-rows).join("\n");
}

function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error); }

async function waitForProcessExit(pid: number, timeoutMs: number): Promise<void> {
  const startedAt = Date.now();
  while (processExists(pid)) {
    if (Date.now() - startedAt >= timeoutMs) throw new Error(`CodeArts ConPTY process ${pid} did not exit within ${timeoutMs} milliseconds.`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

function processExists(pid: number): boolean {
  try { process.kill(pid, 0); return true; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ESRCH") return false; throw error; }
}

function killWindowsProcessTree(pid: number): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile("taskkill.exe", ["/PID", String(pid), "/T", "/F"], { windowsHide: true, timeout: 5_000 }, (error) => {
      if (error !== null && processExists(pid)) reject(new Error(`Could not stop CodeArts ConPTY process tree ${pid}: ${error.message}`));
      else resolve();
    });
  });
}

function unsupportedWin32InputMode(): Error {
  return new Error("CodeArts enabled Win32 input mode, which bun-pty cannot submit while VT output capture is active.");
}
