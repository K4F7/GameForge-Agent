import { chromium } from "playwright-core";
import { readFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { xtermWindowLaunchOptions } from "./xterm-window-launch.js";

const [columns, rows] = process.argv.slice(2).map(Number);
const browserChannel = process.env.GAMEFORGE_BROWSER_CHANNEL?.trim() || undefined;
const browser = await chromium.launch(xtermWindowLaunchOptions(browserChannel)); const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const script = await readFile(fileURLToPath(import.meta.resolve("@xterm/xterm/lib/xterm.js")), "utf8");
await page.setContent("<style>html,body,#terminal{width:100%;height:100%;margin:0;background:#111}</style><div id=terminal></div>"); await page.addScriptTag({ content: script });
await page.evaluate(`globalThis.gameforgeTerminal = new globalThis.Terminal({ cols: ${columns}, rows: ${rows} }); globalThis.gameforgeTerminal.open(document.querySelector('#terminal'));`);
process.stdout.write("ready\n");
const lines = createInterface({ input: process.stdin }); lines.on("line", (line) => { const data = JSON.parse(line) as string; void page.evaluate((value) => (globalThis as any).gameforgeTerminal.write(value), data); });
lines.once("close", async () => { await browser.close(); process.exit(0); });
