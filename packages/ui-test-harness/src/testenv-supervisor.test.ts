import { execFile, spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { TestEnvSupervisor, pidsListeningOn, stopPortListeners, type ManagedServiceSpec } from "./testenv-supervisor.js";

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

  it("aborts an in-flight up when down arrives, leaving no process behind", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "gameforge-testenv-")); roots.push(root);
    const script = path.join(root, "never-ready.mjs");
    // Never listens: up() stays in its readiness poll until down() interrupts.
    await writeFile(script, "setInterval(() => undefined, 1_000);\n", "utf8");
    const port = await freePort();
    const supervisor = new TestEnvSupervisor([{ name: "never-ready", command: process.execPath, args: [script], port }]);
    cleanups.push(() => supervisor.down().catch(() => undefined));

    const upPromise = supervisor.up();
    await new Promise((resolve) => setTimeout(resolve, 300));
    const pids = supervisor.managedPids();
    await supervisor.down();

    await expect(upPromise).rejects.toThrow();
    for (const pid of pids) expect(() => process.kill(pid, 0)).toThrow();
    expect(supervisor.managedPids()).toEqual([]);
  }, SUPERVISOR_TEST_TIMEOUT_MS);

  it("does not leak parent credentials into resident service environments", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "gameforge-testenv-")); roots.push(root);
    const script = path.join(root, "canary.mjs");
    // Exits nonzero when the canary secret is visible, so up() only succeeds
    // if the parent environment was stripped.
    await writeFile(script, `
      import net from "node:net";
      if (process.env.GAMEFORGE_CANARY_SECRET !== undefined) process.exit(17);
      net.createServer(() => undefined).listen(Number(process.env.SERVICE_PORT), "127.0.0.1");
      setInterval(() => undefined, 1_000);
    `, "utf8");
    const port = await freePort();
    process.env.GAMEFORGE_CANARY_SECRET = "leak-me";
    cleanups.push(() => { delete process.env.GAMEFORGE_CANARY_SECRET; });
    const supervisor = new TestEnvSupervisor([{ name: "canary", command: process.execPath, args: [script], port, env: { SERVICE_PORT: String(port) } }]);
    cleanups.push(() => supervisor.down().catch(() => undefined));

    await supervisor.up();
    await supervisor.down();
  }, SUPERVISOR_TEST_TIMEOUT_MS);

  it("finds and stops a dual-stack listener, verifying the port is released", async () => {
    const port = await freePort();
    // Node's default listen() binds "::" (dual-stack) - netstat shows [::]:port.
    const child = spawn(process.execPath, ["-e", `require("net").createServer(()=>{}).listen(${port});setInterval(()=>{},1000)`], { stdio: "ignore", windowsHide: true });
    cleanups.push(() => { try { child.kill(); } catch { /* already gone */ } });
    const deadline = Date.now() + 10_000;
    while (!(await portListening(port))) {
      if (Date.now() > deadline) throw new Error("fixture listener never came up");
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    const pids = await pidsListeningOn(port);
    expect(pids).toContain(child.pid);

    const stopped = await stopPortListeners(port, { allowImages: /^(node|bun)(\.exe)?$/i });
    expect(stopped.stopped.map((entry) => entry.pid)).toContain(child.pid);
    expect(stopped.refused).toEqual([]);
    expect(await portListening(port)).toBe(false);
  }, SUPERVISOR_TEST_TIMEOUT_MS);

  it("refuses to stop an unrelated node listener when the service contract does not match", async () => {
    const port = await freePort();
    const child = spawn(process.execPath, ["-e", `require("net").createServer(()=>{}).listen(${port},"127.0.0.1");setInterval(()=>{},1000)`], { stdio: "ignore", windowsHide: true });
    cleanups.push(() => { try { child.kill(); } catch { /* already gone */ } });
    const deadline = Date.now() + 10_000;
    while (!(await portListening(port))) {
      if (Date.now() > deadline) throw new Error("fixture listener never came up");
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    const outcome = await stopPortListeners(port, {
      allowImages: /^(node|bun)(\.exe)?$/i,
      verifyOwnership: async () => false,
    });

    expect(outcome.stopped).toEqual([]);
    expect(outcome.refused.map((entry) => entry.pid)).toContain(child.pid);
    expect(await portListening(port)).toBe(true);
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

  it.skipIf(process.platform !== "win32")("retains a managed service when cleanup cannot verify its port release", async () => {
    const port = await freePort();
    const supervisor = new TestEnvSupervisor([await fixtureService("cleanup-retry-fixture", port)]);
    cleanups.push(() => supervisor.down().catch(() => undefined));
    await supervisor.up();
    const [managedPid] = supervisor.managedPids();
    if (managedPid === undefined) throw new Error("Expected a managed fixture PID.");
    await new Promise<void>((resolve) => execFile("taskkill.exe", ["/PID", String(managedPid), "/T", "/F"], { windowsHide: true }, () => resolve()));
    while (await portListening(port)) await new Promise((resolve) => setTimeout(resolve, 50));
    const blocker = spawn(process.execPath, ["-e", `require("net").createServer(()=>{}).listen(${port},"127.0.0.1");setInterval(()=>{},1000)`], { stdio: "ignore", windowsHide: true });
    cleanups.push(() => { try { blocker.kill(); } catch { /* already gone */ } });
    while (!(await portListening(port))) await new Promise((resolve) => setTimeout(resolve, 50));

    await expect(supervisor.down()).rejects.toThrow("still occupied after cleanup");
    expect(supervisor.managedPids()).toContain(managedPid);
    blocker.kill();
    while (await portListening(port)) await new Promise((resolve) => setTimeout(resolve, 50));
    await expect(supervisor.down()).resolves.toBeUndefined();
  }, SUPERVISOR_TEST_TIMEOUT_MS);

  it("settles foreground residency after an external stop removes a managed listener", async () => {
    const port = await freePort();
    let externalShutdownRequested = false;
    const supervisor = new TestEnvSupervisor([await fixtureService("external-down-fixture", port)], { externalShutdownRequested: async () => externalShutdownRequested });
    cleanups.push(() => supervisor.down().catch(() => undefined));

    await supervisor.up();
    const residency = (supervisor as TestEnvSupervisor & { waitUntilStopped(): Promise<void> }).waitUntilStopped();
    externalShutdownRequested = true;
    await stopPortListeners(port, { allowImages: /^(node|bun)(\.exe)?$/i });

    await expect(residency).resolves.toBeUndefined();
    expect(supervisor.managedPids()).toEqual([]);
  }, SUPERVISOR_TEST_TIMEOUT_MS);

  it.skipIf(process.platform !== "win32")("reports simultaneous unrequested resident exits as a failure", async () => {
    const firstPort = await freePort(); const secondPort = await freePort();
    const supervisor = new TestEnvSupervisor([await fixtureService("first-crashed", firstPort), await fixtureService("second-crashed", secondPort)]);
    cleanups.push(() => supervisor.down().catch(() => undefined));
    await supervisor.up();
    const pids = supervisor.managedPids();
    const residency = supervisor.waitUntilStopped();
    await Promise.all(pids.map((pid) => new Promise<void>((resolve) => execFile("taskkill.exe", ["/PID", String(pid), "/T", "/F"], { windowsHide: true }, () => resolve()))));

    await expect(residency).rejects.toThrow(/exited unexpectedly/);
  }, SUPERVISOR_TEST_TIMEOUT_MS);

  it.skipIf(process.platform !== "win32")("reports a single resident-service crash instead of a clean shutdown", async () => {
    const firstPort = await freePort(); const secondPort = await freePort();
    const supervisor = new TestEnvSupervisor([
      await fixtureService("crashed-resident", firstPort),
      await fixtureService("surviving-resident", secondPort),
    ]);
    cleanups.push(() => supervisor.down().catch(() => undefined));
    await supervisor.up();
    const [crashedPid] = supervisor.managedPids();
    if (crashedPid === undefined) throw new Error("Expected a managed fixture PID.");
    const residency = supervisor.waitUntilStopped();
    await new Promise<void>((resolve) => execFile("taskkill.exe", ["/PID", String(crashedPid), "/T", "/F"], { windowsHide: true }, () => resolve()));

    await expect(residency).rejects.toThrow("crashed-resident exited unexpectedly");
    expect(supervisor.managedPids()).toEqual([]);
  }, SUPERVISOR_TEST_TIMEOUT_MS);
});
