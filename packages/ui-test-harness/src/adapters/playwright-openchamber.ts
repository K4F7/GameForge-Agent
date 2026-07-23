import { mkdir } from "node:fs/promises";
import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright-core";
import type { GuiDiagnostics, GuiSnapshot, HarnessMode, HarnessSession, OpenChamberGuiDriver } from "../contracts.js";

export type PlaywrightOpenChamberOptions = { sessionRoot: string; baseUrl: string; browserChannel?: string };

export class PlaywrightOpenChamberDriver implements OpenChamberGuiDriver {
  readonly kind = "openchamber-original-gui" as const;
  #browser: Browser | undefined; #context: BrowserContext | undefined; #page: Page | undefined; #session: HarnessSession | undefined;
  #serverProcess: ChildProcess | undefined;
  #remoteUrl: string | undefined;
  readonly #diagnostics: { consoleErrors: string[]; pageErrors: string[]; failedRequests: string[] } = { consoleErrors: [], pageErrors: [], failedRequests: [] };
  constructor(private readonly options: PlaywrightOpenChamberOptions) {}

  async launch(options: { session: HarnessSession; mode: HarnessMode; viewport: { width: number; height: number } }): Promise<void> {
    if (this.#browser !== undefined) throw new Error("OpenChamber browser is already launched.");
    const baseUrl = safeLoopbackUrl(this.options.baseUrl); this.#session = options.session;
    this.#diagnostics.consoleErrors.splice(0); this.#diagnostics.pageErrors.splice(0); this.#diagnostics.failedRequests.splice(0);
    if (process.versions.bun !== undefined && this.options.browserChannel === undefined) { this.#remoteUrl = await this.#launchRemote(options.mode); await this.#remote("launch", { url: baseUrl, viewport: options.viewport }); return; }
    this.#browser = await this.#launchBrowser(options.mode);
    this.#context = await this.#browser.newContext({ viewport: options.viewport }); this.#page = await this.#context.newPage();
    this.#page.on("console", (message) => { if (message.type() === "error") this.#diagnostics.consoleErrors.push(message.text()); });
    this.#page.on("pageerror", (error) => this.#diagnostics.pageErrors.push(error.message));
    this.#page.on("requestfailed", (request) => this.#diagnostics.failedRequests.push(`${request.method()} ${request.url()} ${request.failure()?.errorText ?? "failed"}`));
    await this.#page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  }
  async navigate(url: string): Promise<void> { if (this.#remoteUrl) return void await this.#remote("navigate", safeLoopbackUrl(url)); await this.#requirePage().goto(safeLoopbackUrl(url), { waitUntil: "domcontentloaded" }); }
  async click(selector: string): Promise<void> { if (this.#remoteUrl) return void await this.#remote("click", selector); await this.#requirePage().locator(selector).click(); }
  async fill(selector: string, value: string): Promise<void> { if (this.#remoteUrl) return void await this.#remote("fill", { selector, text: value }); await this.#requirePage().locator(selector).fill(value); }
  async press(selector: string, key: string): Promise<void> { if (this.#remoteUrl) return void await this.#remote("press", { selector, key }); await this.#requirePage().locator(selector).press(key); }
  async snapshot(label: string): Promise<GuiSnapshot> {
    const session = this.#requireSession(); const safeLabel = label.replace(/[^A-Za-z0-9._-]+/g, "-").slice(0, 80) || "snapshot";
    const screenshotPath = path.join(this.options.sessionRoot, "gui", `${Date.now()}-${safeLabel}.png`); await mkdir(path.dirname(screenshotPath), { recursive: true });
    if (this.#remoteUrl) { const remote = await this.#remote("snapshot", { path: screenshotPath }) as { url: string; title: string; diagnostics: GuiDiagnostics }; return { sessionId: session.sessionId, ...(session.runId === undefined ? {} : { runId: session.runId }), ...remote, capturedAt: new Date().toISOString(), screenshotPath: path.relative(this.options.sessionRoot, screenshotPath).replaceAll("\\", "/") }; }
    const page = this.#requirePage();
    await page.screenshot({ path: screenshotPath, fullPage: true });
    return { sessionId: session.sessionId, ...(session.runId === undefined ? {} : { runId: session.runId }), url: page.url(), title: await page.title(), capturedAt: new Date().toISOString(),
      screenshotPath: path.relative(this.options.sessionRoot, screenshotPath).replaceAll("\\", "/"), diagnostics: cloneDiagnostics(this.#diagnostics) };
  }
  async close(): Promise<void> { await this.#context?.close().catch(() => undefined); await this.#browser?.close().catch(() => undefined); this.#serverProcess?.stdin?.end(); this.#serverProcess?.kill(); this.#serverProcess = undefined; this.#remoteUrl = undefined; this.#page = undefined; this.#context = undefined; this.#browser = undefined; this.#session = undefined; }
  #requirePage(): Page { if (this.#page === undefined) throw new Error("OpenChamber browser has not launched."); return this.#page; }
  #requireSession(): HarnessSession { if (this.#session === undefined) throw new Error("OpenChamber session has not launched."); return this.#session; }
  async #launchBrowser(mode: HarnessMode): Promise<Browser> {
    return chromium.launch({ headless: mode === "headless", timeout: 30_000, channel: this.options.browserChannel ?? "chrome" });
  }
  async #launchRemote(mode: HarnessMode): Promise<string> {
    const helper = fileURLToPath(new URL("./playwright-server.js", import.meta.url));
    const child = spawn("node", [helper, ...(mode === "headless" ? ["--headless"] : [])], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true }); this.#serverProcess = child;
    const endpoint = await firstLine(child, 35_000);
    return endpoint;
  }
  async #remote(command: string, value: unknown): Promise<unknown> { const response = await fetch(this.#remoteUrl!, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ command, value }) }); const body = await response.json() as { error?: string }; if (!response.ok) throw new Error(body.error ?? `Playwright helper failed: ${response.status}`); return body; }
}

function safeLoopbackUrl(input: string): string { const url = new URL(input); if (!["http:", "https:"].includes(url.protocol) || !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) || url.username || url.password) throw new Error("OpenChamber URL must be credential-free loopback HTTP(S)."); return url.href; }
function cloneDiagnostics(value: GuiDiagnostics): GuiDiagnostics { return { consoleErrors: [...value.consoleErrors], pageErrors: [...value.pageErrors], failedRequests: [...value.failedRequests] }; }
function firstLine(child: ChildProcess, timeoutMs: number): Promise<string> { return new Promise((resolve, reject) => { let stdout = ""; let stderr = "";
  const timer = setTimeout(() => { child.kill(); reject(new Error(`Playwright server startup timed out: ${stderr}`)); }, timeoutMs);
  child.stderr?.on("data", (chunk) => { stderr += String(chunk); }); child.once("error", reject); child.once("exit", (code) => { if (!stdout.includes("\n")) reject(new Error(`Playwright server exited ${code}: ${stderr}`)); });
  child.stdout?.on("data", (chunk) => { stdout += String(chunk); const line = stdout.split(/\r?\n/, 1)[0]?.trim(); if (stdout.includes("\n") && line) { clearTimeout(timer); resolve(line); } });
}); }
