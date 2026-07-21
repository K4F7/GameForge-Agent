import { orderCollectTelemetrySchema, projectIdSchema, simulationPointSchema } from "@gameforge/contracts";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { access, lstat, mkdir, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright-core";
import { createServer, type ViteDevServer } from "vite";
import { z } from "zod";

const MAX_DIAGNOSTICS = 100;
const MAX_MESSAGE_LENGTH = 1_000;
const PHASER_PACKAGE = createRequire(import.meta.url).resolve("phaser/package.json");
const PHASER_ENTRY = path.join(path.dirname(PHASER_PACKAGE), "dist", "phaser.esm.js");

export const verificationActionSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("press"), key: z.string().trim().min(1).max(40) }),
  z.strictObject({
    type: z.literal("hold"),
    key: z.string().trim().min(1).max(40),
    durationMs: z.number().int().min(1).max(10_000),
  }),
  z.strictObject({
    type: z.literal("click"),
    x: z.number().int().min(0).max(4_096),
    y: z.number().int().min(0).max(4_096),
  }),
  z.strictObject({
    type: z.literal("drag"),
    fromX: z.number().int().min(0).max(4_096),
    fromY: z.number().int().min(0).max(4_096),
    toX: z.number().int().min(0).max(4_096),
    toY: z.number().int().min(0).max(4_096),
    durationMs: z.number().int().min(1).max(10_000).default(250),
  }),
  z.strictObject({
    type: z.literal("drag-to-telemetry"),
    target: z.enum(["collectible", "hazard"]),
    index: z.number().int().min(0).max(99).default(0),
    durationMs: z.number().int().min(1).max(10_000).default(250),
  }),
  z.strictObject({ type: z.literal("wait"), durationMs: z.number().int().min(1).max(10_000) }),
]);

export const verifyGameRequestSchema = z.strictObject({
  projectId: projectIdSchema,
  actions: z.array(verificationActionSchema).max(100).default([]),
  expectedOutcome: z.enum(["running", "won", "lost"]).optional(),
  timeoutMs: z.number().int().min(1_000).max(120_000).default(30_000),
});

const verificationStateSchema = z.strictObject({
  status: z.enum(["running", "won", "lost"]),
  score: z.number().int().nonnegative(),
  lives: z.number().int(),
  remainingSeconds: z.number().nonnegative(),
  detail: z.string().max(1_000).optional(),
  telemetry: z.strictObject({
    player: simulationPointSchema,
    collectibles: z.array(simulationPointSchema).max(100),
    hazards: z.array(simulationPointSchema).max(100),
  }).optional(),
  simulation: orderCollectTelemetrySchema.optional(),
});

const managedProjectSchema = z.object({ projectId: projectIdSchema });

export type VerificationAction = z.infer<typeof verificationActionSchema>;
export type VerifyGameRequest = z.input<typeof verifyGameRequestSchema>;
export type VerificationState = z.infer<typeof verificationStateSchema>;
export type VerificationReport = {
  projectId: string;
  passed: boolean;
  state: VerificationState;
  screenshotPath: string;
  evidencePath: string;
  canvas: { width: number; height: number };
  consoleErrors: ReadonlyArray<string>;
  pageErrors: ReadonlyArray<string>;
  failedRequests: ReadonlyArray<string>;
  actionsExecuted: number;
  durationMs: number;
};
export type OrderCollectWebVerificationReport = Readonly<{
  projectId: string;
  passed: true;
  win: VerificationReport & { state: VerificationState & { status: "won" } };
  loss: VerificationReport & { state: VerificationState & { status: "lost" } };
}>;

export type VerificationSession = {
  onConsoleError(listener: (message: string) => void): void;
  onPageError(listener: (message: string) => void): void;
  onRequestFailed(listener: (message: string) => void): void;
  goto(url: string, timeoutMs: number): Promise<void>;
  waitUntilReady(timeoutMs: number): Promise<void>;
  perform(action: VerificationAction): Promise<void>;
  readState(): Promise<unknown>;
  readCanvas(): Promise<{ width: number; height: number; nonBlank: boolean } | null>;
  screenshot(target: string): Promise<void>;
  close(): Promise<void>;
};

export type VerificationRuntime = {
  startServer(projectPath: string): Promise<{ url: string; close(): Promise<void> }>;
  startSession(allowedOrigin: string): Promise<VerificationSession>;
};

export type GameVerifierOptions = {
  projectsRoot: string;
  chromeExecutablePath?: string;
  runtime?: VerificationRuntime;
};

export class GameVerifier {
  readonly #projectsRoot: string;
  readonly #runtime: VerificationRuntime;

  constructor(options: GameVerifierOptions) {
    if (!path.isAbsolute(options.projectsRoot)) throw new Error("Verifier projects root must be absolute.");
    const projectsRoot = path.resolve(options.projectsRoot);
    if (path.parse(projectsRoot).root === projectsRoot) throw new Error("Verifier projects root cannot be a filesystem root.");
    this.#projectsRoot = projectsRoot;
    this.#runtime = options.runtime ?? new PlaywrightVerificationRuntime(options.chromeExecutablePath);
  }

  async verify(request: VerifyGameRequest): Promise<VerificationReport> {
    const input = verifyGameRequestSchema.parse(request);
    const startedAt = Date.now();
    const projectPath = await verifiedManagedProject(this.#projectsRoot, input.projectId);
    const screenshotPath = await this.#screenshotPath(projectPath);
    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];
    const failedRequests: string[] = [];
    const remaining = (stage: string): number => {
      const value = input.timeoutMs - (Date.now() - startedAt);
      if (value <= 0) throw new Error(`Verifier ${stage} exceeded the total timeout.`);
      return value;
    };
    let server: Awaited<ReturnType<VerificationRuntime["startServer"]>> | undefined;
    let session: VerificationSession | undefined;
    try {
      server = await withTimeoutAndLateCleanup(
        this.#runtime.startServer(projectPath),
        remaining("server startup"),
        "Verifier server startup timed out.",
        (lateServer) => lateServer.close(),
      );
      const origin = new URL(server.url).origin;
      session = await withTimeoutAndLateCleanup(
        this.#runtime.startSession(origin),
        remaining("browser startup"),
        "Verifier browser startup timed out.",
        (lateSession) => lateSession.close(),
      );
      session.onConsoleError((message) => pushDiagnostic(consoleErrors, message));
      session.onPageError((message) => pushDiagnostic(pageErrors, message));
      session.onRequestFailed((message) => pushDiagnostic(failedRequests, message));
      await withTimeout(session.goto(server.url, remaining("navigation")), remaining("navigation"), "Verifier navigation timed out.");
      await withTimeout(session.waitUntilReady(remaining("readiness")), remaining("readiness"), "Verifier readiness timed out.");
      for (const action of input.actions) {
        await withTimeout(session.perform(action), remaining("actions"), "Verifier actions exceeded the total timeout.");
      }
      const state = verificationStateSchema.parse(await withTimeout(session.readState(), remaining("state read"), "Verifier state read timed out."));
      const canvas = await withTimeout(session.readCanvas(), remaining("canvas read"), "Verifier canvas read timed out.");
      if (canvas === null || canvas.width < 1 || canvas.height < 1) {
        throw new Error("Generated game did not expose a visible canvas.");
      }
      if (!canvas.nonBlank) throw new Error("Generated game canvas is blank.");
      await withTimeout(session.screenshot(screenshotPath), remaining("screenshot"), "Verifier screenshot timed out.");
      const passed = consoleErrors.length === 0 && pageErrors.length === 0 && failedRequests.length === 0 &&
        (input.expectedOutcome === undefined || state.status === input.expectedOutcome);
      return {
        projectId: input.projectId,
        passed,
        state,
        screenshotPath,
        evidencePath: `.gameforge/verification/${path.basename(screenshotPath)}`,
        canvas,
        consoleErrors,
        pageErrors,
        failedRequests,
        actionsExecuted: input.actions.length,
        durationMs: Date.now() - startedAt,
      };
    } catch (error) {
      throw new Error(verificationFailureMessage(error, { consoleErrors, pageErrors, failedRequests }));
    } finally {
      await withTimeout(session?.close() ?? Promise.resolve(), 10_000, "Verifier browser cleanup timed out.")
        .catch(() => undefined);
      await withTimeout(server?.close() ?? Promise.resolve(), 10_000, "Verifier server cleanup timed out.")
        .catch(() => undefined);
    }
  }

  async verifyOrderCollectDualTerminal(projectId: string): Promise<OrderCollectWebVerificationReport> {
    const winActions: VerificationAction[] = Array.from({ length: 6 }, () => ({
      type: "drag-to-telemetry", target: "collectible", index: 0, durationMs: 250,
    }));
    const lossActions: VerificationAction[] = [];
    for (let index = 0; index < 3; index += 1) {
      lossActions.push({ type: "drag-to-telemetry", target: "hazard", index: 1, durationMs: 250 });
      if (index < 2) lossActions.push({ type: "wait", durationMs: 1_000 });
    }
    const win = await this.verify({ projectId, actions: winActions, expectedOutcome: "won", timeoutMs: 30_000 });
    const loss = await this.verify({ projectId, actions: lossActions, expectedOutcome: "lost", timeoutMs: 30_000 });
    if (!win.passed || win.state.status !== "won") throw new Error("Order-collect Web win verification failed.");
    if (!loss.passed || loss.state.status !== "lost") throw new Error("Order-collect Web loss verification failed.");
    return {
      projectId,
      passed: true,
      win: win as VerificationReport & { state: VerificationState & { status: "won" } },
      loss: loss as VerificationReport & { state: VerificationState & { status: "lost" } },
    };
  }

  async #screenshotPath(projectPath: string): Promise<string> {
    const metadata = await verifiedDirectory(path.join(projectPath, ".gameforge"), "Verifier metadata directory");
    const directory = path.join(metadata, "verification");
    const info = await lstat(directory).catch(() => undefined);
    if (info === undefined) await mkdir(directory);
    else if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("Verifier screenshot directory is unsafe.");
    return path.join(directory, `${randomUUID()}.png`);
  }
}

export class PlaywrightVerificationRuntime implements VerificationRuntime {
  readonly #chromeExecutablePath: string | undefined;
  readonly #launch: typeof chromium.launch;
  readonly #runtimeVersions: Readonly<Record<string, string | undefined>>;

  constructor(chromeExecutablePath?: string, options: {
    launch?: typeof chromium.launch;
    runtimeVersions?: Readonly<Record<string, string | undefined>>;
  } = {}) {
    if (chromeExecutablePath !== undefined && !path.isAbsolute(chromeExecutablePath)) {
      throw new Error("Chrome executable path must be absolute.");
    }
    this.#chromeExecutablePath = chromeExecutablePath;
    this.#launch = options.launch ?? chromium.launch.bind(chromium);
    this.#runtimeVersions = options.runtimeVersions ?? process.versions;
  }

  async startServer(projectPath: string): Promise<{ url: string; close(): Promise<void> }> {
    let server: ViteDevServer | undefined;
    try {
      server = await withTimeout(createServer({
        root: projectPath,
        configFile: false,
        logLevel: "silent",
        resolve: { alias: { phaser: PHASER_ENTRY } },
        optimizeDeps: { noDiscovery: true, include: [] },
        server: { host: "127.0.0.1", port: 0, strictPort: false, cors: true },
      }), 10_000, "Verifier Vite creation timed out.");
      await withTimeout(server.listen(), 10_000, "Verifier Vite listen timed out.");
    } catch (error) {
      await (server === undefined ? Promise.resolve() : closeVite(server)).catch(() => undefined);
      throw error;
    }
    const address = server.httpServer?.address();
    if (address === undefined || address === null || typeof address === "string") {
      await server.close();
      throw new Error("Verifier could not determine the local Vite port.");
    }
    return {
      url: `http://127.0.0.1:${address.port}/`,
      close: () => closeVite(server),
    };
  }

  async startSession(allowedOrigin: string): Promise<VerificationSession> {
    assertSupportedPlaywrightRuntime(this.#runtimeVersions);
    if (this.#chromeExecutablePath !== undefined) {
      const executable = await lstat(this.#chromeExecutablePath).catch(() => undefined);
      if (executable === undefined || !executable.isFile() || executable.isSymbolicLink()) {
        throw new Error("Configured Chrome executable must be an accessible regular file.");
      }
      await access(this.#chromeExecutablePath).catch(() => {
        throw new Error("Configured Chrome executable must be an accessible regular file.");
      });
    }
    let browser: Browser | undefined;
    try {
      browser = await this.#launch({
        headless: true,
        timeout: 30_000,
        ...(this.#chromeExecutablePath === undefined
          ? { channel: "chrome" as const }
          : { executablePath: this.#chromeExecutablePath }),
      });
      const context = await withTimeout(browser.newContext({
        viewport: { width: 1_280, height: 800 },
        serviceWorkers: "block",
      }), 10_000, "Chrome context creation timed out.");
      const page = await withTimeout(context.newPage(), 10_000, "Chrome page creation timed out.");
      await withTimeout(page.route("**/*", async (route) => {
        const url = new URL(route.request().url());
        if (url.origin === allowedOrigin || url.protocol === "data:" || url.protocol === "blob:") await route.continue();
        else await route.abort("blockedbyclient");
      }), 10_000, "Chrome route setup timed out.");
      return new PlaywrightSession(browser, page);
    } catch (error) {
      await browser?.close().catch(() => undefined);
      const mode = this.#chromeExecutablePath === undefined ? "channel chrome" : "configured executable";
      const cause = error instanceof Error ? error.message : String(error);
      throw new Error(`Chrome session startup failed using ${mode}: ${cause}`);
    }
  }
}

export function assertSupportedPlaywrightRuntime(versions: Readonly<Record<string, string | undefined>>): void {
  if (versions.bun !== undefined) {
    throw new Error(
      "System Chrome verification requires the Node runtime; build first and run the MCP/verifier entry with node, not bun.",
    );
  }
}

class PlaywrightSession implements VerificationSession {
  readonly #browser: Browser;
  readonly #page: Page;

  constructor(browser: Browser, page: Page) {
    this.#browser = browser;
    this.#page = page;
  }

  onConsoleError(listener: (message: string) => void): void {
    this.#page.on("console", (message) => {
      if (message.type() === "error") listener(message.text());
    });
  }

  onPageError(listener: (message: string) => void): void {
    this.#page.on("pageerror", (error) => listener(error.message));
  }

  onRequestFailed(listener: (message: string) => void): void {
    this.#page.on("requestfailed", (request) => {
      listener(`${request.method()} ${request.url()} — ${request.failure()?.errorText ?? "failed"}`);
    });
  }

  async goto(url: string, timeoutMs: number): Promise<void> {
    await this.#page.goto(url, { waitUntil: "domcontentloaded", timeout: timeoutMs });
  }

  async waitUntilReady(timeoutMs: number): Promise<void> {
    await this.#page.waitForFunction(
      () => {
        const canvas = document.querySelector("canvas");
        const state = window.__GAMEFORGE_TEST__ as unknown as {
          status?: "running" | "won" | "lost";
          telemetry?: {
            player: { x: number; y: number };
            collectibles: Array<{ x: number; y: number }>;
            hazards: Array<{ x: number; y: number }>;
          };
        };
        if (
          canvas === null || typeof state !== "object" || state === null ||
          !("telemetry" in state) || typeof state.telemetry !== "object" || state.telemetry === null
        ) return false;
        const bounds = canvas.getBoundingClientRect();
        const style = getComputedStyle(canvas);
        return canvas.width > 0 && canvas.height > 0 && bounds.width > 0 && bounds.height > 0 &&
          style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity || "1") > 0;
      },
      undefined,
      { timeout: timeoutMs },
    );
  }

  async perform(action: VerificationAction): Promise<void> {
    if (action.type === "press") await this.#page.keyboard.press(action.key);
    if (action.type === "hold") {
      await this.#page.keyboard.down(action.key);
      await this.#page.waitForTimeout(action.durationMs);
      await this.#page.keyboard.up(action.key);
    }
    if (action.type === "click") await this.#page.mouse.click(action.x, action.y);
    if (action.type === "drag") {
      await this.#page.mouse.move(action.fromX, action.fromY);
      await this.#page.mouse.down();
      await this.#page.mouse.move(action.toX, action.toY, { steps: Math.max(2, Math.ceil(action.durationMs / 16)) });
      await this.#page.mouse.up();
    }
    if (action.type === "drag-to-telemetry") {
      const coordinates = await this.#page.evaluate(({ target, index }) => {
        const canvas = document.querySelector("canvas");
        const state = window.__GAMEFORGE_TEST__ as unknown as {
          status?: "running" | "won" | "lost";
          telemetry?: {
            player: { x: number; y: number };
            collectibles: Array<{ x: number; y: number }>;
            hazards: Array<{ x: number; y: number }>;
          };
        };
        if (canvas === null || state.telemetry === undefined) return null;
        if (state.status !== "running") return { terminal: true as const };
        const points = target === "collectible" ? state.telemetry.collectibles : state.telemetry.hazards;
        const destination = points[index];
        if (destination === undefined) return state.status === "running" ? null : { terminal: true as const };
        const bounds = canvas.getBoundingClientRect();
        const map = (point: { x: number; y: number }): { x: number; y: number } => ({
          x: bounds.left + point.x / canvas.width * bounds.width,
          y: bounds.top + point.y / canvas.height * bounds.height,
        });
        return { terminal: false as const, from: map(state.telemetry.player), to: map(destination) };
      }, { target: action.target, index: action.index });
      if (coordinates === null) throw new Error(`Telemetry target is unavailable: ${action.target}[${action.index}].`);
      if (coordinates.terminal) return;
      await this.#page.mouse.move(coordinates.from.x, coordinates.from.y);
      await this.#page.mouse.down();
      await this.#page.mouse.move(coordinates.to.x, coordinates.to.y, { steps: Math.max(2, Math.ceil(action.durationMs / 16)) });
      await this.#page.mouse.up();
      await this.#page.waitForTimeout(32);
    }
    if (action.type === "wait") await this.#page.waitForTimeout(action.durationMs);
  }

  readState(): Promise<unknown> {
    return this.#page.evaluate(() => window.__GAMEFORGE_TEST__);
  }

  async readCanvas(): Promise<{ width: number; height: number; nonBlank: boolean } | null> {
    const dimensions = await this.#page.evaluate(() => {
      const canvas = document.querySelector("canvas");
      if (canvas === null) return null;
      return { width: canvas.width, height: canvas.height };
    });
    if (dimensions === null) return null;
    const screenshot = await this.#page.locator("canvas").screenshot({ type: "png" });
    const imageUrl = `data:image/png;base64,${screenshot.toString("base64")}`;
    const nonBlank = await this.#page.evaluate(async (source) => {
      const image = new Image();
      image.src = source;
      await image.decode();
      const sample = document.createElement("canvas");
      sample.width = 32;
      sample.height = 32;
      const context = sample.getContext("2d", { willReadFrequently: true });
      if (context === null) return false;
      context.drawImage(image, 0, 0, sample.width, sample.height);
      const pixels = context.getImageData(0, 0, sample.width, sample.height).data;
      const first = [pixels[0], pixels[1], pixels[2], pixels[3]].join(",");
      let nonBlank = false;
      for (let offset = 4; offset < pixels.length; offset += 4) {
        if ([pixels[offset], pixels[offset + 1], pixels[offset + 2], pixels[offset + 3]].join(",") !== first) {
          nonBlank = true;
          break;
        }
      }
      return nonBlank;
    }, imageUrl);
    return { ...dimensions, nonBlank };
  }

  async screenshot(target: string): Promise<void> {
    await this.#page.screenshot({ path: target, type: "png", fullPage: true });
  }

  async close(): Promise<void> {
    await this.#browser.close();
  }
}

async function closeVite(server: ViteDevServer): Promise<void> {
  const httpServer = server.httpServer;
  if (httpServer !== null && httpServer !== undefined && "closeAllConnections" in httpServer) {
    httpServer.closeAllConnections();
  }
  await server.close();
}

export async function verifiedManagedProject(projectsRoot: string, projectIdInput: string): Promise<string> {
  const projectId = projectIdSchema.parse(projectIdInput);
  const root = await verifiedDirectory(projectsRoot, "Verifier projects root");
  const project = path.resolve(root, projectId);
  if (path.dirname(project).toLowerCase() !== root.toLowerCase()) throw new Error("Verifier project escaped its root.");
  const realProject = await verifiedDirectory(project, "Verifier project");
  if (path.dirname(realProject).toLowerCase() !== root.toLowerCase()) throw new Error("Verifier project escaped its root.");
  const managed = managedProjectSchema.parse(JSON.parse(
    await readFile(path.join(realProject, ".gameforge", "manifest.json"), "utf8"),
  ) as unknown);
  if (managed.projectId !== projectId) throw new Error("Verifier project manifest ID does not match.");
  return realProject;
}

async function verifiedDirectory(target: string, label: string): Promise<string> {
  const info = await lstat(target).catch(() => undefined);
  if (info === undefined || !info.isDirectory() || info.isSymbolicLink()) {
    throw new Error(`${label} must be an existing real directory.`);
  }
  return realpath(target);
}

function pushDiagnostic(target: string[], message: string): void {
  if (target.length >= MAX_DIAGNOSTICS) return;
  target.push(message.replace(/[\r\n]+/g, " ").slice(0, MAX_MESSAGE_LENGTH));
}

function verificationFailureMessage(
  error: unknown,
  diagnostics: {
    consoleErrors: ReadonlyArray<string>;
    pageErrors: ReadonlyArray<string>;
    failedRequests: ReadonlyArray<string>;
  },
): string {
  const cause = error instanceof Error ? error.message : "Unknown browser verification failure.";
  const details = [
    ...diagnostics.consoleErrors.slice(0, 5).map((message) => `console: ${message}`),
    ...diagnostics.pageErrors.slice(0, 5).map((message) => `page: ${message}`),
    ...diagnostics.failedRequests.slice(0, 5).map((message) => `request: ${message}`),
  ];
  return details.length === 0 ? cause : `${cause} Diagnostics: ${details.join(" | ")}`;
}

declare global {
  interface Window {
    __GAMEFORGE_TEST__?: unknown;
  }
}

async function withTimeout<T>(operation: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export async function withTimeoutAndLateCleanup<T>(
  operation: Promise<T>,
  timeoutMs: number,
  message: string,
  cleanup: (value: T) => Promise<void>,
): Promise<T> {
  try {
    return await withTimeout(operation, timeoutMs, message);
  } catch (error) {
    void operation.then((value) => cleanup(value)).catch(() => undefined);
    throw error;
  }
}
