import { mkdtemp, readFile, rm } from "node:fs/promises";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { DouyinBridgeController } from "./douyin-bridge-controller.js";

const controllers: DouyinBridgeController[] = [];
const directories: string[] = [];

afterEach(async () => {
  await Promise.all(controllers.splice(0).map((controller) => controller.stop()));
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("DouyinBridgeController", () => {
  test("writes a short-lived rendezvous, authenticates, and correlates Runtime requests", async () => {
    const directory = await mkdtemp(resolve(tmpdir(), "gameforge-douyin-controller-"));
    directories.push(directory);
    const rendezvousPath = resolve(directory, "bridge.json");
    const controller = new DouyinBridgeController(rendezvousPath);
    controllers.push(controller);
    await controller.start();
    const rendezvous = JSON.parse(await readFile(rendezvousPath, "utf8")) as { port: number; token: string; expiresAt: number };
    expect(rendezvous.expiresAt).toBeGreaterThan(Date.now());
    expect(rendezvous.expiresAt).toBeLessThanOrEqual(Date.now() + 60_000);

    const socket = connect({ host: "127.0.0.1", port: rendezvous.port });
    socket.setEncoding("utf8");
    let buffer = "";
    socket.on("connect", () => {
      socket.write(`${JSON.stringify({ type: "hello", protocolVersion: 1, token: rendezvous.token, extensionVersion: "0.1.0-test", devtool: "douyin" })}\n`);
      socket.write(`${JSON.stringify({ type: "status", protocolVersion: 1, connected: true, workspaceFolders: [], capabilities: ["runtime-status"], remoteOperations: "forbidden" })}\n`);
    });
    socket.on("data", (chunk: string) => {
      buffer += chunk;
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const request = JSON.parse(line) as { type: string; requestId: string };
        if (request.type === "getRuntimeStatus") {
          socket.write(`${JSON.stringify({ type: "runtimeStatus", protocolVersion: 1, requestId: request.requestId, available: true, remoteOperations: "forbidden" })}\n`);
        }
      }
    });
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 30));
    await expect(controller.getRuntimeStatus()).resolves.toMatchObject({ available: true, remoteOperations: "forbidden" });
    expect(controller.getStatus()).toMatchObject({ listening: true, connected: true, extensionVersion: "0.1.0-test" });
    socket.destroy();
  });

  test("rejects a wrong token before accepting requests", async () => {
    const directory = await mkdtemp(resolve(tmpdir(), "gameforge-douyin-controller-"));
    directories.push(directory);
    const rendezvousPath = resolve(directory, "bridge.json");
    const controller = new DouyinBridgeController(rendezvousPath);
    controllers.push(controller);
    await controller.start();
    const rendezvous = JSON.parse(await readFile(rendezvousPath, "utf8")) as { port: number };
    const socket = connect({ host: "127.0.0.1", port: rendezvous.port });
    await new Promise<void>((resolveConnected) => socket.once("connect", resolveConnected));
    socket.write(`${JSON.stringify({ type: "hello", protocolVersion: 1, token: "x".repeat(43), extensionVersion: "bad", devtool: "douyin" })}\n`);
    await new Promise<void>((resolveClosed) => socket.once("close", () => resolveClosed()));
    await expect(controller.getRuntimeStatus()).rejects.toThrow("not connected");
  });
});
