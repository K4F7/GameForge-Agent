import {
  attemptIdSchema,
  candidateContentManifestSchema,
  projectIdSchema,
  revisionIdSchema,
  taskAcceptanceContractSchema,
} from "@gameforge/contracts";
import { createHash, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { access, lstat, mkdir, readFile, readdir, realpath } from "node:fs/promises";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright-core";
import { createServer, type ViteDevServer } from "vite";
import { z } from "zod";

const MAX_DIAGNOSTICS = 100;
const MAX_MESSAGE_LENGTH = 1_000;
const MAX_CANDIDATE_BYTES = 20 * 1024 * 1024;
const MAX_CANDIDATE_FILES = 4_096;
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

export const verificationScenarioSchema = z.enum(["won", "lost"]);
export const verificationScenarioPlanSchema = z.strictObject({
  schemaVersion: z.literal(1),
  scenarios: z.strictObject({
    won: z.array(verificationActionSchema).min(1).max(100),
    lost: z.array(verificationActionSchema).min(1).max(100),
  }),
});

export const verifyGameRequestSchema = z.strictObject({
  projectId: projectIdSchema,
  attemptId: attemptIdSchema.optional(),
  revisionId: revisionIdSchema.optional(),
  actions: z.array(verificationActionSchema).max(100).default([]),
  scenario: verificationScenarioSchema.optional(),
  expectedOutcome: z.enum(["running", "won", "lost"]).optional(),
  acceptanceContract: taskAcceptanceContractSchema.optional(),
  timeoutMs: z.number().int().min(1_000).max(120_000).default(30_000),
}).superRefine((request, context) => {
  for (const [index, action] of request.actions.entries()) {
    if (!isPublicPlayerAction(action)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["actions", index], message: "Only normal player input actions are allowed." });
    }
  }
  if (request.acceptanceContract !== undefined) {
    for (const [index, criterion] of request.acceptanceContract.criteria.entries()) {
      const verification = criterion.verification;
      if (verification.kind === "public-telemetry" && !isPublicTelemetryPath(verification.path)) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ["acceptanceContract", "criteria", index, "verification", "path"], message: "Telemetry path is outside the public verification state." });
      }
      if (verification.kind === "dom-output" && !isPublicDomSelector(verification.selector)) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ["acceptanceContract", "criteria", index, "verification", "selector"], message: "DOM selector is outside the public output seam." });
      }
      if (verification.kind === "browser-action" && !isPublicActionDescription(verification.action)) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ["acceptanceContract", "criteria", index, "verification", "action"], message: "Browser action is outside the normal player input seam." });
      }
    }
  }
});

const publicStateScalarSchema = z.union([z.string().max(2_000), z.number().finite(), z.boolean(), z.null()]);
const verificationStateSchema = z.strictObject({
  schemaVersion: z.literal(1),
  status: z.enum(["running", "won", "lost"]),
  score: z.number().int().nonnegative(),
  lives: z.number().int(),
  remainingSeconds: z.number().nonnegative(),
  detail: z.string().max(1_000).optional(),
  telemetry: z.strictObject({
    player: z.strictObject({ x: z.number().finite(), y: z.number().finite() }),
    collectibles: z.array(z.strictObject({ x: z.number().finite(), y: z.number().finite() })).max(100),
    hazards: z.array(z.strictObject({ x: z.number().finite(), y: z.number().finite() })).max(100),
    boss: z.strictObject({ x: z.number().finite(), y: z.number().finite(), hp: z.number().finite(), maxHp: z.number().positive() }).optional(),
    exit: z.strictObject({ x: z.number().finite(), y: z.number().finite() }).optional(),
  }).optional(),
}).catchall(publicStateScalarSchema).superRefine((state, context) => {
  if (Object.keys(state).length > 32) {
    context.addIssue({ code: "custom", message: "Public verification state has too many fields." });
  }
});
const legacyVerificationStateSchema = z.strictObject({
  schemaVersion: z.literal(1).optional(),
  status: z.enum(["running", "won", "lost"]),
  score: z.number().int().nonnegative(),
  lives: z.number().int(),
  remainingSeconds: z.number().nonnegative(),
  detail: z.string().max(1_000).optional(),
  telemetry: z.strictObject({
    player: z.strictObject({ x: z.number().finite(), y: z.number().finite() }),
    collectibles: z.array(z.strictObject({ x: z.number().finite(), y: z.number().finite() })).max(100),
    hazards: z.array(z.strictObject({ x: z.number().finite(), y: z.number().finite() })).max(100),
    boss: z.strictObject({ x: z.number().finite(), y: z.number().finite(), hp: z.number().finite(), maxHp: z.number().positive() }).optional(),
    exit: z.strictObject({ x: z.number().finite(), y: z.number().finite() }).optional(),
  }).optional(),
}).catchall(publicStateScalarSchema).superRefine((state, context) => {
  if (Object.keys(state).length > 32) {
    context.addIssue({ code: "custom", message: "Public verification state has too many fields." });
  }
});

const managedProjectSchema = z.object({
  projectId: projectIdSchema,
  verificationStateSchemaVersion: z.literal(1).optional(),
});

export type VerificationAction = z.infer<typeof verificationActionSchema>;
export type VerifyGameRequest = z.input<typeof verifyGameRequestSchema>;
export type VerificationState = Omit<z.infer<typeof verificationStateSchema>, "schemaVersion"> & {
  schemaVersion?: 1 | undefined;
};
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
  criteria?: ReadonlyArray<VerificationCriterionResult>;
  scenarioResults?: ReadonlyArray<Omit<VerificationReport, "scenarioResults"> & {
    scenario: z.infer<typeof verificationScenarioSchema>;
  }>;
};

export type VerificationCriterionResult = {
  criterionId: string;
  passed: boolean;
  advisory?: boolean;
  proof: {
    kind: "browser-action" | "public-telemetry" | "dom-output" | "screenshot" | "human-review";
    value?: unknown;
    evidencePath?: string;
    detail?: string;
  };
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
  readDom?(selector: string): Promise<string | null>;
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
    return this.#verifyRequest(request, false);
  }

  async #verifyRequest(request: VerifyGameRequest, internal: boolean, deadline?: number): Promise<VerificationReport> {
    const callStartedAt = Date.now();
    const input = verifyGameRequestSchema.parse(request);
    const requestDeadline = deadline ?? callStartedAt + input.timeoutMs;
    if ((input.attemptId === undefined) !== (input.revisionId === undefined)) {
      throw new Error("Verifier candidate selection requires both Attempt and Revision identity.");
    }
    if (!internal && input.attemptId !== undefined) {
      const candidatePath = await verifiedCandidateProject(this.#projectsRoot, input.projectId, input.attemptId, input.revisionId!);
      if (input.acceptanceContract === undefined) {
        throw new Error("Verifier candidate selection requires its frozen acceptance contract.");
      }
      const candidateManifest = candidateContentManifestSchema.parse(JSON.parse(
        await readFile(path.join(candidatePath, ".gameforge", "candidate.json"), "utf8"),
      ) as unknown);
      const fingerprintSource = {
        schemaVersion: input.acceptanceContract.schemaVersion,
        contractVersion: input.acceptanceContract.contractVersion,
        criteria: input.acceptanceContract.criteria,
      };
      const recomputedFingerprint = createHash("sha256")
        .update(JSON.stringify(fingerprintSource), "utf8")
        .digest("hex");
      if (recomputedFingerprint !== input.acceptanceContract.fingerprint) {
        throw new Error("Caller contract contents do not match its fingerprint.");
      }
      if (candidateManifest.acceptanceContractFingerprint !== input.acceptanceContract.fingerprint) {
        throw new Error("Caller contract does not match the candidate acceptance fingerprint.");
      }
      try {
        await readVerificationScenario(candidatePath, "won");
        await readVerificationScenario(candidatePath, "lost");
      } catch {
        throw new Error("Verifier candidate must provide both won and lost scenarios through normal player input.");
      }
      const won = await this.#verifyRequest(
        { ...input, actions: [], scenario: "won", expectedOutcome: "won" },
        true,
        requestDeadline,
      );
      const lost = await this.#verifyRequest(
        { ...input, actions: [], scenario: "lost", expectedOutcome: "lost" },
        true,
        requestDeadline,
      );
      return {
        ...won,
        passed: won.passed && lost.passed,
        actionsExecuted: won.actionsExecuted,
        durationMs: Date.now() - callStartedAt,
        criteria: [...(won.criteria ?? []), ...(lost.criteria ?? [])],
        scenarioResults: [{ ...won, scenario: "won" }, { ...lost, scenario: "lost" }],
      };
    }
    const startedAt = callStartedAt;
    const projectPath = input.attemptId === undefined
      ? await verifiedManagedProject(this.#projectsRoot, input.projectId)
      : await verifiedCandidateProject(this.#projectsRoot, input.projectId, input.attemptId, input.revisionId!);
    const requiresVersionedState = input.attemptId !== undefined || await managedProjectUsesVersionedState(projectPath);
    const parseState = (value: unknown): VerificationState => requiresVersionedState
      ? verificationStateSchema.parse(value)
      : verificationStateSchema.parse({ ...legacyVerificationStateSchema.parse(value), schemaVersion: 1 });
    if (input.scenario !== undefined && input.actions.length > 0) {
      throw new Error("Verifier scenario and inline actions are mutually exclusive.");
    }
    if (input.scenario !== undefined && input.expectedOutcome !== undefined && input.expectedOutcome !== input.scenario) {
      throw new Error("Verifier scenario must match expectedOutcome when both are provided.");
    }
    const actions = input.scenario === undefined ? input.actions : await readVerificationScenario(projectPath, input.scenario);
    const expectedOutcome = input.expectedOutcome ?? input.scenario;
    const screenshotPath = await this.#screenshotPath(projectPath);
    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];
    const failedRequests: string[] = [];
    const remaining = (stage: string): number => {
      const value = requestDeadline - Date.now();
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
      const baselineState = parseState(await withTimeout(
        session.readState(),
        remaining("baseline state read"),
        "Verifier baseline state read timed out.",
      ));
      const baselineDom = new Map<string, string | null>();
      for (const selector of changedToDomSelectors(input.acceptanceContract)) {
        baselineDom.set(selector, await readPublicDom(session, selector, remaining));
      }
      for (const action of actions) {
        await withTimeout(session.perform(action), remaining("actions"), "Verifier actions exceeded the total timeout.");
      }
      const state = parseState(await withTimeout(session.readState(), remaining("state read"), "Verifier state read timed out."));
      const canvas = await withTimeout(session.readCanvas(), remaining("canvas read"), "Verifier canvas read timed out.");
      if (canvas === null || canvas.width < 1 || canvas.height < 1) {
        throw new Error("Generated game did not expose a visible canvas.");
      }
      await withTimeout(session.screenshot(screenshotPath), remaining("screenshot"), "Verifier screenshot timed out.");
      const criteria = await evaluateCriteria(input.acceptanceContract, {
        actions,
        baselineState,
        baselineDom,
        state,
        ...(input.scenario === undefined ? {} : { scenario: input.scenario }),
        screenshotPath,
        session,
        remaining,
      });
      const passed = consoleErrors.length === 0 && pageErrors.length === 0 && failedRequests.length === 0 &&
        (expectedOutcome === undefined || state.status === expectedOutcome) && criteria.every((criterion) => criterion.passed || criterion.advisory === true);
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
        actionsExecuted: actions.length,
        durationMs: Date.now() - startedAt,
        criteria,
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

  async #screenshotPath(projectPath: string): Promise<string> {
    const metadata = await verifiedDirectory(path.join(projectPath, ".gameforge"), "Verifier metadata directory");
    const directory = path.join(metadata, "verification");
    await mkdir(directory).catch((error) => {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    });
    const info = await lstat(directory);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("Verifier screenshot directory is unsafe.");
    return path.join(directory, `${randomUUID()}.png`);
  }
}

async function readVerificationScenario(projectPath: string, scenario: z.infer<typeof verificationScenarioSchema>): Promise<VerificationAction[]> {
  const metadata = await verifiedDirectory(path.join(projectPath, ".gameforge"), "Verifier metadata directory");
  const target = path.join(metadata, "verification-scenarios.json");
  const info = await lstat(target).catch(() => undefined);
  if (info === undefined || !info.isFile() || info.isSymbolicLink() || info.size > 64 * 1024) {
    throw new Error("Verifier scenario plan must be a regular JSON file no larger than 64 KiB.");
  }
  const plan = verificationScenarioPlanSchema.parse(JSON.parse(await readFile(target, "utf8")) as unknown);
  return plan.scenarios[scenario];
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
        const state = window.__GAMEFORGE_TEST__;
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

  readDom(selector: string): Promise<string | null> {
    return this.#page.locator(selector).first().getAttribute("data-status");
  }

  async screenshot(target: string): Promise<void> {
    await this.#page.screenshot({ path: target, type: "png", fullPage: true });
  }

  async close(): Promise<void> {
    await this.#browser.close();
  }
}

type CriterionContext = {
  actions: ReadonlyArray<VerificationAction>;
  baselineState: VerificationState;
  baselineDom: ReadonlyMap<string, string | null>;
  state: VerificationState;
  scenario?: z.infer<typeof verificationScenarioSchema>;
  screenshotPath: string;
  session: VerificationSession;
  remaining(stage: string): number;
};

async function evaluateCriteria(
  contract: z.infer<typeof taskAcceptanceContractSchema> | undefined,
  context: CriterionContext,
): Promise<ReadonlyArray<VerificationCriterionResult>> {
  if (contract === undefined) return [];
  const applicable = contract.criteria.filter((criterion) =>
    context.scenario === undefined ||
    (criterion.applicableScenarios ?? ["won"]).includes(context.scenario)
  );
  return Promise.all(applicable.map(async (criterion) => {
    const verification = criterion.verification;
    if (verification.kind === "browser-action") {
      const actionExecuted = context.actions.some((action) => describeAction(action) === verification.action.trim());
      const effect = verification.observableEffect;
      const value = effect.kind === "public-telemetry"
        ? readPublicPath(context.state, normalizePublicTelemetryPath(effect.path))
        : await readPublicDom(context.session, effect.selector, context.remaining);
      const baselineValue = effect.kind === "public-telemetry"
        ? readPublicPath(context.baselineState, normalizePublicTelemetryPath(effect.path))
        : context.baselineDom.get(normalizePublicDomSelector(effect.selector));
      const passed = actionExecuted && matchesAssertion(value, effect.assertion, baselineValue);
      return { criterionId: criterion.criterionId, passed, proof: { kind: verification.kind, value, detail: passed ? "Action produced the required public effect." : "Action did not produce the required public effect." } };
    }
    if (verification.kind === "public-telemetry") {
      const value = readPublicPath(context.state, normalizePublicTelemetryPath(verification.path));
      const baselineValue = readPublicPath(context.baselineState, normalizePublicTelemetryPath(verification.path));
      const passed = matchesAssertion(value, verification.assertion, baselineValue);
      return { criterionId: criterion.criterionId, passed, proof: { kind: verification.kind, value, detail: passed ? "Public telemetry matched expected value." : "Public telemetry did not match expected value." } };
    }
    if (verification.kind === "dom-output") {
      if (!isPublicDomSelector(verification.selector)) {
        return { criterionId: criterion.criterionId, passed: false, proof: { kind: verification.kind, detail: "DOM selector is outside the public output seam." } };
      }
      const value = await readPublicDom(context.session, verification.selector, context.remaining);
      const baselineValue = context.baselineDom.get(normalizePublicDomSelector(verification.selector));
      const passed = matchesAssertion(value, verification.assertion, baselineValue);
      return { criterionId: criterion.criterionId, passed, proof: { kind: verification.kind, value, detail: passed ? "DOM output matched expected text." : "DOM output did not match expected text." } };
    }
    if (verification.kind === "screenshot") {
      return { criterionId: criterion.criterionId, passed: false, advisory: true, proof: { kind: verification.kind, evidencePath: `.gameforge/verification/${path.basename(context.screenshotPath)}`, detail: `Final-state screenshot recorded; checkpoint-aligned evidence for ${verification.checkpoint} was not produced. Human review is required.` } };
    }
    return { criterionId: criterion.criterionId, passed: false, advisory: true, proof: { kind: verification.kind, detail: "Human review is required." } };
  }));
}

async function readPublicDom(
  session: VerificationSession,
  selector: string,
  remaining: (stage: string) => number,
): Promise<string | null> {
  if (!isPublicDomSelector(selector) || session.readDom === undefined) return null;
  return withTimeout(
    session.readDom(normalizePublicDomSelector(selector)),
    remaining("criterion DOM read"),
    "Verifier criterion DOM read timed out.",
  );
}

function matchesAssertion(
  actual: unknown,
  assertion: { comparator: "equals" | "includes" | "changed-to"; value: string | number | boolean | null },
  baseline: unknown,
): boolean {
  if (assertion.comparator === "includes") {
    return typeof actual === "string" && typeof assertion.value === "string" && actual.includes(assertion.value);
  }
  if (assertion.comparator === "changed-to") {
    return !Object.is(baseline, assertion.value) && Object.is(actual, assertion.value);
  }
  return Object.is(actual, assertion.value);
}

function changedToDomSelectors(
  contract: z.infer<typeof taskAcceptanceContractSchema> | undefined,
): ReadonlyArray<string> {
  if (contract === undefined) return [];
  const selectors = new Set<string>();
  for (const criterion of contract.criteria) {
    const verification = criterion.verification;
    if (verification.kind === "dom-output" && verification.assertion.comparator === "changed-to") {
      selectors.add(normalizePublicDomSelector(verification.selector));
    }
    if (verification.kind === "browser-action" &&
      verification.observableEffect.kind === "dom-output" &&
      verification.observableEffect.assertion.comparator === "changed-to") {
      selectors.add(normalizePublicDomSelector(verification.observableEffect.selector));
    }
  }
  return [...selectors];
}

function isPublicPlayerAction(action: unknown): action is VerificationAction {
  return verificationActionSchema.safeParse(action).success;
}

function isPublicActionDescription(value: string): boolean {
  return /^(?:press|hold|click|wait)\b/.test(value.trim()) && !/(?:evaluate|execute|set[-_ ]?state|call[-_ ]?outcome|skip|scene|private|__GAMEFORGE_TEST__)/i.test(value);
}

function isPublicTelemetryPath(value: string): boolean {
  if (value.trim() === "game.status") return true;
  if (!/^\$\.?[a-zA-Z][a-zA-Z0-9]*(?:\.[a-zA-Z][a-zA-Z0-9]*)*$/.test(value.trim())) return false;
  return !/(?:^|\.)(?:scene|game|private|__|prototype|constructor|finish|outcome)(?:\.|$)/i.test(value);
}

function isPublicDomSelector(value: string): boolean {
  return ["[data-status]", "[data-game-status]"].includes(value.trim());
}

function normalizePublicTelemetryPath(value: string): string {
  return value.trim() === "game.status" ? "$.status" : value;
}

function normalizePublicDomSelector(value: string): string {
  return value.trim() === "[data-game-status]" ? "[data-status]" : value;
}

function describeAction(action: VerificationAction): string {
  if (action.type === "press") return `press ${action.key}`;
  if (action.type === "hold") return `hold ${action.key} ${action.durationMs}ms`;
  if (action.type === "click") return `click ${action.x},${action.y}`;
  return `wait ${action.durationMs}ms`;
}

function readPublicPath(value: unknown, input: string): unknown {
  const pathParts = input.replace(/^\$\.?/, "").split(".").filter(Boolean);
  let current: unknown = value;
  for (const part of pathParts) {
    if (typeof current !== "object" || current === null || !Object.prototype.hasOwnProperty.call(current, part)) return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
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

async function managedProjectUsesVersionedState(projectPath: string): Promise<boolean> {
  const managed = managedProjectSchema.parse(JSON.parse(
    await readFile(path.join(projectPath, ".gameforge", "manifest.json"), "utf8"),
  ) as unknown);
  return managed.verificationStateSchemaVersion === 1;
}

export async function verifiedCandidateProject(
  projectsRoot: string,
  projectIdInput: string,
  attemptIdInput: string,
  revisionIdInput: string,
): Promise<string> {
  const projectId = projectIdSchema.parse(projectIdInput);
  const attemptId = attemptIdSchema.parse(attemptIdInput);
  const revisionId = revisionIdSchema.parse(revisionIdInput);
  const root = await verifiedDirectory(projectsRoot, "Verifier projects root");
  const metadata = await verifiedChildDirectory(root, ".gameforge", "Verifier metadata directory");
  const candidates = await verifiedChildDirectory(metadata, "candidates", "Verifier candidates directory");
  const candidateRoot = await verifiedChildDirectory(candidates, attemptId, "Verifier Attempt candidate");
  const project = await verifiedChildDirectory(candidateRoot, projectId, "Verifier candidate project");
  const manifestPath = path.join(project, ".gameforge", "candidate.json");
  const manifestInfo = await lstat(manifestPath).catch(() => undefined);
  if (manifestInfo === undefined || !manifestInfo.isFile() || manifestInfo.isSymbolicLink() || manifestInfo.size > 2 * 1024 * 1024) {
    throw new Error("Verifier candidate manifest must be a bounded regular file.");
  }
  const manifest = candidateContentManifestSchema.parse(JSON.parse(await readFile(manifestPath, "utf8")) as unknown);
  if (manifest.projectId !== projectId || manifest.attemptId !== attemptId || manifest.revisionId !== revisionId) {
    throw new Error("Verifier candidate manifest identity does not match the request.");
  }
  const files = await collectCandidateFiles(project);
  const totalBytes = files.reduce((total, file) => total + file.bytes, 0);
  const aggregateSha256 = createHash("sha256").update(JSON.stringify(files), "utf8").digest("hex");
  if (
    totalBytes !== manifest.totalBytes || aggregateSha256 !== manifest.aggregateSha256 ||
    JSON.stringify(files) !== JSON.stringify(manifest.files)
  ) throw new Error("Verifier candidate content does not match its manifest.");
  return project;
}

async function verifiedChildDirectory(parent: string, name: string, label: string): Promise<string> {
  const target = path.resolve(parent, name);
  if (path.dirname(target).toLowerCase() !== parent.toLowerCase()) throw new Error(`${label} escaped its parent.`);
  const child = await verifiedDirectory(target, label);
  if (path.dirname(child).toLowerCase() !== parent.toLowerCase()) throw new Error(`${label} escaped its parent.`);
  return child;
}

async function collectCandidateFiles(root: string): Promise<Array<{ path: string; bytes: number; sha256: string }>> {
  const files: Array<{ path: string; bytes: number; sha256: string }> = [];
  let totalBytes = 0;
  const visit = async (directory: string, relativeDirectory: string): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const relative = relativeDirectory === "" ? entry.name : `${relativeDirectory}/${entry.name}`;
      if (relative === ".gameforge/candidate.json" || relative.startsWith(".gameforge/verification/")) continue;
      const target = path.join(root, ...relative.split("/"));
      const info = await lstat(target);
      if (info.isSymbolicLink()) throw new Error(`Verifier candidate contains a symbolic link: ${relative}`);
      if (info.isDirectory()) {
        await visit(target, relative);
        continue;
      }
      if (!info.isFile()) throw new Error(`Verifier candidate contains a non-file entry: ${relative}`);
      if (files.length >= MAX_CANDIDATE_FILES) throw new Error("Verifier candidate exceeds the maximum file count.");
      totalBytes += info.size;
      if (totalBytes > MAX_CANDIDATE_BYTES) throw new Error("Verifier candidate exceeds the maximum content size.");
      const content = await readFile(target);
      files.push({ path: relative, bytes: content.byteLength, sha256: createHash("sha256").update(content).digest("hex") });
    }
  };
  await visit(root, "");
  return files;
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
