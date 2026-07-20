import { createServer } from "node:net";
import { afterEach, describe, expect, test } from "vitest";
import { BridgeClient } from "./bridge-client.js";

const clients: BridgeClient[] = [];

afterEach(() => {
  for (const client of clients.splice(0)) client.disconnect();
});

describe("BridgeClient", () => {
  test("authenticates and answers a bounded getStatus request", async () => {
    const token = "t".repeat(32);
    const messages: Array<Record<string, unknown>> = [];
    const response = new Promise<Record<string, unknown>>((resolveResponse, reject) => {
      const server = createServer((socket) => {
        socket.setEncoding("utf8");
        let buffer = "";
        socket.on("data", (chunk) => {
          buffer += chunk;
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            const message = JSON.parse(line) as Record<string, unknown>;
            messages.push(message);
            if (message.type === "hello") {
              socket.write(`${JSON.stringify({ type: "getStatus", requestId: "test-request" })}\n`);
            }
            if (message.type === "status" && message.requestId === "test-request") {
              socket.write(`${JSON.stringify({ type: "getRuntimeStatus", requestId: "runtime-request" })}\n`);
            }
            if (message.type === "runtimeStatus" && message.requestId === "runtime-request") {
              socket.write(`${JSON.stringify({ type: "runtimeAction", requestId: "action-request", action: "screenshot" })}\n`);
            }
            if (message.type === "runtimeActionResult" && message.requestId === "action-request") {
              socket.end();
              server.close();
              resolveResponse(message);
            }
          }
        });
        socket.on("error", reject);
      });
      server.on("error", reject);
      server.listen(0, "127.0.0.1", () => {
        const address = server.address();
        if (address === null || typeof address === "string") {
          reject(new Error("Failed to allocate a test port."));
          return;
        }
        const client = new BridgeClient({
          port: address.port,
          token,
          extensionVersion: "0.1.0-test",
          getStatus: (requestId) => ({
            ...(requestId === undefined ? {} : { requestId }),
            workspaceFolders: ["C:\\workspace"],
            capabilities: ["workspace-status", "runtime-status", "runtime-actions"],
            remoteOperations: "forbidden",
          }),
          getRuntimeStatus: async (requestId) => ({
            requestId,
            available: true,
            target: { id: "target-1", type: "webview", title: "MiniApp Webview" },
            contextCount: 2,
            gameContext: {
              readyState: "complete",
              canvases: [{ width: 1179, height: 2556, clientWidth: 393, clientHeight: 852 }],
              hasTt: true,
              hasGameGlobal: true,
            },
            remoteOperations: "forbidden",
          }),
          runRuntimeAction: async (request) => ({
            requestId: request.requestId,
            action: request.action,
            ok: true,
            screenshot: { byteLength: 4, sha256: "a".repeat(64) },
            remoteOperations: "forbidden",
          }),
        });
        clients.push(client);
        client.connect();
      });
    });

    await expect(response).resolves.toMatchObject({
      type: "runtimeActionResult",
      requestId: "action-request",
      action: "screenshot",
      ok: true,
      remoteOperations: "forbidden",
    });
    expect(messages[0]).toMatchObject({ type: "hello", token, devtool: "douyin" });
  });

  test("reports connection state changes", async () => {
    const states: string[] = [];
    const server = createServer((socket) => socket.once("data", () => socket.end()));
    await new Promise<void>((resolveListen, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolveListen);
    });
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("Failed to allocate a test port.");
    let resolveDisconnected: (() => void) | undefined;
    const disconnected = new Promise<void>((resolveState) => {
      resolveDisconnected = resolveState;
    });
    const client = new BridgeClient({
      port: address.port,
      token: "t".repeat(32),
      extensionVersion: "0.1.0-test",
      getStatus: () => ({
        workspaceFolders: [],
        capabilities: ["workspace-status", "runtime-status", "runtime-actions"],
        remoteOperations: "forbidden",
      }),
      getRuntimeStatus: async (requestId) => ({
        requestId,
        available: false,
        error: "not running",
        remoteOperations: "forbidden",
      }),
      runRuntimeAction: async (request) => ({
        requestId: request.requestId,
        action: request.action,
        ok: false,
        error: "not running",
        remoteOperations: "forbidden",
      }),
      onStateChange: (state) => {
        states.push(state);
        if (state === "disconnected") resolveDisconnected?.();
      },
    });
    clients.push(client);
    client.connect();
    await disconnected;
    await new Promise<void>((resolveClosed, reject) => {
      server.close((error) => error === undefined ? resolveClosed() : reject(error));
    });
    expect(states).toEqual(["connecting", "connected", "disconnected"]);
  });
});
