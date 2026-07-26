import { createServer, type Server } from "node:http";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { probeCodeArts, probeHttp, probeRunDependencies } from "./preflight-probes.js";

const servers: Server[] = [];
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function serve(handler: Parameters<typeof createServer>[1]): Promise<string> {
  const server = createServer(handler); servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("No port assigned.");
  return `http://127.0.0.1:${address.port}/`;
}

describe("probeHttp", () => {
  it("reports the relay available only when the endpoint speaks the task contract", async () => {
    const goodUrl = await serve((_request, response) => { response.writeHead(200, { "content-type": "application/json" }); response.end(JSON.stringify({ tasks: [] })); });
    const good = await probeHttp("authority-relay", new URL("tasks?limit=1", goodUrl).href);
    expect(good.available).toBe(true);

    // Wrong service parked on the pinned port: 200 but not the relay contract.
    const wrongUrl = await serve((_request, response) => { response.writeHead(200, { "content-type": "text/html" }); response.end("<html>hello</html>"); });
    const wrong = await probeHttp("authority-relay", new URL("tasks?limit=1", wrongUrl).href);
    expect(wrong.available).toBe(false);
  });

  it("reports OpenChamber available only when the landing page is actually served", async () => {
    const goodUrl = await serve((_request, response) => { response.writeHead(200, { "content-type": "text/html" }); response.end('<html><head><title>OpenChamber - AI Coding Assistant</title></head><body><div id="root"></div></body></html>'); });
    expect((await probeHttp("openchamber-service", goodUrl)).available).toBe(true);

    const wrongUrl = await serve((_request, response) => { response.writeHead(200, { "content-type": "application/json" }); response.end(JSON.stringify({ tasks: [] })); });
    expect((await probeHttp("openchamber-service", wrongUrl)).available).toBe(false);
  });

  it("treats HTTP 4xx as unavailable", async () => {
    const url = await serve((_request, response) => { response.writeHead(404); response.end("missing"); });
    expect((await probeHttp("authority-relay", url)).available).toBe(false);
    expect((await probeHttp("openchamber-service", url)).available).toBe(false);
  });
});

describe("probeCodeArts", () => {
  it("finds a PATH-installed codearts on non-Windows platforms like the launcher does", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "gameforge-codearts-path-")); roots.push(root);
    await writeFile(path.join(root, "codearts"), "#!/bin/sh\n", "utf8");

    const found = await probeCodeArts({ platform: "linux", env: { PATH: root } });
    expect(found.available).toBe(true);
    expect(found.detail).toContain(root);

    const missing = await probeCodeArts({ platform: "linux", env: { PATH: path.join(root, "does-not-exist") } });
    expect(missing.available).toBe(false);
  });

  it("probes the configured attach session instead of the local executable", async () => {
    const relayUrl = await serve((request, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(request.url?.startsWith("/tasks") ? JSON.stringify({ tasks: [] }) : "missing");
    });
    const openChamberUrl = await serve((_request, response) => {
      response.writeHead(200, { "content-type": "text/html" });
      response.end('<html><title>OpenChamber</title><div id="root"></div></html>');
    });
    const unavailableAttachUrl = "http://127.0.0.1:1/";

    const probes = await probeRunDependencies({
      relayUrl,
      openChamberUrl,
      codeArtsAttach: { serverUrl: unavailableAttachUrl, sessionId: "ses_missing" },
    });

    const codeArts = probes.find((probe) => probe.dependency === "codearts");
    expect(codeArts?.available).toBe(false);
    expect(codeArts?.detail).toContain("/session/ses_missing");
  });
});
