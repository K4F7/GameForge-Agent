import { mkdtemp, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { TestEnvSupervisor, type ManagedServiceSpec } from "./testenv-supervisor.js";

const SUPERVISOR_TEST_TIMEOUT_MS = 30_000;
const roots: string[] = [];
const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })));
});

async function fixtureService(name: string, port: number): Promise<ManagedServiceSpec> {
  const root = await mkdtemp(path.join(os.tmpdir(), "gameforge-testenv-")); roots.push(root);
  const script = path.join(root, `${name}.mjs`);
  await writeFile(script, `
    import net from "node:net";
    const server = net.createServer(() => undefined);
    server.listen(${port}, "127.0.0.1", () => process.stderr.write("listening\\n"));
    setInterval(() => undefined, 1_000);
  `, "utf8");
  return { name, command: process.execPath, args: [script], port };
}

async function freePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      if (address === null || typeof address === "string") { probe.close(); reject(new Error("No port assigned.")); return; }
      probe.close(() => resolve(address.port));
    });
  });
}

function portListening(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host: "127.0.0.1" });
    const done = (value: boolean): void => { socket.destroy(); resolve(value); };
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
    setTimeout(() => done(false), 1_000);
  });
}

describe("TestEnvSupervisor", () => {
  it("starts a service, then releases its port and PID on down", async () => {
    const port = await freePort();
    const supervisor = new TestEnvSupervisor([await fixtureService("relay-fixture", port)]);
    cleanups.push(() => supervisor.down().catch(() => undefined));

    await supervisor.up();
    expect(await portListening(port)).toBe(true);
    const pids = supervisor.managedPids();
    expect(pids.length).toBe(1);

    await supervisor.down();
    expect(await portListening(port)).toBe(false);
    for (const pid of pids) {
      expect(() => process.kill(pid, 0)).toThrow();
    }
  }, SUPERVISOR_TEST_TIMEOUT_MS);

  it("refuses to start when the port is already occupied and leaves nothing behind", async () => {
    const port = await freePort();
    const occupant = net.createServer(() => undefined);
    await new Promise<void>((resolve) => occupant.listen(port, "127.0.0.1", resolve));
    cleanups.push(() => new Promise<void>((resolve) => occupant.close(() => resolve())));
    const supervisor = new TestEnvSupervisor([await fixtureService("occupied-fixture", port)]);
    cleanups.push(() => supervisor.down().catch(() => undefined));

    await expect(supervisor.up()).rejects.toThrow(/occupied|already/i);
    expect(supervisor.managedPids()).toEqual([]);
  }, SUPERVISOR_TEST_TIMEOUT_MS);

  it("rolls back already-started services when a later one cannot start", async () => {
    const firstPort = await freePort();
    const blockedPort = await freePort();
    const occupant = net.createServer(() => undefined);
    await new Promise<void>((resolve) => occupant.listen(blockedPort, "127.0.0.1", resolve));
    cleanups.push(() => new Promise<void>((resolve) => occupant.close(() => resolve())));
    const supervisor = new TestEnvSupervisor([
      await fixtureService("first-fixture", firstPort),
      await fixtureService("blocked-fixture", blockedPort),
    ]);
    cleanups.push(() => supervisor.down().catch(() => undefined));

    await expect(supervisor.up()).rejects.toThrow();
    expect(await portListening(firstPort)).toBe(false);
    expect(supervisor.managedPids()).toEqual([]);
  }, SUPERVISOR_TEST_TIMEOUT_MS);

  it("rejects a second up while services are running", async () => {
    const port = await freePort();
    const supervisor = new TestEnvSupervisor([await fixtureService("second-up-fixture", port)]);
    cleanups.push(() => supervisor.down().catch(() => undefined));

    await supervisor.up();
    await expect(supervisor.up()).rejects.toThrow(/already/i);
    await supervisor.down();
  }, SUPERVISOR_TEST_TIMEOUT_MS);

  it("shares one cleanup across concurrent down calls", async () => {
    const port = await freePort();
    const supervisor = new TestEnvSupervisor([await fixtureService("concurrent-down-fixture", port)]);
    cleanups.push(() => supervisor.down().catch(() => undefined));

    await supervisor.up();
    const pids = supervisor.managedPids();
    const [first, second] = [supervisor.down(), supervisor.down()];
    await second;
    // When either call resolves, the process must already be gone.
    for (const pid of pids) {
      expect(() => process.kill(pid, 0)).toThrow();
    }
    await first;
    expect(await portListening(port)).toBe(false);
  }, SUPERVISOR_TEST_TIMEOUT_MS);
});
