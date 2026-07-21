import { spawn } from "node:child_process";
import { access, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import {
  OPENCHAMBER_PINNED_COMMIT,
  OPENCHAMBER_PINNED_VERSION,
  OPENCHAMBER_UPSTREAM_URL,
} from "./config.js";

export async function assertOpenChamberCheckout(checkoutRoot: string, requireBuild: boolean): Promise<void> {
  const packageJsonPath = path.join(checkoutRoot, "package.json");
  const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8")) as { name?: unknown; version?: unknown };
  if (packageJson.name !== "openchamber-monorepo" || packageJson.version !== OPENCHAMBER_PINNED_VERSION) {
    throw new Error(`OpenChamber checkout must be official version ${OPENCHAMBER_PINNED_VERSION}.`);
  }
  const [head, remote, status] = await Promise.all([
    capture("git", ["-C", checkoutRoot, "rev-parse", "HEAD"]),
    capture("git", ["-C", checkoutRoot, "remote", "get-url", "origin"]),
    capture("git", ["-C", checkoutRoot, "status", "--porcelain"]),
  ]);
  if (head.trim() !== OPENCHAMBER_PINNED_COMMIT) throw new Error(`OpenChamber checkout is not pinned to ${OPENCHAMBER_PINNED_COMMIT}.`);
  if (normalizeRemote(remote.trim()) !== normalizeRemote(OPENCHAMBER_UPSTREAM_URL)) throw new Error("OpenChamber checkout origin is not the official repository.");
  if (status.trim()) throw new Error("OpenChamber checkout has local modifications; preserve upstream before launching.");
  if (requireBuild) await access(path.join(checkoutRoot, "packages", "web", "dist", "index.html"))
    .catch(() => { throw new Error("OpenChamber Web build is missing. Run `bun run openchamber:bootstrap`."); });
}

export async function bootstrapOpenChamberCheckout(checkoutRoot: string): Promise<void> {
  const exists = await access(checkoutRoot).then(() => true, (error: unknown) => {
    if (isNodeError(error) && error.code === "ENOENT") return false;
    throw error;
  });
  if (exists) {
    await assertOpenChamberCheckout(checkoutRoot, false);
  } else {
    await mkdir(path.dirname(checkoutRoot), { recursive: true });
    await run("git", ["clone", "--filter=blob:none", "--no-checkout", OPENCHAMBER_UPSTREAM_URL, checkoutRoot]);
    await run("git", ["-C", checkoutRoot, "fetch", "--depth", "1", "origin", OPENCHAMBER_PINNED_COMMIT]);
    await run("git", ["-C", checkoutRoot, "checkout", "--detach", OPENCHAMBER_PINNED_COMMIT]);
  }
  await run("bun", ["install", "--frozen-lockfile"], checkoutRoot);
  await run("bun", ["run", "build:web"], checkoutRoot);
  await assertOpenChamberCheckout(checkoutRoot, true);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function normalizeRemote(value: string): string {
  return value.replace(/\/$/, "").replace(/\.git$/, "").toLowerCase();
}

function capture(command: string, args: readonly string[]): Promise<string> {
  return execute(command, args, undefined, true);
}

function run(command: string, args: readonly string[], cwd?: string): Promise<void> {
  return execute(command, args, cwd, false).then(() => undefined);
}

function execute(command: string, args: readonly string[], cwd: string | undefined, captureOutput: boolean): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, [...args], {
      ...(cwd === undefined ? {} : { cwd }),
      shell: false,
      windowsHide: true,
      stdio: captureOutput ? ["ignore", "pipe", "pipe"] : "inherit",
    });
    let stdout = "";
    let stderr = "";
    if (captureOutput) {
      child.stdout?.on("data", (chunk: Buffer) => { stdout += chunk.toString("utf8"); });
      child.stderr?.on("data", (chunk: Buffer) => { stderr += chunk.toString("utf8"); });
    }
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolve(stdout) : reject(new Error(`${command} exited with code ${String(code)}${stderr ? `: ${stderr.trim()}` : ""}`)));
  });
}
