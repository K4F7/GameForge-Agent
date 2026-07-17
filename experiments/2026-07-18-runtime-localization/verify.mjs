import { chromium } from "../../packages/game-verifier/node_modules/playwright-core/index.mjs";
import { spawn } from "node:child_process";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";

const project = path.resolve(".gameforge-validation/runtime-localization-20260718-v2/english-runtime");
const evidence = path.join(project, ".gameforge", "verification", "locale-running.png");
await mkdir(path.dirname(evidence), { recursive: true });

const html = await readFile(path.join(project, "index.html"), "utf8");
if (!html.includes('<html lang="en-US">') || !html.includes('aria-label="GameForge generated game"')) {
  throw new Error("Generated static HTML locale is incorrect.");
}

const server = spawn(process.execPath, [path.join(project, "node_modules", "vite", "bin", "vite.js"), "--host", "127.0.0.1", "--port", "5198"], {
  cwd: project,
  stdio: ["ignore", "pipe", "pipe"],
});

const waitForServer = async () => {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch("http://127.0.0.1:5198/");
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Timed out waiting for generated game preview.");
};

let browser;
try {
  await waitForServer();
  browser = await chromium.launch({ channel: "chrome", headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const consoleErrors = [];
  const pageErrors = [];
  const failedRequests = [];
  const failedResponses = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(`${message.text()} @ ${message.location().url}`);
  });
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("requestfailed", (request) => failedRequests.push(request.url()));
  page.on("response", (response) => {
    if (response.status() >= 400) failedResponses.push(`${response.status()} ${response.url()}`);
  });
  await page.goto("http://127.0.0.1:5198/", { waitUntil: "networkidle" });
  await page.waitForFunction(() => window.__GAMEFORGE_TEST__?.status === "running");
  const snapshot = await page.evaluate(() => ({
    lang: document.documentElement.lang,
    state: window.__GAMEFORGE_TEST__,
    canvas: document.querySelector("canvas")?.getBoundingClientRect().toJSON(),
  }));
  await page.screenshot({ path: evidence });
  if (snapshot.lang !== "en-US" || snapshot.state.status !== "running") {
    throw new Error(`Unexpected runtime snapshot: ${JSON.stringify(snapshot)}`);
  }
  if (consoleErrors.length || pageErrors.length || failedRequests.length || failedResponses.length) {
    throw new Error(JSON.stringify({ consoleErrors, pageErrors, failedRequests, failedResponses }));
  }
  console.log(JSON.stringify({ ...snapshot, evidence, diagnostics: { consoleErrors: 0, pageErrors: 0, failedRequests: 0 } }, null, 2));
} finally {
  await browser?.close();
  server.kill();
}
