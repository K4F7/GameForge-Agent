import { gamePreviewUrlSchema, projectIdSchema } from "@gameforge/contracts";
import path from "node:path";
import { z } from "zod";
import { PlaywrightVerificationRuntime, verifiedManagedProject, withTimeoutAndLateCleanup } from "./verifier.js";

const START_TIMEOUT_MS = 30_000;
const CLOSE_TIMEOUT_MS = 10_000;

export const gamePreviewRequestSchema = z.strictObject({ projectId: projectIdSchema });

export type GamePreviewRequest = z.infer<typeof gamePreviewRequestSchema>;
export type GamePreviewResult = { projectId: string; url: string; reused: boolean };
export type StopGamePreviewResult = { projectId: string; stopped: boolean };

export type GamePreviewRuntime = {
  startServer(projectPath: string): Promise<{ url: string; close(): Promise<void> }>;
};

export type GamePreviewManagerOptions = {
  projectsRoot: string;
  maxSessions?: number;
  runtime?: GamePreviewRuntime;
};

type ActivePreview = {
  url: string;
  close(): Promise<void>;
};

export class GamePreviewManager {
  readonly #maxSessions: number;
  readonly #projectsRoot: string;
  readonly #runtime: GamePreviewRuntime;
  readonly #sessions = new Map<string, ActivePreview>();
  readonly #starting = new Map<string, Promise<GamePreviewResult>>();

  constructor(options: GamePreviewManagerOptions) {
    if (!path.isAbsolute(options.projectsRoot)) throw new Error("Preview projects root must be absolute.");
    const projectsRoot = path.resolve(options.projectsRoot);
    if (path.parse(projectsRoot).root === projectsRoot) throw new Error("Preview projects root cannot be a filesystem root.");
    const maxSessions = options.maxSessions ?? 5;
    if (!Number.isSafeInteger(maxSessions) || maxSessions < 1 || maxSessions > 20) {
      throw new Error("Preview maxSessions must be an integer between 1 and 20.");
    }
    this.#projectsRoot = projectsRoot;
    this.#maxSessions = maxSessions;
    this.#runtime = options.runtime ?? new PlaywrightVerificationRuntime();
  }

  async start(request: GamePreviewRequest): Promise<GamePreviewResult> {
    const { projectId } = gamePreviewRequestSchema.parse(request);
    const active = this.#sessions.get(projectId);
    if (active !== undefined) return { projectId, url: active.url, reused: true };
    const starting = this.#starting.get(projectId);
    if (starting !== undefined) {
      const result = await starting;
      return { ...result, reused: true };
    }
    if (this.#sessions.size + this.#starting.size >= this.#maxSessions) {
      throw new Error(`Preview session capacity has been reached (${this.#maxSessions}).`);
    }

    const operation = this.#start(projectId);
    this.#starting.set(projectId, operation);
    try {
      return await operation;
    } finally {
      this.#starting.delete(projectId);
    }
  }

  async #start(projectId: string): Promise<GamePreviewResult> {
    const projectPath = await verifiedManagedProject(this.#projectsRoot, projectId);
    const server = await withTimeoutAndLateCleanup(
      this.#runtime.startServer(projectPath),
      START_TIMEOUT_MS,
      "Preview server startup timed out.",
      (lateServer) => lateServer.close(),
    );
    try {
      const url = gamePreviewUrlSchema.parse(server.url);
      this.#sessions.set(projectId, { url, close: server.close });
      return { projectId, url, reused: false };
    } catch (error) {
      await withTimeout(server.close(), CLOSE_TIMEOUT_MS, "Preview server cleanup timed out.")
        .catch(() => undefined);
      throw error;
    }
  }

  async stop(request: GamePreviewRequest): Promise<StopGamePreviewResult> {
    const { projectId } = gamePreviewRequestSchema.parse(request);
    await this.#starting.get(projectId)?.catch(() => undefined);
    const active = this.#sessions.get(projectId);
    if (active === undefined) return { projectId, stopped: false };
    this.#sessions.delete(projectId);
    await withTimeout(active.close(), CLOSE_TIMEOUT_MS, "Preview server cleanup timed out.");
    return { projectId, stopped: true };
  }

  async closeAll(): Promise<void> {
    await Promise.allSettled(this.#starting.values());
    const sessions = [...this.#sessions.values()];
    this.#sessions.clear();
    await Promise.allSettled(sessions.map((session) =>
      withTimeout(session.close(), CLOSE_TIMEOUT_MS, "Preview server cleanup timed out.")));
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
