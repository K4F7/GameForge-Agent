import { createServer, type Server } from "node:http";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, test } from "vitest";
import { DouyinBridgeHostClient } from "./douyin-bridge-host-client.js";

const servers: Server[] = [];
const directories: string[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolveClose) => {
    server.closeAllConnections();
    server.close(() => resolveClose());
  })));
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("DouyinBridgeHostClient", () => {
  test("authenticates to a loopback host and proxies a bounded Runtime action", async () => {
    const token = "t".repeat(43);
    let received: unknown;
    const server = createServer(async (request, response) => {
      expect(request.headers.authorization).toBe(`Bearer ${token}`);
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      received = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({
        status: { listening: true, connected: true, extensionVersion: "test" },
        result: { action: "tap", ok: true, remoteOperations: "forbidden" },
      }));
    });
    servers.push(server);
    await new Promise<void>((resolveListen, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolveListen);
    });
    const directory = await mkdtemp(resolve(tmpdir(), "gameforge-douyin-host-client-"));
    directories.push(directory);
    const rendezvous = resolve(directory, "host.json");
    await writeFile(rendezvous, JSON.stringify({ port: (server.address() as AddressInfo).port, token }), "utf8");
    const client = new DouyinBridgeHostClient(rendezvous);
    await expect(client.runRuntimeAction({ action: "tap", x: 12, y: 34 })).resolves.toMatchObject({ ok: true, action: "tap" });
    expect(received).toEqual({ action: "tap", x: 12, y: 34 });
    expect(client.getStatus()).toMatchObject({ listening: true, connected: true, extensionVersion: "test" });
  });

  test("rejects an invalid host rendezvous", async () => {
    const directory = await mkdtemp(resolve(tmpdir(), "gameforge-douyin-host-client-"));
    directories.push(directory);
    const rendezvous = resolve(directory, "host.json");
    await writeFile(rendezvous, JSON.stringify({ port: 80, token: "short" }), "utf8");
    await expect(new DouyinBridgeHostClient(rendezvous).getRuntimeStatus()).rejects.toThrow("rendezvous is invalid");
  });
});
