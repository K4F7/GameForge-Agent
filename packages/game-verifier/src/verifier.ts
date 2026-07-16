import { projectIdSchema } from "@gameforge/contracts";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { lstat, mkdir, readFile, realpath } from "node:fs/promises";
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
    player: z.strictObject({ x: z.number().finite(), y: z.number().finite() }),
    collectibles: z.array(z.strictObject({ x: z.number().finite(), y: z.number().finite() })).max(100),
    hazards: z.array(z.strictObject({ x: z.number().finite(), y: z.number().finite() })).max(100),
  }).optional(),
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

export type VerificationSession = {
  onConsoleError(listener: (message: string) => void): void;
  onPageError(listener: (message: string) => void): void;
  onRequestFailed(listener: (message: string) => void): void;
  goto(url: string, timeoutMs: number): Promise<void>;
  waitUntilReady(timeoutMs: number): Promise<void>;
  perform(action: VerificationAction): Promise<void>;
  readState(): Promise<unknown>;
  readCanvas(): Promise<{ width: number; height: number } | null>;
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
    const server = await withTimeout(
      this.#runtime.startServer(projectPath),
      input.timeoutMs,
      "Verifier server startup timed out.",
    );
    let session: VerificationSession | undefined;
    try {
      const origin = new URL(server.url).origin;
      session = await withTimeout(
        this.#runtime.startSession(origin),
        input.timeoutMs,
        "Verifier browser startup timed out.",
      );
      session.onConsoleError((message) => pushDiagnostic(consoleErrors, message));
      session.onPageError((message) => pushDiagnostic(pageErrors, message));
      session.onRequestFailed((message) => pushDiagnostic(failedRequests, message));
      await session.goto(server.url, input.timeoutMs);
      await session.waitUntilReady(input.timeoutMs);
      for (const action of input.actions) await session.perform(action);
      const state = verificationStateSchema.parse(await session.readState());
      const canvas = await session.readCanvas();
      if (canvas === null || canvas.width < 1 || canvas.height < 1) {
        throw new Error("Generated game did not expose a visible canvas.");
      }
      await session.screenshot(screenshotPath);
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
      await withTimeout(server.close(), 10_000, "Verifier server cleanup timed out.")
        .catch(() => undefined);
    }
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

  constructor(chromeExecutablePath?: string) {
    if (chromeExecutablePath !== undefined && !path.isAbsolute(chromeExecutablePath)) {
      throw new Error("Chrome executable path must be absolute.");
    }
    this.#chromeExecutablePath = chromeExecutablePath;
  }

  async startServer(projectPath: string): Promise<{ url: string; close(): Promise<void> }> {
    const server = await createServer({
      root: projectPath,
      configFile: false,
      logLevel: "silent",
      resolve: { alias: { phaser: PHASER_ENTRY } },
      optimizeDeps: { noDiscovery: true, include: [] },
      server: { host: "127.0.0.1", port: 0, strictPort: false },
    });
    await server.listen();
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
    const browser = await chromium.launch({
      headless: true,
      ...(this.#chromeExecutablePath === undefined
        ? { channel: "chrome" as const }
        : { executablePath: this.#chromeExecutablePath }),
    });
    const context = await browser.newContext({
      viewport: { width: 1_280, height: 800 },
      serviceWorkers: "block",
    });
    const page = await context.newPage();
    await page.route("**/*", async (route) => {
      const url = new URL(route.request().url());
      if (url.origin === allowedOrigin || url.protocol === "data:" || url.protocol === "blob:") await route.continue();
      else await route.abort("blockedbyclient");
    });
    return new PlaywrightSession(browser, page);
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
      () => document.querySelector("canvas") !== null && window.__GAMEFORGE_TEST__ !== undefined,
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
    if (action.type === "wait") await this.#page.waitForTimeout(action.durationMs);
  }

  readState(): Promise<unknown> {
    return this.#page.evaluate(() => window.__GAMEFORGE_TEST__);
  }

  readCanvas(): Promise<{ width: number; height: number } | null> {
    return this.#page.evaluate(() => {
      const canvas = document.querySelector("canvas");
      return canvas === null ? null : { width: canvas.width, height: canvas.height };
    });
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
