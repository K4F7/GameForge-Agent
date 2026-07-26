import { execFile, spawn, type ChildProcess } from "node:child_process";
import net from "node:net";

/**
 * Owns the resident test environment: credential-free loopback services that
 * outlive any single harness run (ADR-0005). It never manages CodeArts.
 *
 * Lifecycle rules mirror the repository's driver contracts: refuse to start
 * over an occupied port, roll back partial startup, share one in-flight
 * cleanup across concurrent down() calls, and only report down() complete
 * once the managed PIDs are gone and the ports are released.
 */
export type ManagedServiceSpec = {
  name: string;
  command: string;
  args: string[];
  cwd?: string;
  env?: Readonly<Record<string, string>>;
  /** Loopback port the service must end up listening on. */
  port: number;
};

type ManagedService = { spec: ManagedServiceSpec; child: ChildProcess };

const READY_TIMEOUT_MS = 30_000;
const STOP_TIMEOUT_MS = 10_000;

/**
 * Only these parent variables reach the resident services; everything else -
 * relay tokens, provider keys, CodeArts credentials - is deliberately absent
 * so the environment stays the credential-free one it promises to be. Service
 * specifics arrive via each spec's explicit env.
 */
const CHILD_ENV_ALLOWLIST = ["PATH", "PATHEXT", "SYSTEMROOT", "SYSTEMDRIVE", "WINDIR", "COMSPEC", "TEMP", "TMP", "TMPDIR", "HOME", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "PROGRAMDATA", "NODE_PATH", "LANG", "LC_ALL"];

export class TestEnvSupervisor {
  #services: ManagedService[] = [];
  #upPromise: Promise<void> | undefined;
  #stopRequested = false;
  #downPromise: Promise<void> | undefined;

  constructor(private readonly specs: readonly ManagedServiceSpec[]) {}

  managedPids(): number[] {
    return this.#services
      .map((service) => service.child.pid)
      .filter((pid): pid is number => pid !== undefined);
  }

  async up(): Promise<void> {
    if (this.#upPromise !== undefined || this.#services.length > 0) throw new Error("Test environment is already up.");
    if (this.#downPromise !== undefined) throw new Error("Test environment is still stopping.");
    this.#stopRequested = false;
    const upPromise = this.#startAll();
    this.#upPromise = upPromise;
    try { await upPromise; } finally { if (this.#upPromise === upPromise) this.#upPromise = undefined; }
  }

  async #startAll(): Promise<void> {
    try {
      for (const spec of this.specs) {
        this.#throwIfStopRequested();
        if (await portListening(spec.port)) {
          throw new Error(`Port ${spec.port} for ${spec.name} is already occupied; refusing to start over it.`);
        }
        this.#throwIfStopRequested();
        const child = spawn(spec.command, spec.args, {
          cwd: spec.cwd,
          env: { ...allowlistedEnvironment(), ...spec.env },
          stdio: ["ignore", "ignore", "pipe"],
          windowsHide: true,
        });
        this.#services.push({ spec, child });
        await this.#waitUntilReady(spec, child);
      }
    } catch (error) {
      await this.#stopAll();
      throw error;
    }
  }

  #throwIfStopRequested(): void {
    if (this.#stopRequested) throw new Error("Test environment startup was stopped by a concurrent down().");
  }

  /**
   * Coordinates with an in-flight up(): no further service may spawn after a
   * down() arrives, and down() only resolves once the startup has settled and
   * every already-spawned process is gone.
   */
  down(): Promise<void> {
    this.#downPromise ??= (async () => {
      this.#stopRequested = true;
      await this.#upPromise?.catch(() => undefined);
      await this.#stopAll();
    })().finally(() => { this.#downPromise = undefined; });
    return this.#downPromise;
  }

  /**
   * Keeps the foreground owner alive while every managed service is alive.
   * If an external `testenv down` (or a crash) removes any listener process,
   * the remaining services are stopped as one environment before resolving.
   */
  async waitUntilStopped(): Promise<void> {
    const children = this.#services.map((service) => service.child);
    if (children.length === 0) return;
    await Promise.race(children.map((child) => {
      if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
      return new Promise<void>((resolve) => { child.once("exit", () => resolve()); });
    }));
    await this.down();
  }

  async #waitUntilReady(spec: ManagedServiceSpec, child: ChildProcess): Promise<void> {
    let stderrTail = "";
    child.stderr?.on("data", (chunk: unknown) => { stderrTail = (stderrTail + String(chunk)).slice(-2_048); });
    const startedAt = Date.now();
    while (Date.now() - startedAt < READY_TIMEOUT_MS) {
      this.#throwIfStopRequested();
      if (child.exitCode !== null || child.signalCode !== null) {
        throw new Error(`${spec.name} exited before listening on ${spec.port}: ${stderrTail.trim()}`);
      }
      if (await portListening(spec.port)) return;
      await delay(100);
    }
    throw new Error(`${spec.name} did not listen on ${spec.port} within ${READY_TIMEOUT_MS} milliseconds.`);
  }

  async #stopAll(): Promise<void> {
    const services = this.#services.splice(0);
    const failures: string[] = [];
    await Promise.all(services.map(async ({ spec, child }) => {
      try {
        await stopProcessTree(child);
        await waitUntilPortFree(spec.port, STOP_TIMEOUT_MS, spec.name);
      } catch (error) {
        failures.push(`${spec.name}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }));
    if (failures.length > 0) throw new Error(`Test environment cleanup failed: ${failures.join("; ")}`);
  }
}

async function stopProcessTree(child: ChildProcess): Promise<void> {
  const pid = child.pid;
  if (pid === undefined || child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise<void>((resolve) => { child.once("exit", () => resolve()); });
  if (process.platform === "win32") {
    await new Promise<void>((resolve) => {
      execFile("taskkill.exe", ["/PID", String(pid), "/T", "/F"], { windowsHide: true, timeout: STOP_TIMEOUT_MS }, () => resolve());
    });
  } else {
    child.kill("SIGTERM");
  }
  await Promise.race([exited, delay(STOP_TIMEOUT_MS).then(() => { throw new Error(`process ${pid} did not exit within ${STOP_TIMEOUT_MS} milliseconds.`); })]);
  if (processExists(pid)) throw new Error(`process ${pid} is still alive after cleanup.`);
}

function processExists(pid: number): boolean {
  try { process.kill(pid, 0); return true; }
  catch (error) { return (error as NodeJS.ErrnoException).code === "EPERM"; }
}

function portListening(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host: "127.0.0.1" });
    let settled = false;
    const done = (value: boolean): void => { if (settled) return; settled = true; socket.destroy(); resolve(value); };
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
    setTimeout(() => done(false), 1_000);
  });
}

async function waitUntilPortFree(port: number, timeoutMs: number, name: string): Promise<void> {
  const startedAt = Date.now();
  while (await portListening(port)) {
    if (Date.now() - startedAt >= timeoutMs) throw new Error(`port ${port} for ${name} is still occupied after cleanup.`);
    await delay(100);
  }
}

function delay(ms: number): Promise<void> { return new Promise((resolve) => setTimeout(resolve, ms)); }

function allowlistedEnvironment(): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && CHILD_ENV_ALLOWLIST.includes(key.toUpperCase())) result[key] = value;
  }
  return result;
}

/**
 * Windows netstat listeners on a loopback-reachable port. Matches IPv4 any,
 * IPv4 loopback, IPv6 loopback AND IPv6 any ("[::]") - Node's default
 * listen() binds dual-stack "::", which netstat reports as [::]:port.
 */
export async function pidsListeningOn(port: number): Promise<number[]> {
  const stdout = await new Promise<string>((resolve, reject) => {
    execFile("netstat.exe", ["-ano", "-p", "TCP"], { windowsHide: true, timeout: 10_000, maxBuffer: 8 * 1024 * 1024 }, (error, out) => {
      if (error !== null) reject(error); else resolve(out);
    });
  });
  const pids = new Set<number>();
  for (const line of stdout.split(/\r?\n/)) {
    const match = line.match(/^\s*TCP\s+(\S+?):(\d+)\s+\S+\s+LISTENING\s+(\d+)\s*$/);
    if (match !== null && Number(match[2]) === port && ["127.0.0.1", "0.0.0.0", "[::1]", "[::]"].includes(match[1]!)) {
      pids.add(Number(match[3]));
    }
  }
  return [...pids];
}

async function processImage(pid: number): Promise<string | undefined> {
  const stdout = await new Promise<string>((resolve) => {
    execFile("tasklist.exe", ["/FI", `PID eq ${pid}`, "/FO", "CSV", "/NH"], { windowsHide: true, timeout: 10_000 }, (_error, out) => resolve(out ?? ""));
  });
  return stdout.match(/^"([^"]+)"/)?.[1];
}

export type StopPortListenersResult = {
  stopped: Array<{ pid: number; image: string }>;
  refused: Array<{ pid: number; image: string | undefined }>;
};

/**
 * Stateless stop for `testenv down`: kills listeners whose image matches
 * allowImages, refuses everything else, and only reports a PID as stopped
 * after verifying the process tree is gone and the port is released.
 */
export async function stopPortListeners(port: number, options: { allowImages: RegExp }): Promise<StopPortListenersResult> {
  const result: StopPortListenersResult = { stopped: [], refused: [] };
  for (const pid of await pidsListeningOn(port)) {
    const image = await processImage(pid);
    if (image === undefined || !options.allowImages.test(image)) {
      result.refused.push({ pid, image });
      continue;
    }
    await new Promise<void>((resolve) => {
      execFile("taskkill.exe", ["/PID", String(pid), "/T", "/F"], { windowsHide: true, timeout: STOP_TIMEOUT_MS }, () => resolve());
    });
    const deadline = Date.now() + STOP_TIMEOUT_MS;
    while (processExists(pid)) {
      if (Date.now() >= deadline) throw new Error(`process ${pid} (${image}) on port ${port} did not exit after taskkill.`);
      await delay(100);
    }
    result.stopped.push({ pid, image });
  }
  if (result.refused.length === 0) await waitUntilPortFree(port, STOP_TIMEOUT_MS, `port-${port}`);
  return result;
}
