import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { lstat, readFile, realpath } from "node:fs/promises";
import path from "node:path";

const EXPECTED_VERSION = "2.1.1";
const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_OUTPUT_BYTES = 8 * 1024;

export const douyinMiniGameCliPolicy = {
  packageName: "tt-minigame-ide-cli",
  binary: "tmg",
  expectedVersion: EXPECTED_VERSION,
  acceptedArguments: ["--version"],
  commandsNotExposed: ["login", "login-e", "logout", "open", "set-config", "version", "build-npm", "preview", "upload"],
  remoteOperations: "forbidden",
  acceptsMiniAppCli: false,
  offlineBuildSupported: false,
  offlineValidationSupported: false,
} as const;

export type DouyinMiniGameCliProbeReport = {
  platform: "douyin-mini-game";
  ready: true;
  packageName: "tt-minigame-ide-cli";
  binary: "tmg";
  version: "2.1.1";
  executedArguments: readonly ["--version"];
  remoteOperations: "forbidden";
  exposedArguments: readonly ["--version"];
};

export type DouyinMiniGameCliProbeOptions = {
  cliPath: string;
  timeoutMs?: number;
};

export class DouyinMiniGameCliProbe {
  readonly #cliPath: string;
  readonly #timeoutMs: number;

  constructor(options: DouyinMiniGameCliProbeOptions) {
    if (!path.isAbsolute(options.cliPath)) {
      throw new Error("Douyin mini-game CLI path must be absolute.");
    }
    if (path.basename(options.cliPath) !== "tmg.js" || path.basename(path.dirname(options.cliPath)) !== "bin") {
      throw new Error("Douyin mini-game CLI path must point to the official bin/tmg.js entry.");
    }
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 500 || timeoutMs > 30_000) {
      throw new Error("Douyin mini-game CLI timeout must be between 500 and 30000 milliseconds.");
    }
    this.#cliPath = path.resolve(options.cliPath);
    this.#timeoutMs = timeoutMs;
  }

  async probe(): Promise<DouyinMiniGameCliProbeReport> {
    const verifiedEntry = await verifiedPackageEntry(this.#cliPath);
    const child = spawn(process.execPath, [verifiedEntry, "--version"], {
      cwd: path.dirname(path.dirname(verifiedEntry)),
      shell: false,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
      env: safeChildEnvironment(),
      detached: false,
    });
    child.stdin.end();
    const output = await collectVersionOutput(child, this.#timeoutMs);
    if (output.stdout.trim() !== EXPECTED_VERSION) {
      throw new Error(`Douyin mini-game CLI version mismatch; expected ${EXPECTED_VERSION}.`);
    }
    return {
      platform: "douyin-mini-game",
      ready: true,
      packageName: douyinMiniGameCliPolicy.packageName,
      binary: douyinMiniGameCliPolicy.binary,
      version: EXPECTED_VERSION,
      executedArguments: ["--version"],
      remoteOperations: "forbidden",
      exposedArguments: ["--version"],
    };
  }
}

function safeChildEnvironment(): NodeJS.ProcessEnv {
  const names = ["TEMP", "TMP"];
  return {
    NO_COLOR: "1",
    ...Object.fromEntries(
      names.flatMap((name) => process.env[name] === undefined ? [] : [[name, process.env[name]]]),
    ),
  } as NodeJS.ProcessEnv;
}

async function collectVersionOutput(
  child: ChildProcessWithoutNullStreams,
  timeoutMs: number,
): Promise<{ stdout: string; stderr: string }> {
  let stdout: Buffer<ArrayBufferLike> = Buffer.alloc(0);
  let stderr: Buffer<ArrayBufferLike> = Buffer.alloc(0);
  let truncated = false;
  let totalBytes = 0;
  const append = (current: Buffer<ArrayBufferLike>, chunk: Buffer<ArrayBufferLike>): Buffer<ArrayBufferLike> => {
    const remaining = MAX_OUTPUT_BYTES - totalBytes;
    totalBytes += chunk.length;
    if (chunk.length > remaining) truncated = true;
    return remaining <= 0 ? current : Buffer.concat([current, chunk.subarray(0, remaining)]);
  };
  child.stdout.on("data", (chunk: Buffer) => { stdout = append(stdout, chunk); });
  child.stderr.on("data", (chunk: Buffer) => { stderr = append(stderr, chunk); });
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
    throw new Error("Douyin mini-game CLI version probe timed out.");
  }
  if (first.error !== undefined) throw new Error("Douyin mini-game CLI could not be started.");
  if (first.code !== 0) throw new Error(`Douyin mini-game CLI version probe failed with exit code ${first.code ?? "unknown"}.`);
  if (truncated) throw new Error("Douyin mini-game CLI version output exceeded its limit.");
  return { stdout: stdout.toString("utf8"), stderr: stderr.toString("utf8") };
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function verifiedPackageEntry(cliPath: string): Promise<string> {
  const info = await lstat(cliPath).catch(() => undefined);
  if (info === undefined || !info.isFile() || info.isSymbolicLink()) {
    throw new Error("Douyin mini-game CLI path must be a regular file.");
  }
  const entry = await realpath(cliPath);
  if (pathKey(entry) !== pathKey(cliPath)) {
    throw new Error("Douyin mini-game CLI entry must not redirect outside its configured path.");
  }
  const packageRoot = path.dirname(path.dirname(entry));
  const manifestPath = path.join(packageRoot, "package.json");
  const manifestInfo = await lstat(manifestPath).catch(() => undefined);
  if (manifestInfo === undefined || !manifestInfo.isFile() || manifestInfo.isSymbolicLink() || manifestInfo.size > 64 * 1024) {
    throw new Error("Douyin mini-game CLI package manifest is missing or unsafe.");
  }
  const actualManifestPath = await realpath(manifestPath);
  if (pathKey(actualManifestPath) !== pathKey(manifestPath)) {
    throw new Error("Douyin mini-game CLI package manifest must not redirect outside its package.");
  }
  let manifest: unknown;
  try {
    manifest = JSON.parse(await readFile(actualManifestPath, "utf8")) as unknown;
  } catch {
    throw new Error("Douyin mini-game CLI package manifest is invalid.");
  }
  if (!isExpectedPackageManifest(manifest)) {
    throw new Error("Douyin mini-game CLI package identity or version is unsupported.");
  }
  return entry;
}

function isExpectedPackageManifest(value: unknown): boolean {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  if (record.name !== "tt-minigame-ide-cli" || record.version !== EXPECTED_VERSION) return false;
  const bin = record.bin;
  return bin !== null && typeof bin === "object" && !Array.isArray(bin) &&
    (bin as Record<string, unknown>).tmg === "bin/tmg.js";
}

function pathKey(value: string): string {
  const normalized = path.normalize(value);
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}
