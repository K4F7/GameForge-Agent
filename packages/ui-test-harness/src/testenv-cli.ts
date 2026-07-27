#!/usr/bin/env bun

import { execFile } from "node:child_process";
import { access, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { loopbackHttpPort, safeCodeArtsServerUrl, safeOpenChamberUrl, safeRelayUrl } from "./cli-safety.js";
import { openChamberExternalEnvironment, registerOpenChamberDirectory } from "./openchamber-external.js";
import { evaluatePreflight, type PreflightProbe, type PreflightReport } from "./preflight.js";
import { probeBrowser, probeCodeArts, probeFile, probeHttp } from "./preflight-probes.js";
import { DEFAULT_OPENCHAMBER_URL, DEFAULT_RELAY_URL } from "./testenv-config.js";
import { TestEnvSupervisor, stopPortListeners, type ManagedServiceSpec } from "./testenv-supervisor.js";
import { rollbackStartupFailure } from "./startup-rollback.js";

/**
 * Resident test environment control surface (ADR-0005).
 * - `status`: preflight only - starts nothing, finishes in under a second.
 * - `up`: owns the credential-free loopback services (Authority Relay and the
 *   OpenChamber production service) in the foreground until Ctrl+C.
 * - `down`: stops the two services from any terminal, but only when both the
 *   public endpoint contract and the owning node/bun process match.
 * CodeArts is never managed here - only probed.
 */
const repoRoot = path.resolve(import.meta.dirname, "../../..");
const shutdownMarker = path.join(repoRoot, ".gameforge-validation", "testenv-shutdown-requested");

const execFileAsync = promisify(execFile);

const relayUrl = safeRelayUrl(process.env.GAMEFORGE_RUN_RELAY_URL?.trim() || DEFAULT_RELAY_URL);
loopbackHttpPort(relayUrl, "Relay URL");
const openChamberUrl = safeOpenChamberUrl(process.env.GAMEFORGE_OPENCHAMBER_URL?.trim() || DEFAULT_OPENCHAMBER_URL);
loopbackHttpPort(openChamberUrl, "OpenChamber URL");

const command = process.argv[2] ?? "status";
if (command === "status") {
  const report = evaluatePreflight(await probeAll());
  process.stdout.write(formatReport(report));
  process.exitCode = report.ready ? 0 : 1;
} else if (command === "up") {
  await runUp();
} else if (command === "down") {
  if (process.argv.length > 3) throw new Error("testenv down does not accept arguments.");
  await runDown();
} else {
  process.stderr.write(`Unknown testenv command: ${command}\nUsage: testenv status|up|down\n`);
  process.exit(2);
}

async function runUp(): Promise<void> {
  const commandLineAttach = upCodeArtsAttach(process.argv.slice(3));
  const codeArtsServerInput = commandLineAttach.serverUrl ?? process.env.GAMEFORGE_CODEARTS_SERVER_URL?.trim();
  const codeArtsSession = commandLineAttach.sessionId ?? process.env.GAMEFORGE_CODEARTS_SESSION?.trim();
  if (!codeArtsServerInput || !codeArtsSession) {
    throw new Error("testenv up requires the external CodeArts server and session together via --codearts-server-url/--codearts-session or GAMEFORGE_CODEARTS_SERVER_URL/GAMEFORGE_CODEARTS_SESSION.");
  }
  const codeArtsServerUrl = safeCodeArtsServerUrl(codeArtsServerInput);
  const attachedSession = await probeHttp(
    "codearts-session",
    new URL(`/session/${encodeURIComponent(codeArtsSession)}`, codeArtsServerUrl).href,
    { expectedCodeArtsSessionId: codeArtsSession },
  );
  if (!attachedSession.available) throw new Error(`testenv up cannot use the requested CodeArts session: ${attachedSession.detail}`);
  const relayPort = loopbackHttpPort(relayUrl, "Relay URL");
  const openChamberPort = loopbackHttpPort(openChamberUrl, "OpenChamber URL");
  const openChamberEntry = path.join(repoRoot, "vendor", "openchamber", "packages", "web", "bin", "cli.js");
  const relayEntry = path.join(repoRoot, "packages", "run-relay", "dist", "index.js");
  await access(relayEntry).catch(() => {
    process.stderr.write(`Run Relay 尚未构建：${relayEntry} 不存在。\nfix: bun run build:foundation\n`);
    process.exit(1);
  });
  // The production build is a deliberate one-time cost (~72s) that must not
  // hide inside a command the operator expects to be fast.
  await access(path.join(repoRoot, "vendor", "openchamber", "packages", "web", "dist", "index.html")).catch(() => {
    process.stderr.write(`OpenChamber 生产构建缺失。\nfix: git submodule update --init --recursive && bun --cwd vendor/openchamber install --frozen-lockfile && bun --cwd vendor/openchamber run build:web\n`);
    process.exit(1);
  });
  const services: ManagedServiceSpec[] = [
    {
      name: "authority-relay",
      command: process.execPath,
      args: [relayEntry],
      port: relayPort,
      env: { GAMEFORGE_RUN_RELAY_PORT: String(relayPort) },
    },
    {
      name: "openchamber-service",
      command: process.execPath,
      args: [openChamberEntry, "serve", "--foreground", "--port", String(openChamberPort), "--plain"],
      cwd: path.join(repoRoot, "vendor", "openchamber", "packages", "web"),
      port: openChamberPort,
      env: openChamberExternalEnvironment(codeArtsServerUrl),
    },
  ];
  await rm(shutdownMarker, { force: true });
  const supervisor = new TestEnvSupervisor(services, { externalShutdownRequested: () => access(shutdownMarker).then(() => true, () => false) });
  const shutdown = (): void => {
    process.stdout.write("\n正在停止常驻测试环境……\n");
    supervisor.down().then(() => process.exit(0), (error) => { process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); process.exit(1); });
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  try {
    await supervisor.up();
    await registerOpenChamberDirectory(openChamberUrl, repoRoot);
  } catch (error) {
    await rollbackStartupFailure(error, () => supervisor.down());
  }
  process.stdout.write([
    "常驻测试环境已就绪：",
    `  authority-relay      ${relayUrl}`,
    `  openchamber-service  ${openChamberUrl}`,
    "保持此终端运行；Ctrl+C 停止。另一个终端可运行 bun run testenv:down 停止。",
    "",
  ].join("\n"));
  // Foreground residency ends on a signal, an unexpected child exit, or an
  // external `testenv down` removing either managed listener.
  await supervisor.waitUntilStopped();
}

function upCodeArtsAttach(args: readonly string[]): { serverUrl?: string; sessionId?: string } {
  const result: { serverUrl?: string; sessionId?: string } = {};
  for (let index = 0; index < args.length; index += 2) {
    const option = args[index]!;
    const key = option === "--codearts-server-url" ? "serverUrl"
      : option === "--codearts-session" ? "sessionId"
        : undefined;
    if (key === undefined) throw new Error(`Unknown testenv option: ${option}`);
    if (result[key] !== undefined) throw new Error(`${option} may only be provided once.`);
    const value = args[index + 1];
    if (value === undefined || value.startsWith("--")) throw new Error(`${option} requires a value.`);
    result[key] = value;
  }
  return result;
}

/**
 * Stateless down: verifies the service's public endpoint contract before
 * touching a listener, then verifies the process image and final port release.
 * This fails closed for unrelated Node/Bun development servers.
 */
async function runDown(): Promise<void> {
  await mkdir(path.dirname(shutdownMarker), { recursive: true });
  await writeFile(shutdownMarker, `${new Date().toISOString()}\n`, "utf8");
  const relayPort = loopbackHttpPort(relayUrl, "Relay URL");
  const openChamberPort = loopbackHttpPort(openChamberUrl, "OpenChamber URL");
  let failures = 0;
  const services: Array<{ name: "authority-relay" | "openchamber-service"; port: number; probeUrl: string }> = [
    { name: "authority-relay", port: relayPort, probeUrl: new URL("tasks?limit=1", relayUrl).href },
    { name: "openchamber-service", port: openChamberPort, probeUrl: openChamberUrl },
  ];
  for (const { name, port, probeUrl } of services) {
    try {
      const outcome = await stopPortListeners(port, {
        allowImages: /^(node|bun)(\.exe)?$/i,
        verifyOwnership: async () => (await probeHttp(name, probeUrl)).available,
      });
      if (outcome.stopped.length === 0 && outcome.refused.length === 0) {
        process.stdout.write(`${name}：端口 ${port} 无监听进程。\n`);
      }
      for (const entry of outcome.stopped) process.stdout.write(`${name}：已停止 ${entry.image} (PID ${entry.pid})，端口已释放。\n`);
      for (const entry of outcome.refused) {
        process.stderr.write(`${name}：端口 ${port} 由 ${entry.image ?? "未知进程"} (PID ${entry.pid}) 占用，但服务契约或进程归属不匹配，拒绝停止。\n`);
        failures += 1;
      }
    } catch (error) {
      process.stderr.write(`${name}：${error instanceof Error ? error.message : String(error)}\n`);
      failures += 1;
    }
  }
  if (failures > 0) await rm(shutdownMarker, { force: true });
  process.exitCode = failures === 0 ? 0 : 1;
}


async function probeAll(): Promise<PreflightProbe[]> {
  const probes: Array<Promise<PreflightProbe>> = [
    probeHttp("authority-relay", new URL("tasks?limit=1", relayUrl).href),
    probeHttp("openchamber-service", openChamberUrl),
    probeFile("openchamber-build", path.join(repoRoot, "vendor", "openchamber", "packages", "web", "dist", "index.html")),
    probeCodeArts(),
    probeBrowser({ ...(process.env.GAMEFORGE_BROWSER_CHANNEL?.trim() ? { channel: process.env.GAMEFORGE_BROWSER_CHANNEL.trim() } : {}) }),
  ];
  const configuredServer = process.env.GAMEFORGE_CODEARTS_SERVER_URL?.trim();
  const configuredSession = process.env.GAMEFORGE_CODEARTS_SESSION?.trim();
  if (configuredServer !== undefined || configuredSession !== undefined) {
    if (!configuredServer || !configuredSession) {
      probes.push(Promise.resolve({ dependency: "codearts-session", available: false, detail: "GAMEFORGE_CODEARTS_SERVER_URL and GAMEFORGE_CODEARTS_SESSION must be provided together" }));
    } else {
      try {
        const serverUrl = safeCodeArtsServerUrl(configuredServer);
        probes.push(probeHttp(
          "codearts-session",
          new URL(`/session/${encodeURIComponent(configuredSession)}`, serverUrl).href,
          { expectedCodeArtsSessionId: configuredSession },
        ));
      } catch (error) {
        probes.push(Promise.resolve({ dependency: "codearts-session", available: false, detail: error instanceof Error ? error.message : String(error) }));
      }
    }
  }
  return await Promise.all(probes);
}

function formatReport(value: PreflightReport): string {
  const lines = value.entries.map((entry) => {
    const mark = entry.available ? "OK  " : "DOWN";
    const remediation = entry.remediation === undefined ? "" : `\n       fix: ${entry.remediation}`;
    return `  ${mark} ${entry.dependency}${entry.detail === undefined ? "" : `\n       ${entry.detail}`}${remediation}`;
  });
  const summary = value.ready
    ? "Test environment is ready."
    : `Test environment is not ready: ${value.blocking.join(", ")}`;
  return `${lines.join("\n")}\n\n${summary}\n`;
}
