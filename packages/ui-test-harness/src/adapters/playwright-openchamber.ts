import { mkdir } from "node:fs/promises";
import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Browser, type BrowserContext, type ConsoleMessage, type Page } from "playwright-core";
import type { GuiDiagnostics, GuiSnapshot, GuiWaitOptions, HarnessMode, HarnessSession, OpenChamberGuiDriver } from "../contracts.js";
import { browserLaunchOptions } from "./browser-launch.js";
import { appendBoundedDiagnostic, isExpectedOptionalConfigRead404, isExpectedOptionalConfigRead404Response } from "./browser-diagnostics.js";

export type PlaywrightOpenChamberOptions = { sessionRoot: string; baseUrl: string; browserChannel?: string };

export class PlaywrightOpenChamberDriver implements OpenChamberGuiDriver {
  readonly kind = "openchamber-original-gui" as const;
  #browser: Browser | undefined; #context: BrowserContext | undefined; #page: Page | undefined; #session: HarnessSession | undefined;
  #serverProcess: ChildProcess | undefined;
  #remoteUrl: string | undefined;
  #closePromise: Promise<void> | undefined;
  readonly #diagnostics: { consoleErrors: string[]; pageErrors: string[]; failedRequests: string[] } = { consoleErrors: [], pageErrors: [], failedRequests: [] };
  constructor(private readonly options: PlaywrightOpenChamberOptions) {}

  async launch(options: { session: HarnessSession; mode: HarnessMode; viewport: { width: number; height: number } }): Promise<void> {
    if (this.#browser !== undefined || this.#serverProcess !== undefined || this.#remoteUrl !== undefined || this.#closePromise !== undefined) throw new Error("OpenChamber browser is already launched.");
    const baseUrl = safeLoopbackUrl(this.options.baseUrl); this.#session = options.session;
    this.#diagnostics.consoleErrors.splice(0); this.#diagnostics.pageErrors.splice(0); this.#diagnostics.failedRequests.splice(0);
    try {
      if (process.versions.bun !== undefined) { this.#remoteUrl = await this.#launchRemote(options.mode); await this.#remote("launch", { url: baseUrl, viewport: options.viewport }); return; }
      this.#browser = await this.#launchBrowser(options.mode);
      this.#context = await this.#browser.newContext({ viewport: options.viewport }); this.#page = await this.#context.newPage();
      this.#page.on("console", (message) => {
        const formatted = formatConsoleError(message);
        if (message.type() === "error" && !isExpectedOptionalConfigRead404(formatted)) appendBoundedDiagnostic(this.#diagnostics.consoleErrors, formatted);
      });
      this.#page.on("pageerror", (error) => appendBoundedDiagnostic(this.#diagnostics.pageErrors, error.message));
      this.#page.on("requestfailed", (request) => appendBoundedDiagnostic(this.#diagnostics.failedRequests, `${request.method()} ${request.url()} ${request.failure()?.errorText ?? "failed"}`));
      this.#page.on("response", (response) => {
        if (response.status() >= 400 && !isExpectedOptionalConfigRead404Response(response.url(), response.status())) {
          appendBoundedDiagnostic(this.#diagnostics.failedRequests, `${response.request().method()} ${response.url()} HTTP ${response.status()}`);
        }
      });
      await this.#page.goto(baseUrl, { waitUntil: "domcontentloaded" });
    } catch (error) {
      await this.close();
      throw error;
    }
  }
  async navigate(url: string): Promise<void> {
    const targetUrl = safeLoopbackUrl(url);
    if (this.#remoteUrl) return void await this.#remote("navigate", targetUrl);
    const page = this.#requirePage();
    if (page.url() === targetUrl) return;
    await page.goto(targetUrl, { waitUntil: "domcontentloaded" });
  }
  async click(selector: string): Promise<void> { if (this.#remoteUrl) return void await this.#remote("click", selector); await this.#requirePage().locator(selector).click(); }
  async fill(selector: string, value: string): Promise<void> { if (this.#remoteUrl) return void await this.#remote("fill", { selector, text: value }); await this.#requirePage().locator(selector).fill(value); }
  async press(selector: string, key: string): Promise<void> { if (this.#remoteUrl) return void await this.#remote("press", { selector, key }); await this.#requirePage().locator(selector).press(key); }
  async waitFor(selector: string, options: GuiWaitOptions): Promise<void> {
    if (this.#remoteUrl) return void await this.#remote("waitFor", { selector, ...options });
    await this.#requirePage().locator(selector).waitFor({ state: options.state, timeout: options.timeoutMs });
  }
  async snapshot(label: string): Promise<GuiSnapshot> {
    const session = this.#requireSession(); const safeLabel = label.replace(/[^A-Za-z0-9._-]+/g, "-").slice(0, 80) || "snapshot";
    const screenshotPath = path.join(this.options.sessionRoot, "gui", `${Date.now()}-${safeLabel}.png`); await mkdir(path.dirname(screenshotPath), { recursive: true });
    if (this.#remoteUrl) { const remote = await this.#remote("snapshot", { path: screenshotPath }) as { url: string; title: string; diagnostics: GuiDiagnostics }; return { sessionId: session.sessionId, ...(session.runId === undefined ? {} : { runId: session.runId }), ...remote, capturedAt: new Date().toISOString(), screenshotPath: path.relative(this.options.sessionRoot, screenshotPath).replaceAll("\\", "/") }; }
    const page = this.#requirePage();
    await page.screenshot({ path: screenshotPath, fullPage: true });
    return { sessionId: session.sessionId, ...(session.runId === undefined ? {} : { runId: session.runId }), url: page.url(), title: await page.title(), capturedAt: new Date().toISOString(),
      screenshotPath: path.relative(this.options.sessionRoot, screenshotPath).replaceAll("\\", "/"), diagnostics: cloneDiagnostics(this.#diagnostics) };
  }
  async close(): Promise<void> {
    if (this.#closePromise !== undefined) return await this.#closePromise;
    const closePromise = this.#closeOwnedResources(); this.#closePromise = closePromise;
    try { await closePromise; } finally { if (this.#closePromise === closePromise) this.#closePromise = undefined; }
  }
  async #closeOwnedResources(): Promise<void> {
    await this.#context?.close().catch(() => undefined); await this.#browser?.close().catch(() => undefined);
    const serverProcess = this.#serverProcess;
    this.#serverProcess = undefined; this.#remoteUrl = undefined; this.#page = undefined; this.#context = undefined; this.#browser = undefined; this.#session = undefined;
    if (serverProcess !== undefined) { serverProcess.stdin?.end(); await waitForExit(serverProcess, 10_000); }
  }
  #requirePage(): Page { if (this.#page === undefined) throw new Error("OpenChamber browser has not launched."); return this.#page; }
  #requireSession(): HarnessSession { if (this.#session === undefined) throw new Error("OpenChamber session has not launched."); return this.#session; }
  async #launchBrowser(mode: HarnessMode): Promise<Browser> {
    return chromium.launch(browserLaunchOptions(mode === "headless", this.options.browserChannel));
  }
  async #launchRemote(mode: HarnessMode): Promise<string> {
    const helper = fileURLToPath(new URL("./playwright-server.js", import.meta.url));
    const child = spawn("node", [helper, ...(mode === "headless" ? ["--headless"] : []), ...(this.options.browserChannel === undefined ? [] : ["--browser-channel", this.options.browserChannel])], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true }); this.#serverProcess = child;
    const endpoint = await firstLine(child, 35_000);
    return endpoint;
  }
  async #remote(command: string, value: unknown): Promise<unknown> { const response = await fetch(this.#remoteUrl!, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ command, value }) }); const body = await response.json() as { error?: string }; if (!response.ok) throw new Error(body.error ?? `Playwright helper failed: ${response.status}`); return body; }
}

function safeLoopbackUrl(input: string): string { const url = new URL(input); if (!["http:", "https:"].includes(url.protocol) || !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) || url.username || url.password) throw new Error("OpenChamber URL must be credential-free loopback HTTP(S)."); return url.href; }
function formatConsoleError(message: ConsoleMessage): string { const location = message.location(); return location.url ? `${message.text()} @ ${location.url}:${location.lineNumber}:${location.columnNumber}` : message.text(); }
function cloneDiagnostics(value: GuiDiagnostics): GuiDiagnostics { return { consoleErrors: [...value.consoleErrors], pageErrors: [...value.pageErrors], failedRequests: [...value.failedRequests] }; }
function firstLine(child: ChildProcess, timeoutMs: number): Promise<string> { return new Promise((resolve, reject) => { let stdout = ""; let stderr = ""; let settled = false;
  const cleanup = (): void => { clearTimeout(timer); child.stderr?.off("data", onStderr); child.stdout?.off("data", onStdout); child.off("exit", onExit); };
  const fail = (error: Error): void => { if (settled) return; settled = true; cleanup(); reject(error); };
  const succeed = (endpoint: string): void => { if (settled) return; settled = true; cleanup(); resolve(endpoint); };
  const onStderr = (chunk: unknown): void => { stderr += String(chunk); };
  const onStdout = (chunk: unknown): void => { stdout += String(chunk); const line = stdout.split(/\r?\n/, 1)[0]?.trim(); if (stdout.includes("\n") && line) succeed(line); };
  const onExit = (code: number | null): void => fail(new Error(`Playwright server exited ${code} before reporting a valid endpoint: ${stderr}`));
  const timer = setTimeout(() => { child.kill(); fail(new Error(`Playwright server startup timed out: ${stderr}`)); }, timeoutMs);
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
    const timer = setTimeout(() => { child.kill(); fail(new Error("Playwright server did not exit within " + timeoutMs + " milliseconds.")); }, timeoutMs);
    child.once("error", onError); child.once("exit", onExit);
    if (child.exitCode !== null || child.signalCode !== null) succeed();
  });
}
