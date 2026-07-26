import { createServer, type Server } from "node:http";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openChamberExternalEnvironment, registerOpenChamberDirectory, verifyOpenChamberDirectory } from "./openchamber-external.js";

let server: Server | undefined;
afterEach(async () => {
  if (server !== undefined) await new Promise<void>((resolve) => server!.close(() => resolve()));
  server = undefined;
});

describe("registerOpenChamberDirectory", () => {
  it("builds the explicit environment for an external CodeArts server", () => {
    expect(openChamberExternalEnvironment("http://127.0.0.1:4097/")).toEqual({
      OPENCODE_HOST: "http://127.0.0.1:4097",
      OPENCODE_SKIP_START: "true",
    });
  });

  it("registers and verifies the project through OpenChamber's public API", async () => {
    const requests: Array<{ method: string | undefined; url: string | undefined; body: string }> = [];
    server = createServer((request, response) => {
      let body = "";
      request.setEncoding("utf8");
      request.on("data", (chunk) => { body += chunk; });
      request.on("end", () => {
        requests.push({ method: request.method, url: request.url, body });
        response.writeHead(200, { "content-type": "application/json" });
        response.end(request.method === "POST"
          ? JSON.stringify({ success: true, path: "D:/work/GameForge-Agent" })
          : JSON.stringify({ lastDirectory: "D:/work/GameForge-Agent", activeProjectId: "project-1", projects: [{ id: "project-1", path: "D:/work/GameForge-Agent" }] }));
      });
    });
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("No port assigned.");

    await registerOpenChamberDirectory(`http://127.0.0.1:${address.port}/`, "D:/work/GameForge-Agent");

    expect(requests).toEqual([
      { method: "POST", url: "/api/opencode/directory", body: JSON.stringify({ path: "D:/work/GameForge-Agent" }) },
      { method: "GET", url: "/api/config/settings", body: "" },
    ]);
  });

  it("revalidates the active project without mutating it", async () => {
    const requests: string[] = [];
    server = createServer((request, response) => {
      requests.push(`${request.method} ${request.url}`);
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ lastDirectory: "D:/work/GameForge-Agent", activeProjectId: "project-1", projects: [{ id: "project-1", path: "D:/work/GameForge-Agent" }] }));
    });
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("No port assigned.");

    await verifyOpenChamberDirectory(`http://127.0.0.1:${address.port}/`, "D:/work/GameForge-Agent");

    expect(requests).toEqual(["GET /api/config/settings"]);
  });

  it("bounds a stalled OpenChamber registration", async () => {
    server = createServer((request, response) => {
      setTimeout(() => {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(request.method === "POST"
          ? JSON.stringify({ success: true })
          : JSON.stringify({ lastDirectory: "D:/work/GameForge-Agent", activeProjectId: "project-1", projects: [{ id: "project-1", path: "D:/work/GameForge-Agent" }] }));
      }, 200);
    });
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("No port assigned.");

    await expect(registerOpenChamberDirectory(
      `http://127.0.0.1:${address.port}/`,
      "D:/work/GameForge-Agent",
      { timeoutMs: 20 },
    )).rejects.toThrow("timed out");
  });

  it("accepts the canonical project path persisted by OpenChamber", async () => {
    const requested = `${process.cwd()}${path.sep}folder${path.sep}..${path.sep}GameForge-Agent`;
    const persisted = path.resolve(process.cwd(), "GameForge-Agent");
    server = createServer((request, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(request.method === "POST"
        ? JSON.stringify({ success: true, path: persisted })
        : JSON.stringify({ lastDirectory: persisted, activeProjectId: "project-1", projects: [{ id: "project-1", path: persisted }] }));
    });
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("No port assigned.");

    await expect(registerOpenChamberDirectory(`http://127.0.0.1:${address.port}/`, requested)).resolves.toBeUndefined();
  });
});
