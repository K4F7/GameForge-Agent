import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { mkdir } from "node:fs/promises";
import { createServer } from "node:net";
import path from "node:path";
import { resolveRuntime, writeRuntimeConfig } from "../shared/runtime.js";
import { codeArtsSpawnCommand, resolveCodeArtsLaunchTarget } from "./executable.js";
import { withoutExternalProviderEnvironment } from "./server-config.js";

const runtime = await resolveRuntime(import.meta.dirname, "codearts");
await writeRuntimeConfig(runtime);
const runtimeDirectory = path.dirname(runtime.configPath);
const smokeDataDirectory = path.join(runtimeDirectory, "server-smoke-data");
const smokeConfigDirectory = path.join(runtimeDirectory, "server-smoke-config");
await Promise.all([
  mkdir(smokeDataDirectory, { recursive: true }),
  mkdir(smokeConfigDirectory, { recursive: true }),
]);
const home = userHome();
const launchTarget = await resolveCodeArtsLaunchTarget({
  home,
  ...(process.env.CODEARTS_BIN === undefined ? {} : { configured: process.env.CODEARTS_BIN }),
  ...(process.env.ComSpec === undefined ? {} : { comspec: process.env.ComSpec }),
});
const port = await availablePort();
const baseUrl = `http://127.0.0.1:${port}/`;
const spawnCommand = codeArtsSpawnCommand(launchTarget, [
  "serve", "--pure", "--print-logs", "--log-level", "DEBUG",
  "--hostname", "127.0.0.1", "--port", String(port),
]);
const childEnvironment = withoutExternalProviderEnvironment(process.env);
delete childEnvironment.CODEARTS_SERVER_PASSWORD;
const child = spawn(spawnCommand.command, spawnCommand.args, {
  cwd: runtime.repoRoot,
  stdio: ["ignore", "pipe", "pipe"],
  windowsVerbatimArguments: spawnCommand.windowsVerbatimArguments,
  env: {
    ...childEnvironment,
    KERNEL_DATA_DIR: smokeDataDirectory,
    KERNEL_CONFIG_DIR: smokeConfigDirectory,
    OPENCODE_CONFIG: runtime.configPath,
    SCENARIO: "codeartsdoer",
  },
});
let stdout = "";
let stderr = "";
child.stdout?.on("data", (chunk: Buffer) => { stdout = bounded(stdout + chunk.toString("utf8")); });
child.stderr?.on("data", (chunk: Buffer) => { stderr = bounded(stderr + chunk.toString("utf8")); });

try {
  await waitUntilReady(child, new URL("global/health", baseUrl));
  const health = await readJson(new URL("global/health", baseUrl), 5_000);
  const documentation = await fetch(new URL("doc", baseUrl), { signal: AbortSignal.timeout(5_000) });
  const mcpUrl = new URL("mcp", baseUrl);
  mcpUrl.searchParams.set("directory", runtime.repoRoot);
  const mcp = await readJson(mcpUrl, 20_000);
  const mcpRecord = isRecord(mcp) ? mcp : {};
  const gameforgeMcp = isRecord(mcpRecord.gameforge) ? mcpRecord.gameforge : null;
  const ok = documentation.ok && isRecord(health) && health.healthy === true &&
    gameforgeMcp?.status === "connected";
  process.stdout.write(`${JSON.stringify({
    ok,
    codeartsVersion: isRecord(health) && typeof health.version === "string" ? health.version : null,
    documentation: {
      status: documentation.status,
      contentType: documentation.headers.get("content-type"),
    },
    mcp: { gameforge: gameforgeMcp },
  }, null, 2)}\n`);
  if (!ok) {
    if (stdout) process.stderr.write(`CodeArts stdout:\n${stdout}\n`);
    if (stderr) process.stderr.write(`CodeArts stderr:\n${stderr}\n`);
    process.exitCode = 1;
  }
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  if (stdout) process.stderr.write(`CodeArts stdout:\n${stdout}\n`);
  if (stderr) process.stderr.write(`CodeArts stderr:\n${stderr}\n`);
  process.exitCode = 1;
} finally {
  child.kill();
  await waitForExit(child);
}

async function waitUntilReady(childProcess: ChildProcess, healthUrl: URL): Promise<void> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (childProcess.exitCode !== null) throw new Error(`CodeArts server exited with code ${childProcess.exitCode}.`);
    try {
      const response = await fetch(healthUrl, { signal: AbortSignal.timeout(500) });
      if (response.ok) return;
    } catch {
      // The server may still be binding its loopback listener.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error("CodeArts server did not become ready within 15 seconds.");
}

async function waitForExit(childProcess: ChildProcess): Promise<void> {
  if (childProcess.exitCode !== null) return;
  await Promise.race([
    once(childProcess, "exit"),
    new Promise((resolve) => setTimeout(resolve, 5_000)),
  ]);
}

async function readJson(url: URL, timeoutMilliseconds: number): Promise<unknown> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMilliseconds) });
    if (!response.ok) throw new Error(`${url.pathname} returned HTTP ${response.status}.`);
    return response.json() as Promise<unknown>;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith(`${url.pathname} returned HTTP`)) throw error;
    throw new Error(`${url.pathname} failed within ${timeoutMilliseconds} ms: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function availablePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("Could not allocate a loopback port.");
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return address.port;
}

function bounded(input: string): string {
  return input.length <= 4_000 ? input : input.slice(-4_000);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function userHome(): string {
  const value = process.env.USERPROFILE?.trim() || process.env.HOME?.trim();
  if (!value) throw new Error("USERPROFILE or HOME is required to locate CodeArts.");
  return value;
}
