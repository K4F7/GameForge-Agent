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

export class TestEnvSupervisor {
  #services: ManagedService[] = [];
  #upInProgress = false;
  #downPromise: Promise<void> | undefined;

  constructor(private readonly specs: readonly ManagedServiceSpec[]) {}

  managedPids(): number[] {
    return this.#services
      .map((service) => service.child.pid)
      .filter((pid): pid is number => pid !== undefined);
  }

  async up(): Promise<void> {
    if (this.#upInProgress || this.#services.length > 0) throw new Error("Test environment is already up.");
    if (this.#downPromise !== undefined) throw new Error("Test environment is still stopping.");
    this.#upInProgress = true;
    try {
      for (const spec of this.specs) {
        if (await portListening(spec.port)) {
          throw new Error(`Port ${spec.port} for ${spec.name} is already occupied; refusing to start over it.`);
        }
        const child = spawn(spec.command, spec.args, {
          cwd: spec.cwd,
          env: { ...process.env, ...spec.env },
          stdio: ["ignore", "ignore", "pipe"],
          windowsHide: true,
        });
        this.#services.push({ spec, child });
        await this.#waitUntilReady(spec, child);
      }
    } catch (error) {
      await this.#stopAll();
      throw error;
    } finally {
      this.#upInProgress = false;
    }
  }

  down(): Promise<void> {
    this.#downPromise ??= this.#stopAll().finally(() => { this.#downPromise = undefined; });
    return this.#downPromise;
  }

  async #waitUntilReady(spec: ManagedServiceSpec, child: ChildProcess): Promise<void> {
    let stderrTail = "";
    child.stderr?.on("data", (chunk: unknown) => { stderrTail = (stderrTail + String(chunk)).slice(-2_048); });
    const startedAt = Date.now();
    while (Date.now() - startedAt < READY_TIMEOUT_MS) {
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
