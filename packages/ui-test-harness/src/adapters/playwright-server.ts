import { chromium, type BrowserContext, type ConsoleMessage, type Page } from "playwright-core";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { browserLaunchOptions } from "./browser-launch.js";
import { appendBoundedDiagnostic, isExpectedOptionalConfigRead404, isExpectedOptionalConfigRead404Response } from "./browser-diagnostics.js";

const MAX_REQUEST_BYTES = 1024 * 1024;

const channelIndex = process.argv.indexOf("--browser-channel");
const browserChannel = channelIndex < 0 ? undefined : process.argv[channelIndex + 1];
const browser = await chromium.launch(browserLaunchOptions(process.argv.includes("--headless"), browserChannel));
let page: Page | undefined; let context: BrowserContext | undefined; let launching = false; const diagnostics: { consoleErrors: string[]; pageErrors: string[]; failedRequests: string[] } = { consoleErrors: [], pageErrors: [], failedRequests: [] };
const server = createServer(async (request, response) => {
  try { const body = await readRequest(request); const { command, value } = body;
    if (command !== "launch" && page === undefined) throw new Error("Browser page has not launched.");
    if (command === "launch") { if (page !== undefined || context !== undefined || launching) throw new Error("Browser page has already launched."); launching = true; try { context = await browser.newContext({ viewport: value.viewport }); page = await context.newPage(); page.on("console", (message) => { const formatted = formatConsoleError(message); if (message.type() === "error" && !isExpectedOptionalConfigRead404(formatted)) appendBoundedDiagnostic(diagnostics.consoleErrors, formatted); }); page.on("pageerror", (error) => appendBoundedDiagnostic(diagnostics.pageErrors, error.message)); page.on("requestfailed", (entry) => appendBoundedDiagnostic(diagnostics.failedRequests, `${entry.method()} ${entry.url()} ${entry.failure()?.errorText ?? "failed"}`)); page.on("response", (entry) => { if (entry.status() >= 400 && !isExpectedOptionalConfigRead404Response(entry.url(), entry.status())) appendBoundedDiagnostic(diagnostics.failedRequests, `${entry.request().method()} ${entry.url()} HTTP ${entry.status()}`); }); await page.goto(value.url, { waitUntil: "domcontentloaded" }); } finally { launching = false; } }
    else if (command === "navigate" && page!.url() !== value) await page!.goto(value, { waitUntil: "domcontentloaded" }); else if (command === "click") await page!.locator(value).click(); else if (command === "fill") await page!.locator(value.selector).fill(value.text); else if (command === "press") await page!.locator(value.selector).press(value.key); else if (command === "waitFor") await page!.locator(value.selector).waitFor({ state: value.state, timeout: value.timeoutMs });
    const result = command === "snapshot" ? (await mkdir(path.dirname(value.path), { recursive: true }), await page!.screenshot({ path: value.path, fullPage: true }), { url: page!.url(), title: await page!.title(), diagnostics }) : { ok: true }; response.writeHead(200, { "content-type": "application/json" }); response.end(JSON.stringify(result));
  } catch (error) { response.writeHead(500, { "content-type": "application/json" }); response.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) })); }
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve)); const address = server.address() as AddressInfo; process.stdout.write(`http://127.0.0.1:${address.port}\n`);
let closing = false;
const close = async (): Promise<void> => {
  if (closing) return;
  closing = true; process.stdin.pause();
  await Promise.all([
    new Promise<void>((resolve) => server.close(() => resolve())),
    context?.close().catch(() => undefined), browser.close().catch(() => undefined),
  ]);
};
process.once("SIGINT", () => { void close(); }); process.once("SIGTERM", () => { void close(); });
process.stdin.resume(); process.stdin.once("end", () => { void close(); });

function formatConsoleError(message: ConsoleMessage): string { const location = message.location(); return location.url ? `${message.text()} @ ${location.url}:${location.lineNumber}:${location.columnNumber}` : message.text(); }

function readRequest(request: import("node:http").IncomingMessage): Promise<{ command: string; value: any }> {
  return new Promise((resolve, reject) => {
    let text = ""; let bytes = 0; let settled = false;
    const fail = (error: Error): void => { if (settled) return; settled = true; reject(error); };
    request.setTimeout(10_000, () => fail(new Error("Playwright helper request timed out.")));
    request.on("error", fail);
    request.on("data", (chunk: Buffer) => {
      bytes += chunk.byteLength;
      if (bytes > MAX_REQUEST_BYTES) { fail(new Error("Playwright helper request exceeds the byte limit.")); return; }
      if (!settled) text += chunk.toString("utf8");
    });
    request.on("end", () => {
      if (settled) return;
      settled = true;
      try { resolve(JSON.parse(text || "{}") as { command: string; value: any }); }
      catch (error) { reject(error); }
    });
  });
}
