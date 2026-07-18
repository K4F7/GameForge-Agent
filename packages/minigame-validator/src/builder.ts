import { randomUUID } from "node:crypto";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { lstat, mkdir, open, readFile, realpath, unlink } from "node:fs/promises";
import path from "node:path";
import {
  managedGeneratedProjectManifestSchema,
  projectIdSchema,
  type MiniGameLocalHandoffManifest,
} from "@gameforge/contracts";
import {
  validateDouyinMiniGameProject,
  validateWechatMiniGameProject,
  type DouyinMiniGameValidationReport,
  type WechatMiniGameValidationReport,
} from "./index.js";
import { assertMiniGameHandoffSnapshot, createMiniGameLocalHandoffManifest } from "./handoff.js";

const EXPECTED_LAYAAIR_VERSION = "3.4.0";
const MAX_LOG_BYTES = 64 * 1024;
const DEFAULT_TIMEOUT_MS = 120_000;

export type DouyinMiniGameBuildResult = {
  projectId: string;
  cliVersion: "3.4.0";
  outputPath: string;
  validation: DouyinMiniGameValidationReport;
  handoff: MiniGameLocalHandoffManifest;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
};

export type WechatMiniGameBuildResult = Omit<DouyinMiniGameBuildResult, "validation"> & {
  validation: WechatMiniGameValidationReport;
};

type BuilderOptions = { projectsRoot: string; cliPath: string; timeoutMs?: number; cliPrefixArgs?: string[] };
type ResolvedLayaCli = { command: string; prefixArgs: string[]; versionVerified: boolean };

class LayaMiniGameBuilder {
  readonly #projectsRoot: string;
  readonly #cliPath: string;
  readonly #timeoutMs: number;
  readonly #cliPrefixArgs: string[];
  readonly #target: "douyin-mini-game" | "wechat-mini-game";
  readonly #cliTarget: "bytedancegame" | "wxgame";

  constructor(options: BuilderOptions, target: "douyin-mini-game" | "wechat-mini-game") {
    if (!path.isAbsolute(options.projectsRoot) || path.parse(path.resolve(options.projectsRoot)).root === path.resolve(options.projectsRoot)) {
      throw new Error("Laya builder projects root must be an absolute non-root path.");
    }
    if (!path.isAbsolute(options.cliPath)) throw new Error("LayaAir CLI path must be absolute.");
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 5_000 || timeoutMs > 300_000) {
      throw new Error("Laya builder timeout must be between 5000 and 300000 milliseconds.");
    }
    this.#projectsRoot = path.resolve(options.projectsRoot);
    this.#cliPath = path.resolve(options.cliPath);
    this.#timeoutMs = timeoutMs;
    this.#target = target;
    this.#cliTarget = target === "douyin-mini-game" ? "bytedancegame" : "wxgame";
    this.#cliPrefixArgs = options.cliPrefixArgs?.map((value) => {
      if (value.length === 0 || /[\0\r\n]/.test(value)) throw new Error("LayaAir CLI prefix argument is invalid.");
      return value;
    }) ?? [];
  }

  async build(projectIdInput: string): Promise<DouyinMiniGameBuildResult | WechatMiniGameBuildResult> {
    const projectId = projectIdSchema.parse(projectIdInput);
    const { project, manifest } = await verifiedManagedProject(this.#projectsRoot, projectId);
    if (manifest.target !== this.#target) throw new Error(`LayaAir build requires a managed ${this.#target} project.`);
    const cli = await resolveLayaCli(this.#cliPath, this.#cliPrefixArgs);
    const lockPath = path.join(project, ".gameforge", "laya-build.lock");
    const lockToken = randomUUID();
    const lock = await open(lockPath, "wx", 0o600).catch((error: unknown) => {
      if (isNodeError(error) && error.code === "EEXIST") throw new Error("A LayaAir build is already active for this project.");
      throw error;
    });
    try {
      await lock.writeFile(`${lockToken}\n`, "utf8");
      await lock.sync();
      if (!cli.versionVerified) {
        const version = await this.#run(cli, ["--version"], project, 10_000);
        if (version.stdout.trim() !== `LayaAir CLI ${EXPECTED_LAYAAIR_VERSION}`) {
          throw new Error(`LayaAir CLI version mismatch; expected ${EXPECTED_LAYAAIR_VERSION}.`);
        }
      }
      const outputPath = path.join(project, "release", this.#cliTarget === "wxgame" ? "wxgame" : "bytedancegame");
      await verifyOptionalOutputDirectory(project, outputPath);
      const result = await this.#run(cli, [
        "build", this.#cliTarget, "--project", project, "--out", outputPath,
      ], project, this.#timeoutMs);
      if (result.reportedBuildFailure) {
        throw new Error("LayaAir CLI reported a failed build despite returning exit code zero.");
      }
      const beforeHandoff = await createMiniGameLocalHandoffManifest({
        projectRoot: outputPath,
        projectId,
        target: this.#target,
      });
      const validation = this.#target === "douyin-mini-game"
        ? await validateDouyinMiniGameProject(outputPath, { expectedProjectId: projectId })
        : await validateWechatMiniGameProject(outputPath, { expectedProjectId: projectId });
      const handoff = await createMiniGameLocalHandoffManifest({
        projectRoot: outputPath,
        projectId,
        target: this.#target,
      });
      assertMiniGameHandoffSnapshot(beforeHandoff, handoff);
      return {
        projectId,
        cliVersion: EXPECTED_LAYAAIR_VERSION,
        outputPath,
        validation,
        handoff,
        stdoutTruncated: result.stdoutTruncated,
        stderrTruncated: result.stderrTruncated,
      } as DouyinMiniGameBuildResult | WechatMiniGameBuildResult;
    } finally {
      await lock.close().catch(() => undefined);
      const token = await readFile(lockPath, "utf8").catch(() => undefined);
      if (token === `${lockToken}\n`) await unlink(lockPath).catch(() => undefined);
    }
  }

  async #run(cli: ResolvedLayaCli, args: string[], cwd: string, timeoutMs: number): Promise<ProcessResult> {
    const child = spawn(cli.command, [...cli.prefixArgs, ...args], {
      cwd,
      shell: false,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
      env: safeChildEnvironment(),
      detached: false,
    });
    child.stdin.end();
    return await collectProcess(child, timeoutMs);
  }
}

export class DouyinMiniGameBuilder {
  readonly #delegate: LayaMiniGameBuilder;
  constructor(options: BuilderOptions) { this.#delegate = new LayaMiniGameBuilder(options, "douyin-mini-game"); }
  async build(projectId: string): Promise<DouyinMiniGameBuildResult> {
    return await this.#delegate.build(projectId) as DouyinMiniGameBuildResult;
  }
}

export class WechatMiniGameBuilder {
  readonly #delegate: LayaMiniGameBuilder;
  constructor(options: BuilderOptions) { this.#delegate = new LayaMiniGameBuilder(options, "wechat-mini-game"); }
  async build(projectId: string): Promise<WechatMiniGameBuildResult> {
    return await this.#delegate.build(projectId) as WechatMiniGameBuildResult;
  }
}

type ProcessResult = { stdout: string; stdoutTruncated: boolean; stderrTruncated: boolean; reportedBuildFailure: boolean };

async function collectProcess(child: ChildProcessWithoutNullStreams, timeoutMs: number): Promise<ProcessResult> {
  let stdout = Buffer.alloc(0);
  let stderr = Buffer.alloc(0);
  let stdoutTruncated = false;
  let stderrTruncated = false;
  let reportedBuildFailure = false;
  let stdoutFailureTail = "";
  let stderrFailureTail = "";
  const scanBuildFailure = (chunk: Buffer, previousTail: string): string => {
    const combined = previousTail + chunk.toString("utf8");
    if (/\bBuild end,\s*result=Failed\b/i.test(combined)) reportedBuildFailure = true;
    return combined.slice(-128);
  };
  child.stdout.on("data", (chunk: Buffer) => {
    stdoutFailureTail = scanBuildFailure(chunk, stdoutFailureTail);
    const remaining = MAX_LOG_BYTES - stdout.length;
    if (remaining > 0) stdout = Buffer.concat([stdout, chunk.subarray(0, remaining)]);
    if (chunk.length > remaining) stdoutTruncated = true;
  });
  child.stderr.on("data", (chunk: Buffer) => {
    stderrFailureTail = scanBuildFailure(chunk, stderrFailureTail);
    const remaining = MAX_LOG_BYTES - stderr.length;
    if (remaining > 0) stderr = Buffer.concat([stderr, chunk.subarray(0, remaining)]);
    if (chunk.length > remaining) stderrTruncated = true;
  });
  const completion = new Promise<{ code: number | null; error?: Error }>((resolve) => {
    child.once("error", (error) => resolve({ code: null, error }));
    child.once("close", (code) => resolve({ code }));
  });
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), timeoutMs);
  });
  const first = await Promise.race([completion, timeout]);
  if (timer !== undefined) clearTimeout(timer);
  if (first === "timeout") {
    child.kill("SIGKILL");
    await Promise.race([completion, delay(2_000)]);
    throw new Error("LayaAir build timed out.");
  }
  const outcome = first;
  if (outcome.error !== undefined) throw new Error("LayaAir CLI could not be started.");
  if (outcome.code !== 0) throw new Error(`LayaAir CLI failed with exit code ${outcome.code ?? "unknown"}.`);
  return { stdout: stdout.toString("utf8"), stdoutTruncated, stderrTruncated, reportedBuildFailure };
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function pathKey(value: string): string {
  const normalized = path.normalize(value);
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function safeChildEnvironment(): NodeJS.ProcessEnv {
  const names = ["TEMP", "TMP"];
  return {
    NO_COLOR: "1",
    PATH: path.dirname(process.execPath),
    ...(process.platform === "win32" ? { PATHEXT: ".COM;.EXE;.BAT;.CMD" } : {}),
    ...Object.fromEntries(names.flatMap((name) => process.env[name] === undefined ? [] : [[name, process.env[name]]])),
  } as NodeJS.ProcessEnv;
}

async function resolveLayaCli(cliPath: string, prefixArgs: string[]): Promise<ResolvedLayaCli> {
  const info = await lstat(cliPath).catch(() => undefined);
  if (info === undefined || !info.isFile() || info.isSymbolicLink()) throw new Error("LayaAir CLI path must be a regular file.");
  const actual = await realpath(cliPath);
  const basename = path.basename(actual).toLowerCase();
  if (basename === "dispatcher.js" || basename === "layaair.cmd" || basename === "layaair") {
    if (prefixArgs.length > 0) throw new Error("Official LayaAir CLI entries do not accept prefix arguments.");
    const directory = path.dirname(actual);
    const versionsPath = path.join(directory, "versions.json");
    const versionsInfo = await lstat(versionsPath).catch(() => undefined);
    if (versionsInfo !== undefined) return await resolveDispatcherInstall(directory);
    if (path.basename(directory) === EXPECTED_LAYAAIR_VERSION) return await resolveVersionInstall(directory);
    throw new Error("LayaAir CLI entry is not part of the pinned official installation layout.");
  }
  if (basename === "cli-main.js" && path.basename(path.dirname(actual)) === "Resources") {
    if (prefixArgs.length > 0) throw new Error("Official LayaAir CLI entries do not accept prefix arguments.");
    return await resolveVersionInstall(path.dirname(path.dirname(actual)));
  }
  return { command: actual, prefixArgs: [...prefixArgs], versionVerified: false };
}

async function resolveDispatcherInstall(installRoot: string): Promise<ResolvedLayaCli> {
  const versions = await readBoundedJson(path.join(installRoot, "versions.json"));
  if (versions === null || typeof versions !== "object" || Array.isArray(versions)) {
    throw new Error("LayaAir dispatcher versions manifest is invalid.");
  }
  const entries = (versions as Record<string, unknown>).versions;
  if (!Array.isArray(entries)) throw new Error("LayaAir dispatcher versions manifest is invalid.");
  const selected = entries.find((entry) => entry !== null && typeof entry === "object" && !Array.isArray(entry) &&
    (entry as Record<string, unknown>).version === EXPECTED_LAYAAIR_VERSION);
  if (selected === undefined) throw new Error(`LayaAir CLI version mismatch; expected ${EXPECTED_LAYAAIR_VERSION}.`);
  const relative = (selected as Record<string, unknown>).path;
  if (relative !== EXPECTED_LAYAAIR_VERSION) throw new Error("LayaAir dispatcher version path is unsafe.");
  return await resolveVersionInstall(path.join(installRoot, relative));
}

async function resolveVersionInstall(versionRootInput: string): Promise<ResolvedLayaCli> {
  const versionInfo = await lstat(versionRootInput).catch(() => undefined);
  if (versionInfo === undefined || !versionInfo.isDirectory() || versionInfo.isSymbolicLink()) {
    throw new Error("LayaAir version directory is missing or unsafe.");
  }
  const versionRoot = await realpath(versionRootInput);
  if (pathKey(versionRoot) !== pathKey(path.resolve(versionRootInput))) {
    throw new Error("LayaAir version directory must not redirect to another location.");
  }
  const resources = path.join(versionRoot, "Resources");
  const manifest = await readBoundedJson(path.join(resources, "package.json"));
  if (manifest === null || typeof manifest !== "object" || Array.isArray(manifest) ||
      (manifest as Record<string, unknown>).name !== "layaair-cli" ||
      (manifest as Record<string, unknown>).version !== EXPECTED_LAYAAIR_VERSION) {
    throw new Error("LayaAir CLI package identity or version is unsupported.");
  }
  const cliMain = path.join(resources, "cli-main.js");
  const cliInfo = await lstat(cliMain).catch(() => undefined);
  if (cliInfo === undefined || !cliInfo.isFile() || cliInfo.isSymbolicLink()) {
    throw new Error("LayaAir CLI main entry is missing or unsafe.");
  }
  const actualCliMain = await realpath(cliMain);
  if (pathKey(actualCliMain) !== pathKey(cliMain)) {
    throw new Error("LayaAir CLI main entry must not redirect to another file.");
  }
  return { command: process.execPath, prefixArgs: [actualCliMain], versionVerified: true };
}

async function readBoundedJson(filePath: string): Promise<unknown> {
  const info = await lstat(filePath).catch(() => undefined);
  if (info === undefined || !info.isFile() || info.isSymbolicLink() || info.size > 64 * 1024) {
    throw new Error("LayaAir CLI metadata file is missing or unsafe.");
  }
  const actual = await realpath(filePath);
  if (pathKey(actual) !== pathKey(filePath)) throw new Error("LayaAir CLI metadata file must not redirect.");
  try {
    return JSON.parse(await readFile(actual, "utf8")) as unknown;
  } catch {
    throw new Error("LayaAir CLI metadata file is invalid.");
  }
}

async function verifiedManagedProject(projectsRootInput: string, projectId: string) {
  await mkdir(projectsRootInput, { recursive: true });
  const rootInfo = await lstat(projectsRootInput);
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) throw new Error("Projects root must be a real directory.");
  const root = await realpath(projectsRootInput);
  const projectPath = path.resolve(root, projectId);
  if (path.dirname(projectPath).toLowerCase() !== root.toLowerCase()) throw new Error("Project escaped the configured root.");
  const projectInfo = await lstat(projectPath).catch(() => undefined);
  if (projectInfo === undefined || !projectInfo.isDirectory() || projectInfo.isSymbolicLink()) throw new Error("Managed project does not exist.");
  const project = await realpath(projectPath);
  if (path.dirname(project).toLowerCase() !== root.toLowerCase()) throw new Error("Project escaped the configured root.");
  const metadataPath = path.join(project, ".gameforge");
  const metadataInfo = await lstat(metadataPath).catch(() => undefined);
  if (metadataInfo === undefined || !metadataInfo.isDirectory() || metadataInfo.isSymbolicLink()) {
    throw new Error("Managed project metadata directory is missing or unsafe.");
  }
  const metadata = await realpath(metadataPath);
  if (path.dirname(metadata).toLowerCase() !== project.toLowerCase()) throw new Error("Managed project metadata escaped the project.");
  const manifestPath = path.join(metadata, "manifest.json");
  const manifestInfo = await lstat(manifestPath).catch(() => undefined);
  if (manifestInfo === undefined || !manifestInfo.isFile() || manifestInfo.isSymbolicLink() || manifestInfo.size > 256 * 1024) {
    throw new Error("Managed project manifest is missing or unsafe.");
  }
  const manifest = managedGeneratedProjectManifestSchema.parse(JSON.parse(await readFile(manifestPath, "utf8")) as unknown);
  if (manifest.projectId !== projectId) throw new Error("Managed project manifest ID mismatch.");
  return { project, manifest };
}

async function verifyOptionalOutputDirectory(project: string, outputPath: string): Promise<void> {
  const release = path.dirname(outputPath);
  for (const candidate of [release, outputPath]) {
    const info = await lstat(candidate).catch(() => undefined);
    if (info !== undefined && (!info.isDirectory() || info.isSymbolicLink())) throw new Error("LayaAir output path must be a real directory.");
    if (info !== undefined) {
      const actual = await realpath(candidate);
      if (actual !== project && !actual.startsWith(`${project}${path.sep}`)) throw new Error("LayaAir output escaped the managed project.");
    }
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
