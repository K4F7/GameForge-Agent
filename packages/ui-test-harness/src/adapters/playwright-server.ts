import { chromium, type Page } from "playwright-core";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdir } from "node:fs/promises";
import path from "node:path";

const browser = await chromium.launch({ headless: process.argv.includes("--headless"), timeout: 30_000 });
let page: Page | undefined; const diagnostics: { consoleErrors: string[]; pageErrors: string[]; failedRequests: string[] } = { consoleErrors: [], pageErrors: [], failedRequests: [] };
const server = createServer(async (request, response) => {
  try { const body = await new Promise<{ command: string; value: any }>((resolve) => { let text = ""; request.on("data", (chunk) => text += chunk); request.on("end", () => resolve(JSON.parse(text || "{}"))); }); const { command, value } = body;
    if (command !== "launch" && page === undefined) throw new Error("Browser page has not launched.");
    if (command === "launch") { const context = await browser.newContext({ viewport: value.viewport }); page = await context.newPage(); page.on("console", (message) => { if (message.type() === "error") diagnostics.consoleErrors.push(message.text()); }); page.on("pageerror", (error) => diagnostics.pageErrors.push(error.message)); page.on("requestfailed", (entry) => diagnostics.failedRequests.push(`${entry.method()} ${entry.url()} ${entry.failure()?.errorText ?? "failed"}`)); await page.goto(value.url, { waitUntil: "domcontentloaded" }); }
    else if (command === "navigate") await page!.goto(value, { waitUntil: "domcontentloaded" }); else if (command === "click") await page!.locator(value).click(); else if (command === "fill") await page!.locator(value.selector).fill(value.text); else if (command === "press") await page!.locator(value.selector).press(value.key);
    const result = command === "snapshot" ? (await mkdir(path.dirname(value.path), { recursive: true }), await page!.screenshot({ path: value.path, fullPage: true }), { url: page!.url(), title: await page!.title(), diagnostics }) : { ok: true }; response.writeHead(200, { "content-type": "application/json" }); response.end(JSON.stringify(result));
  } catch (error) { response.writeHead(500, { "content-type": "application/json" }); response.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) })); }
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve)); const address = server.address() as AddressInfo; process.stdout.write(`http://127.0.0.1:${address.port}\n`);
let closing = false;
const close = async (): Promise<void> => { if (closing) return; closing = true; server.close(); await browser.close().catch(() => undefined); process.exit(0); };
process.once("SIGINT", () => { void close(); }); process.once("SIGTERM", () => { void close(); });
process.stdin.resume(); process.stdin.once("end", () => { void close(); });
