#!/usr/bin/env bun

import { execFile } from "node:child_process";
import { access } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { loopbackHttpPort } from "./cli-safety.js";
import { evaluatePreflight, type PreflightProbe, type PreflightReport } from "./preflight.js";
import { probeCodeArts, probeFile, probeHttp } from "./preflight-probes.js";
import { DEFAULT_OPENCHAMBER_URL, DEFAULT_RELAY_URL } from "./testenv-config.js";
import { TestEnvSupervisor, stopPortListeners, type ManagedServiceSpec } from "./testenv-supervisor.js";

/**
 * Resident test environment control surface (ADR-0005).
 * - `status`: preflight only - starts nothing, finishes in under a second.
 * - `up`: owns the credential-free loopback services (Authority Relay and the
 *   OpenChamber production service) in the foreground until Ctrl+C.
 * - `down`: stops whatever listens on the two loopback ports, from any
 *   terminal, but only when the owning process is a node/bun image.
 * CodeArts is never managed here - only probed.
 */
const repoRoot = path.resolve(import.meta.dirname, "../../..");

const execFileAsync = promisify(execFile);

const relayUrl = process.env.GAMEFORGE_RUN_RELAY_URL?.trim() || DEFAULT_RELAY_URL;
const openChamberUrl = process.env.GAMEFORGE_OPENCHAMBER_URL?.trim() || DEFAULT_OPENCHAMBER_URL;

const command = process.argv[2] ?? "status";
if (command === "status") {
  const report = evaluatePreflight(await probeAll());
  process.stdout.write(formatReport(report));
  process.exitCode = report.ready ? 0 : 1;
} else if (command === "up") {
  await runUp();
} else if (command === "down") {
  await runDown();
} else {
  process.stderr.write(`Unknown testenv command: ${command}\nUsage: testenv status|up|down\n`);
  process.exit(2);
}

async function runUp(): Promise<void> {
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
    },
  ];
  const supervisor = new TestEnvSupervisor(services);
  const shutdown = (): void => {
    process.stdout.write("\n正在停止常驻测试环境……\n");
    supervisor.down().then(() => process.exit(0), (error) => { process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); process.exit(1); });
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  await supervisor.up();
  process.stdout.write([
    "常驻测试环境已就绪：",
    `  authority-relay      ${relayUrl}`,
    `  openchamber-service  ${openChamberUrl}`,
    "保持此终端运行；Ctrl+C 停止。另一个终端可运行 bun run testenv:down 停止。",
    "",
  ].join("\n"));
  // Foreground residency: stay alive until a signal arrives.
  await new Promise<void>(() => undefined);
}

/**
 * Stateless down: no PID file to go stale. Finds listeners on the two known
 * ports (including IPv6 dual-stack binds) and stops them - refusing anything
 * that is not a node/bun image, and only reporting stopped after the PID is
 * verified gone and the port released.
 */
async function runDown(): Promise<void> {
  const relayPort = loopbackHttpPort(relayUrl, "Relay URL");
  const openChamberPort = loopbackHttpPort(openChamberUrl, "OpenChamber URL");
  let failures = 0;
  for (const { name, port } of [{ name: "authority-relay", port: relayPort }, { name: "openchamber-service", port: openChamberPort }]) {
    try {
      const outcome = await stopPortListeners(port, { allowImages: /^(node|bun)(\.exe)?$/i });
      if (outcome.stopped.length === 0 && outcome.refused.length === 0) {
        process.stdout.write(`${name}：端口 ${port} 无监听进程。\n`);
      }
      for (const entry of outcome.stopped) process.stdout.write(`${name}：已停止 ${entry.image} (PID ${entry.pid})，端口已释放。\n`);
      for (const entry of outcome.refused) {
        process.stderr.write(`${name}：端口 ${port} 由 ${entry.image ?? "未知进程"} (PID ${entry.pid}) 占用，不是本环境管理的 node/bun 服务，拒绝停止。\n`);
        failures += 1;
      }
    } catch (error) {
      process.stderr.write(`${name}：${error instanceof Error ? error.message : String(error)}\n`);
      failures += 1;
    }
  }
  process.exitCode = failures === 0 ? 0 : 1;
}


async function probeAll(): Promise<PreflightProbe[]> {
  return await Promise.all([
    probeHttp("authority-relay", new URL("tasks?limit=1", relayUrl).href),
    probeHttp("openchamber-service", openChamberUrl),
    probeFile("openchamber-build", path.join(repoRoot, "vendor", "openchamber", "packages", "web", "dist", "index.html")),
    probeCodeArts(),
  ]);
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

