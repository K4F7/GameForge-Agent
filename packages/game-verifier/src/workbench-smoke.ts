import { chmod, lstat, mkdir, open, realpath, writeFile } from "node:fs/promises";
import {
  createServer as createHttpServer,
  request as createHttpRequest,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { extname, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { WireRunEvent } from "@gameforge/contracts";
import { createRunRelayServer } from "@gameforge/run-relay";
import { RunRelayClient } from "@gameforge/run-relay/client";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright-core";
import { build as buildVite } from "vite";
import { assertSupportedPlaywrightRuntime, withTimeoutAndLateCleanup } from "./verifier.js";

type SmokeReport = {
  ok: true;
  runId: string;
  taskId: string;
  lastSequence: number;
  assertions: ReadonlyArray<string>;
  diagnostics: { consoleErrors: number; pageErrors: number; failedRequests: number; expectedStreamAborts: number };
  screenshot: string;
};

let smokeRunning = false;

export async function runWorkbenchSmoke(): Promise<SmokeReport> {
  if (smokeRunning) throw new Error("A Workbench smoke is already running in this process.");
  smokeRunning = true;
  try {
    return await runWorkbenchSmokeOnce();
  } finally {
    smokeRunning = false;
  }
}

async function runWorkbenchSmokeOnce(): Promise<SmokeReport> {
  assertSupportedPlaywrightRuntime(process.versions);
  const workspaceRoot = resolve(import.meta.dirname, "../../..");
  const outputDirectory = resolve(workspaceRoot, "output/playwright");
  const screenshotPath = resolve(outputDirectory, "workbench-smoke.png");
  const reportPath = resolve(outputDirectory, "workbench-smoke.json");
  const workbench = createHttpServer();
  const preview = createPreviewServer();
  let relay: Server | undefined;
  let browser: Browser | undefined;
  let context: BrowserContext | undefined;
  const originalRelayUrl = process.env.VITE_AGENT_BASE_URL;
  const originalPreviewUrl = process.env.VITE_GAME_PREVIEW_URL;
  try {
    const [workbenchPort, previewPort] = await Promise.all([listenRandom(workbench), listenRandom(preview)]);
    const workbenchUrl = `http://127.0.0.1:${workbenchPort}/`;
    const previewUrl = `http://127.0.0.1:${previewPort}/`;
    relay = createRunRelayServer();
    const relayPort = await listenRandom(relay);
    const relayUrl = `http://127.0.0.1:${relayPort}/`;
    const suffix = `${Date.now()}-${process.pid}`;
    const runId = `workbench-smoke-${suffix}`;
    process.env.VITE_AGENT_BASE_URL = `${workbenchUrl}relay/`;
    process.env.VITE_GAME_PREVIEW_URL = previewUrl;
    const workbenchRoot = resolve(workspaceRoot, "apps/workbench");
    await buildVite({
      root: resolve(workspaceRoot, "apps/workbench"),
      configFile: resolve(workspaceRoot, "apps/workbench/vite.config.ts"),
      logLevel: "error",
    });
    workbench.on("request", createWorkbenchHandler(resolve(workbenchRoot, "dist"), relayUrl));
    browser = await withTimeoutAndLateCleanup(chromium.launch({
      headless: true,
      ...(process.env.GAMEFORGE_CHROME_EXECUTABLE?.trim()
        ? { executablePath: process.env.GAMEFORGE_CHROME_EXECUTABLE.trim() }
        : { channel: "chrome" }),
    }), 30_000, "Workbench Chrome launch", async (lateBrowser) => lateBrowser.close());
    context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const allowedOrigins = new Set([new URL(workbenchUrl).origin, new URL(previewUrl).origin]);
    await context.route("**/*", async (route) => {
      const url = new URL(route.request().url());
      const method = route.request().method();
      const allowed = ["data:", "blob:"].includes(url.protocol) ||
        (url.origin === new URL(workbenchUrl).origin && (
          (["GET", "HEAD"].includes(method) && (url.pathname === "/" || url.pathname.startsWith("/assets/"))) ||
          (url.pathname === "/relay/tasks" && ["GET", "POST"].includes(method)) ||
          ([`/relay/runs/${encodeURIComponent(runId)}/events`, `/relay/runs/${encodeURIComponent(runId)}/stream`]
            .includes(url.pathname) && method === "GET")
        )) ||
        (url.origin === new URL(previewUrl).origin && url.pathname === "/" && method === "GET") ||
        false;
      if (allowed && (allowedOrigins.has(url.origin) || ["data:", "blob:"].includes(url.protocol))) {
        await route.continue();
      } else await route.abort("blockedbyclient");
    });
    const page = await context.newPage();
    const diagnostics = observeDiagnostics(page);
    await page.goto(workbenchUrl, { waitUntil: "networkidle" });
    const initialPreviewSource = await page.getByTitle("生成游戏预览").getAttribute("src");
    if (initialPreviewSource !== previewUrl) {
      throw new Error(`Workbench smoke preview environment was not applied: ${initialPreviewSource ?? "missing"}`);
    }
    const promptInput = page.getByRole("textbox", { name: "游戏需求", exact: true });
    const programmerButton = page.getByRole("button", { name: "将 @程序员 添加到游戏需求" });
    const artistButton = page.getByRole("button", { name: "将 @美术 添加到游戏需求" });
    await promptInput.fill("Create a complete browser safety game with one verified collectible.");
    await programmerButton.click();
    await artistButton.click();
    if (await programmerButton.getAttribute("aria-pressed") !== "true" ||
        await artistButton.getAttribute("aria-pressed") !== "true") {
      throw new Error("Workbench specialist buttons did not expose their active state.");
    }
    await page.getByText("已点名 2 位", { exact: true }).waitFor({ state: "visible" });
    await page.getByLabel("生成语言").selectOption("en-US");
    await page.getByLabel("Run ID").fill(runId);
    await page.getByRole("button", { name: "提交给 CodeArts" }).click();
    if (!(await promptInput.isDisabled()) || !(await programmerButton.isDisabled()) || !(await artistButton.isDisabled())) {
      throw new Error("Workbench task inputs were not locked while the Relay connection was active.");
    }

    const client = new RunRelayClient({ baseUrl: relayUrl });
    const task = await waitForTask(client, runId);
    if (task.requestedSpecialists.join(",") !== "programmer,artist") {
      throw new Error(`Workbench submitted unexpected specialists: ${task.requestedSpecialists.join(",")}`);
    }
    await client.claimTask(task.taskId, { agentId: "workbench-smoke" });
    await client.publishEvents({ runId, after: 1, events: fixtureEvents(runId, previewUrl) });
    const completed = await client.completeRun(runId);
    const replay = await client.replayEvents({ runId, after: 0 });
    const expectedSequences = Array.from({ length: completed.sequence }, (_, index) => index + 1);
    if (replay.events.map((event) => event.sequence).join(",") !== expectedSequences.join(",")) {
      throw new Error("Relay replay did not contain a contiguous Workbench smoke sequence.");
    }

    const assertions: string[] = [];
    assertions.push("specialist buttons update Prompt and expose active state");
    assertions.push("task inputs lock while Relay connection is active");
    assertions.push("Relay Task preserves programmer and artist specialist metadata");
    await expectText(page, "@程序员 @美术", assertions);
    await expectText(page, "Schema 有效", assertions);
    await expectText(page, "Smoke Safety Game", assertions);
    await expectText(page, "运行已到终态", assertions);
    await page.getByRole("button", { name: "资产与授权" }).click();
    await expectText(page, "Asset Manifest", assertions);
    await page.locator(".section-title .count-badge").filter({ hasText: "1" }).waitFor({ state: "visible" });
    assertions.push("asset manifest count is 1");
    await expectText(page, "验收通过", assertions);
    await expectText(page, "构建通过", assertions);
    await expectText(page, "LayaAir 3.4.0", assertions);
    const progress = await page.getByLabel("阶段完成百分比").getAttribute("value");
    if (progress !== "100") throw new Error(`Workbench progress was not complete: ${progress ?? "missing"}`);
    assertions.push("phase progress is 100%");
    const succeededPhases = await page.locator(".timeline-list > li.succeeded").count();
    if (succeededPhases !== 7) throw new Error(`Workbench rendered ${succeededPhases} succeeded phases instead of 7.`);
    assertions.push("all 7 phases succeeded");
    assertions.push(`relay replay is contiguous through sequence ${completed.sequence}`);
    const iframeSource = await page.getByTitle("生成游戏预览").getAttribute("src");
    if (iframeSource !== previewUrl) throw new Error(`Workbench preview iframe used unexpected URL: ${iframeSource ?? "missing"}`);
    assertions.push("preview iframe uses preview.ready URL");
    await page.getByTitle("生成游戏预览").contentFrame().getByText("GameForge smoke preview").waitFor();
    assertions.push("preview iframe rendered controlled content");
    await prepareOutput(outputDirectory, [screenshotPath, reportPath]);
    await page.screenshot({ path: screenshotPath, fullPage: true });
    await chmod(screenshotPath, 0o600);
    await page.waitForTimeout(100);
    const unexpectedFailedRequests = diagnostics.failedRequests.filter((failure) =>
      !(failure.url.includes(`/runs/${runId}/stream`) && failure.errorText === "net::ERR_ABORTED")
    );
    if (diagnostics.consoleErrors.length > 0 || diagnostics.pageErrors.length > 0 || unexpectedFailedRequests.length > 0) {
      throw new Error(`Workbench browser diagnostics were not empty: ${JSON.stringify(diagnostics)}`);
    }
    const report: SmokeReport = {
      ok: true,
      runId,
      taskId: task.taskId,
      lastSequence: completed.sequence,
      assertions,
      diagnostics: {
        consoleErrors: diagnostics.consoleErrors.length,
        pageErrors: diagnostics.pageErrors.length,
        failedRequests: unexpectedFailedRequests.length,
        expectedStreamAborts: diagnostics.failedRequests.length - unexpectedFailedRequests.length,
      },
      screenshot: "output/playwright/workbench-smoke.png",
    };
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    await chmod(reportPath, 0o600);
    return report;
  } finally {
    restoreEnvironment("VITE_AGENT_BASE_URL", originalRelayUrl);
    restoreEnvironment("VITE_GAME_PREVIEW_URL", originalPreviewUrl);
    await context?.close().catch(() => undefined);
    await browser?.close().catch(() => undefined);
    await Promise.all([close(workbench), close(relay), close(preview)]);
  }
}

function fixtureEvents(runId: string, previewUrl: string): WireRunEvent[] {
  const emittedAt = new Date().toISOString();
  const sha256 = "a".repeat(64);
  return [
    { type: "spec.ready", runId, sequence: 2, emittedAt, spec: {
      title: "Smoke Safety Game", locale: "en-US", genre: "arcade",
      objective: "Collect the safety token before the timer expires.", controls: ["Arrow keys"],
      winCondition: "Collect the safety token.", loseCondition: "The timer expires.",
      targetDurationSeconds: 60,
      gameplay: { collectibleCount: 1, hazardCount: 0, startingLives: 3, movementSpeed: 220 },
    } },
    { type: "asset.ready", runId, sequence: 3, emittedAt, projectId: "workbench-smoke", manifestRevision: 1,
      entry: { assetId: "collect", kind: "sound", role: "collect-sound", path: "assets/collect.wav",
        mimeType: "audio/wav", bytes: 128, sha256, provenance: { assetId: "collect", kind: "sound",
          origin: "retrieved", provider: "freesound", sourceUrl: "https://freesound.org/s/42/",
          license: "CC0", sha256 } } },
    { type: "phase.completed", runId, sequence: 4, emittedAt, phase: "spec", detail: "GameSpec validated" },
    { type: "phase.completed", runId, sequence: 5, emittedAt, phase: "template", detail: "Managed template selected" },
    { type: "phase.completed", runId, sequence: 6, emittedAt, phase: "assets", detail: "Runtime assets prepared" },
    { type: "phase.completed", runId, sequence: 7, emittedAt, phase: "code", detail: "Managed source generated" },
    { type: "phase.completed", runId, sequence: 8, emittedAt, phase: "build", detail: "Managed build passed" },
    { type: "build.ready", runId, sequence: 9, emittedAt, projectId: "workbench-smoke",
      target: "douyin-mini-game", cliVersion: "3.4.0", passed: true, fileCount: 16,
      totalBytes: 1_108_438, mainPackageBytes: 1_108_438, subpackages: [], deviceOrientation: "portrait",
      capabilities: { network: false, login: false, share: false, ads: false, payments: false },
      allowedNetworkHosts: [], assetManifestRevision: 1, assetCount: 1,
      stdoutTruncated: false, stderrTruncated: false },
    { type: "phase.completed", runId, sequence: 10, emittedAt, phase: "test", detail: "Automated tests passed" },
    { type: "phase.completed", runId, sequence: 11, emittedAt, phase: "visual", detail: "Browser verification passed" },
    { type: "preview.ready", runId, sequence: 12, emittedAt, projectId: "workbench-smoke", url: previewUrl },
    { type: "verification.ready", runId, sequence: 13, emittedAt, projectId: "workbench-smoke", passed: true,
      outcome: "won", score: 1, lives: 3, remainingSeconds: 42,
      evidencePath: ".gameforge/verification/workbench-smoke.png", canvas: { width: 960, height: 540 },
      diagnostics: { consoleErrors: 0, pageErrors: 0, failedRequests: 0 }, actionsExecuted: 2, durationMs: 250 },
    { type: "log.appended", runId, sequence: 14, emittedAt, source: "agent", level: "success",
      message: "Deterministic Workbench browser smoke completed." },
  ];
}

function observeDiagnostics(page: Page): {
  consoleErrors: string[];
  pageErrors: string[];
  failedRequests: Array<{ url: string; errorText: string }>;
} {
  const diagnostics = {
    consoleErrors: [] as string[],
    pageErrors: [] as string[],
    failedRequests: [] as Array<{ url: string; errorText: string }>,
  };
  page.on("console", (message) => { if (message.type() === "error") diagnostics.consoleErrors.push(message.text()); });
  page.on("pageerror", (error) => diagnostics.pageErrors.push(error.message));
  page.on("requestfailed", (request) => diagnostics.failedRequests.push({
    url: request.url(),
    errorText: request.failure()?.errorText ?? "unknown",
  }));
  return diagnostics;
}

async function expectText(page: Page, text: string, assertions: string[]): Promise<void> {
  await page.getByText(text, { exact: false }).first().waitFor({ state: "visible" });
  assertions.push(`visible text: ${text}`);
}

async function waitForTask(client: RunRelayClient, runId: string) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const task = (await client.listTasks({ limit: 20 })).find((candidate) => candidate.runId === runId);
    if (task !== undefined) return task;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Workbench did not submit its Task within the smoke timeout.");
}

function createPreviewServer(): Server {
  return createHttpServer((_request, response) => {
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'" });
    response.end("<!doctype html><html><head><style>html,body{height:100%;margin:0}body{display:grid;place-items:center;background:#111827;color:#e5e7eb;font:600 28px system-ui}</style></head><body><main>GameForge smoke preview</main></body></html>");
  });
}

function createWorkbenchHandler(distRoot: string, relayUrl: string) {
  return (request: IncomingMessage, response: ServerResponse): void => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (url.pathname === "/relay" || url.pathname.startsWith("/relay/")) {
      proxyRelay(request, response, new URL(`${url.pathname.slice("/relay".length)}${url.search}`, relayUrl));
      return;
    }
    void serveWorkbenchFile(request, response, distRoot, url.pathname);
  };
}

function proxyRelay(request: IncomingMessage, response: ServerResponse, target: URL): void {
  const headers = { ...request.headers };
  delete headers.host;
  delete headers.origin;
  const upstream = createHttpRequest(target, { method: request.method, headers }, (upstreamResponse) => {
    response.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.headers);
    upstreamResponse.pipe(response);
  });
  response.once("close", () => upstream.destroy());
  upstream.once("error", () => {
    if (!response.headersSent) response.writeHead(502, { "Content-Type": "application/json" });
    response.end('{"error":"relay_proxy_failed"}');
  });
  request.pipe(upstream);
}

async function serveWorkbenchFile(
  request: IncomingMessage,
  response: ServerResponse,
  distRoot: string,
  pathname: string,
): Promise<void> {
  if (!["GET", "HEAD"].includes(request.method ?? "")) {
    response.writeHead(405).end();
    return;
  }
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    response.writeHead(400).end();
    return;
  }
  const file = resolve(distRoot, decoded === "/" ? "index.html" : `.${decoded}`);
  const fromRoot = relative(distRoot, file);
  if (fromRoot.startsWith("..") || fromRoot === "" || fromRoot.includes("\0")) {
    response.writeHead(404).end();
    return;
  }
  try {
    const rootRealPath = await realpath(distRoot);
    const pathMetadata = await lstat(file);
    if (pathMetadata.isSymbolicLink() || !pathMetadata.isFile()) throw new Error("invalid static file");
    const fileRealPath = await realpath(file);
    const fromRealRoot = relative(rootRealPath, fileRealPath);
    if (fromRealRoot.startsWith("..") || fromRealRoot === "") throw new Error("static file escaped build root");
    const handle = await open(fileRealPath, "r");
    let body: Buffer;
    try {
      const [handleMetadata, currentPathMetadata] = await Promise.all([handle.stat(), lstat(file)]);
      if (!handleMetadata.isFile() || handleMetadata.size > 5 * 1024 * 1024 ||
          currentPathMetadata.isSymbolicLink() || currentPathMetadata.dev !== handleMetadata.dev ||
          currentPathMetadata.ino !== handleMetadata.ino) {
        throw new Error("static file identity changed");
      }
      body = await handle.readFile();
    } finally {
      await handle.close();
    }
    response.writeHead(200, {
      "Content-Type": staticMimeType(file),
      "Content-Length": String(body.length),
      "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; connect-src 'self'; frame-src http://127.0.0.1:* http://localhost:*; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
      "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
    });
    if (request.method === "HEAD") response.end();
    else response.end(body);
  } catch {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("Not found");
  }
}

function staticMimeType(file: string): string {
  switch (extname(file)) {
    case ".html": return "text/html; charset=utf-8";
    case ".js": return "text/javascript; charset=utf-8";
    case ".css": return "text/css; charset=utf-8";
    case ".json": return "application/json; charset=utf-8";
    case ".svg": return "image/svg+xml";
    default: return "application/octet-stream";
  }
}

async function listenRandom(server: Server): Promise<number> {
  await new Promise<void>((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolvePromise);
  });
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("Could not allocate a loopback port.");
  return address.port;
}

async function close(server: Server | undefined): Promise<void> {
  if (server?.listening !== true) return;
  await new Promise<void>((resolvePromise) => {
    server.close(() => resolvePromise());
    server.closeAllConnections();
  });
}

async function prepareOutput(directory: string, files: readonly string[]): Promise<void> {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const directoryStat = await lstat(directory);
  if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) {
    throw new Error("Workbench smoke output directory must be a real directory.");
  }
  await chmod(directory, 0o700);
  for (const file of files) {
    try {
      const stat = await lstat(file);
      if (!stat.isFile() || stat.isSymbolicLink()) {
        throw new Error("Workbench smoke output targets must be regular files.");
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
}

function restoreEnvironment(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  runWorkbenchSmoke().then(
    (report) => process.stdout.write(`${JSON.stringify(report, null, 2)}\n`),
    (error: unknown) => {
      process.stderr.write(`${error instanceof Error ? error.message : "Workbench smoke failed."}\n`);
      process.exitCode = 1;
    },
  );
}
