import { randomUUID } from "node:crypto";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { lstat, mkdir, open, readFile, realpath, unlink } from "node:fs/promises";
import path from "node:path";
import { managedGeneratedProjectManifestSchema, projectIdSchema } from "@gameforge/contracts";
import {
  validateDouyinMiniGameProject,
  validateWechatMiniGameProject,
  type DouyinMiniGameValidationReport,
  type WechatMiniGameValidationReport,
} from "./index.js";

const EXPECTED_LAYAAIR_VERSION = "3.4.0";
const MAX_LOG_BYTES = 64 * 1024;
const DEFAULT_TIMEOUT_MS = 120_000;

export type DouyinMiniGameBuildResult = {
  projectId: string;
  cliVersion: "3.4.0";
  outputPath: string;
  validation: DouyinMiniGameValidationReport;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
};

export type WechatMiniGameBuildResult = Omit<DouyinMiniGameBuildResult, "validation"> & {
  validation: WechatMiniGameValidationReport;
};

type BuilderOptions = { projectsRoot: string; cliPath: string; timeoutMs?: number; cliPrefixArgs?: string[] };

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
    await verifiedCli(this.#cliPath);
    const lockPath = path.join(project, ".gameforge", "laya-build.lock");
    const lockToken = randomUUID();
    const lock = await open(lockPath, "wx", 0o600).catch((error: unknown) => {
      if (isNodeError(error) && error.code === "EEXIST") throw new Error("A LayaAir build is already active for this project.");
      throw error;
    });
    try {
      await lock.writeFile(`${lockToken}\n`, "utf8");
      await lock.sync();
      const version = await this.#run(["--version"], project, 10_000);
      if (!version.stdout.includes(EXPECTED_LAYAAIR_VERSION)) {
        throw new Error(`LayaAir CLI version mismatch; expected ${EXPECTED_LAYAAIR_VERSION}.`);
      }
      const outputPath = path.join(project, "release", this.#cliTarget === "wxgame" ? "wxgame" : "bytedancegame");
      await verifyOptionalOutputDirectory(project, outputPath);
      const result = await this.#run([
        "build", this.#cliTarget, "--project", project, "--out", outputPath,
      ], project, this.#timeoutMs);
      if (result.reportedBuildFailure) {
        throw new Error("LayaAir CLI reported a failed build despite returning exit code zero.");
      }
      const validation = this.#target === "douyin-mini-game"
        ? await validateDouyinMiniGameProject(outputPath, { expectedProjectId: projectId })
        : await validateWechatMiniGameProject(outputPath, { expectedProjectId: projectId });
      return {
        projectId,
        cliVersion: EXPECTED_LAYAAIR_VERSION,
        outputPath,
        validation,
        stdoutTruncated: result.stdoutTruncated,
        stderrTruncated: result.stderrTruncated,
      } as DouyinMiniGameBuildResult | WechatMiniGameBuildResult;
    } finally {
      await lock.close().catch(() => undefined);
      const token = await readFile(lockPath, "utf8").catch(() => undefined);
      if (token === `${lockToken}\n`) await unlink(lockPath).catch(() => undefined);
    }
  }

  async #run(args: string[], cwd: string, timeoutMs: number): Promise<ProcessResult> {
    const invocation = layaInvocation(this.#cliPath, [...this.#cliPrefixArgs, ...args]);
    const child = spawn(invocation.command, invocation.args, {
      cwd,
      shell: false,
      windowsHide: true,
      windowsVerbatimArguments: invocation.windowsVerbatimArguments,
      stdio: ["pipe", "pipe", "pipe"],
      env: safeChildEnvironment(),
      detached: process.platform !== "win32",
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
    await terminateProcessTree(child);
    await Promise.race([completion, delay(2_000)]);
    throw new Error("LayaAir build timed out.");
  }
  const outcome = first;
  if (outcome.error !== undefined) throw new Error("LayaAir CLI could not be started.");
  if (outcome.code !== 0) throw new Error(`LayaAir CLI failed with exit code ${outcome.code ?? "unknown"}.`);
  return { stdout: stdout.toString("utf8"), stdoutTruncated, stderrTruncated, reportedBuildFailure };
}

async function terminateProcessTree(child: ChildProcessWithoutNullStreams): Promise<void> {
  if (child.pid === undefined) return;
  if (process.platform === "win32") {
    const taskkill = path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "taskkill.exe");
    const killer = spawn(taskkill, ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
    await new Promise<void>((resolve) => {
      killer.once("error", () => resolve());
      killer.once("close", () => resolve());
    });
  } else {
    try { process.kill(-child.pid, "SIGKILL"); } catch { child.kill("SIGKILL"); }
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function layaInvocation(cliPath: string, args: string[]): { command: string; args: string[]; windowsVerbatimArguments: boolean } {
  if (process.platform === "win32" && /\.(?:cmd|bat)$/i.test(cliPath)) {
    const command = path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "cmd.exe");
    const line = `call ${[cliPath, ...args].map(quoteCmdArgument).join(" ")}`;
    return { command, args: ["/d", "/s", "/c", line], windowsVerbatimArguments: true };
  }
  return { command: cliPath, args, windowsVerbatimArguments: false };
}

function quoteCmdArgument(value: string): string {
  if (/[\r\n"%!^&|<>()]/.test(value)) throw new Error("LayaAir CLI path contains unsupported command characters.");
  return `"${value}"`;
}

function safeChildEnvironment(): NodeJS.ProcessEnv {
  const names = ["SystemRoot", "PATH", "PATHEXT", "TEMP", "TMP"];
  return Object.fromEntries(names.flatMap((name) => process.env[name] === undefined ? [] : [[name, process.env[name]]])) as NodeJS.ProcessEnv;
}

async function verifiedCli(cliPath: string): Promise<void> {
  const info = await lstat(cliPath).catch(() => undefined);
  if (info === undefined || !info.isFile() || info.isSymbolicLink()) throw new Error("LayaAir CLI path must be a regular file.");
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
