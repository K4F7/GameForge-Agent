import { execFile, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

describe("testenv CLI", () => {
  it("rejects unknown startup options before touching resident services", () => {
    const result = spawnSync("bun", [fileURLToPath(new URL("./testenv-cli.ts", import.meta.url)), "up", "--codearts-servre-url", "http://127.0.0.1:4097/"], {
      encoding: "utf8",
      timeout: 5_000,
      windowsHide: true,
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Unknown testenv option: --codearts-servre-url");
  });

  it("requires the external CodeArts server and session as one startup contract", () => {
    const result = spawnSync("bun", [fileURLToPath(new URL("./testenv-cli.ts", import.meta.url)), "up"], {
      encoding: "utf8",
      timeout: 5_000,
      windowsHide: true,
      env: {
        ...process.env,
        GAMEFORGE_CODEARTS_SERVER_URL: "http://127.0.0.1:4097/",
        GAMEFORGE_CODEARTS_SESSION: "",
      },
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("requires the external CodeArts server and session together");
  });

  it("verifies the requested CodeArts session before starting resident services", async () => {
    const requests: string[] = [];
    const server = createServer((request, response) => {
      requests.push(request.url ?? "");
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ id: "ses_shared" }));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("No CodeArts fixture port assigned.");
    try {
      await promisify(execFile)("bun", [fileURLToPath(new URL("./testenv-cli.ts", import.meta.url)), "up"], {
        encoding: "utf8",
        timeout: 5_000,
        windowsHide: true,
        env: {
          ...process.env,
          GAMEFORGE_CODEARTS_SERVER_URL: `http://127.0.0.1:${address.port}/`,
          GAMEFORGE_CODEARTS_SESSION: "ses_shared",
        },
      }).catch(() => undefined);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }

    expect(requests).toEqual(["/session/ses_shared"]);
  });

  it("includes the configured external CodeArts session in status probes", async () => {
    const requests: string[] = [];
    const server = createServer((request, response) => {
      requests.push(request.url ?? "");
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ id: "ses_status" }));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("No CodeArts fixture port assigned.");
    try {
      await promisify(execFile)("bun", [fileURLToPath(new URL("./testenv-cli.ts", import.meta.url)), "status"], {
        encoding: "utf8",
        timeout: 5_000,
        windowsHide: true,
        env: {
          ...process.env,
          GAMEFORGE_CODEARTS_SERVER_URL: `http://127.0.0.1:${address.port}/`,
          GAMEFORGE_CODEARTS_SESSION: "ses_status",
        },
      }).catch(() => undefined);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }

    expect(requests).toContain("/session/ses_status");
  });
});
