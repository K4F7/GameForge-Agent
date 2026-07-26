#!/usr/bin/env bun

import { execFile } from "node:child_process";
import { access } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { evaluatePreflight, type PreflightProbe, type PreflightReport } from "./preflight.js";
import { DEFAULT_OPENCHAMBER_URL, DEFAULT_RELAY_URL } from "./testenv-config.js";
import { TestEnvSupervisor, type ManagedServiceSpec } from "./testenv-supervisor.js";

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

const PROBE_TIMEOUT_MS = 2_000;
const execFileAsync = promisify(execFile);

const relayUrl = process.env.GAMEFORGE_RUN_RELAY_URL?.trim() || DEFAULT_RELAY_URL;
const openChamberUrl = process.env.GAMEFORGE_OPENCHAMBER_URL?.trim() || DEFAULT_OPENCHAMBER_URL;
const relayPort = loopbackPort(relayUrl, "Relay URL");
const openChamberPort = loopbackPort(openChamberUrl, "OpenChamber URL");

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
 * loopback ports and stops them - refusing anything that is not a node/bun
 * image, so an unrelated service parked on the port is reported, not killed.
 */
async function runDown(): Promise<void> {
  let failures = 0;
  for (const { name, port } of [{ name: "authority-relay", port: relayPort }, { name: "openchamber-service", port: openChamberPort }]) {
    const pids = await pidsListeningOn(port);
    if (pids.length === 0) { process.stdout.write(`${name}：端口 ${port} 无监听进程。\n`); continue; }
    for (const pid of pids) {
      const image = await processImage(pid);
      if (image === undefined || !/^(node|bun)(\.exe)?$/i.test(image)) {
        process.stderr.write(`${name}：端口 ${port} 由 ${image ?? "未知进程"} (PID ${pid}) 占用，不是本环境管理的 node/bun 服务，拒绝停止。\n`);
        failures += 1;
        continue;
      }
      await execFileAsync("taskkill.exe", ["/PID", String(pid), "/T", "/F"], { windowsHide: true, timeout: 10_000 }).catch(() => undefined);
      process.stdout.write(`${name}：已停止 ${image} (PID ${pid})。\n`);
    }
  }
  process.exitCode = failures === 0 ? 0 : 1;
}

async function pidsListeningOn(port: number): Promise<number[]> {
  const { stdout } = await execFileAsync("netstat.exe", ["-ano", "-p", "TCP"], { windowsHide: true, timeout: 10_000, maxBuffer: 8 * 1024 * 1024 });
  const pids = new Set<number>();
  for (const line of stdout.split(/\r?\n/)) {
    const match = line.match(/^\s*TCP\s+(\S+):(\d+)\s+\S+\s+LISTENING\s+(\d+)\s*$/);
    if (match !== null && Number(match[2]) === port && (match[1] === "127.0.0.1" || match[1] === "0.0.0.0" || match[1] === "[::1]")) {
      pids.add(Number(match[3]));
    }
  }
  return [...pids];
}

async function processImage(pid: number): Promise<string | undefined> {
  const { stdout } = await execFileAsync("tasklist.exe", ["/FI", `PID eq ${pid}`, "/FO", "CSV", "/NH"], { windowsHide: true, timeout: 10_000 }).catch(() => ({ stdout: "" }));
  const image = stdout.match(/^"([^"]+)"/)?.[1];
  return image;
}

function loopbackPort(url: string, label: string): number {
  const parsed = new URL(url);
  const port = parsed.port === "" ? (parsed.protocol === "https:" ? 443 : 80) : Number(parsed.port);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error(`${label} has an invalid port.`);
  return port;
}

async function probeAll(): Promise<PreflightProbe[]> {
  return await Promise.all([
    probeHttp("authority-relay", new URL("tasks?limit=1", relayUrl).href),
    probeHttp("openchamber-service", openChamberUrl),
    probeFile("openchamber-build", path.join(repoRoot, "vendor", "openchamber", "packages", "web", "dist", "index.html")),
    probeCodeArts(),
  ]);
}

async function probeHttp(dependency: PreflightProbe["dependency"], url: string): Promise<PreflightProbe> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS), redirect: "manual" });
    // A 5xx means the process is listening but not serving; treat it as down so
    // the report cannot show OK for a dependency the run will fail against.
    if (response.status >= 500) return { dependency, available: false, detail: `${url} responded ${response.status}` };
    return { dependency, available: true, detail: `${url} responded ${response.status}` };
  } catch (error) {
    return { dependency, available: false, detail: `${url} is not reachable: ${errorMessage(error)}` };
  }
}

async function probeFile(dependency: PreflightProbe["dependency"], target: string): Promise<PreflightProbe> {
  try {
    await access(target);
    return { dependency, available: true, detail: target };
  } catch {
    return { dependency, available: false, detail: `${target} is missing` };
  }
}

/**
 * Mirrors the candidate list used by the repository CodeArts launcher. The
 * harness only detects the client - it never manages its authorization or
 * private data directory (ADR-0005).
 */
async function probeCodeArts(): Promise<PreflightProbe> {
  const configured = process.env.CODEARTS_BIN?.trim();
  const home = process.env.USERPROFILE?.trim() || process.env.HOME?.trim() || "";
  const installers = path.join(home, ".codeartsdoer", "installers");
  const candidates = configured ? [configured] : [path.join(installers, "bin", "codearts.exe"), path.join(installers, "codearts.cmd")];
  for (const candidate of candidates) {
    try {
      await access(candidate);
      return { dependency: "codearts", available: true, detail: candidate };
    } catch { continue; }
  }
  return { dependency: "codearts", available: false, detail: `No CodeArts client under ${installers}; set CODEARTS_BIN to override` };
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

function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error); }
