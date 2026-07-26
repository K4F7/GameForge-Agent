import { execFile, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { access, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

describe("testenv CLI", () => {
  it("rejects an unsafe Relay URL before a credentialed status probe", () => {
    const result = spawnSync("bun", [fileURLToPath(new URL("./testenv-cli.ts", import.meta.url)), "status"], {
      encoding: "utf8", timeout: 5_000, windowsHide: true,
      env: { ...process.env, GAMEFORGE_RUN_RELAY_URL: "http://example.com:8787/", GAMEFORGE_RUN_RELAY_TOKEN: "must-not-leak" },
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Relay URL must use HTTPS");
  });

  it("rejects a remote HTTPS Relay before forwarding the status token", () => {
    const result = spawnSync("bun", [fileURLToPath(new URL("./testenv-cli.ts", import.meta.url)), "status"], {
      encoding: "utf8", timeout: 5_000, windowsHide: true,
      env: { ...process.env, GAMEFORGE_RUN_RELAY_URL: "https://example.com:8787/", GAMEFORGE_RUN_RELAY_TOKEN: "must-not-leak" },
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Relay URL must be a loopback URL for testenv port management");
  });

  it("rejects an unsafe OpenChamber URL before a status probe", () => {
    const result = spawnSync("bun", [fileURLToPath(new URL("./testenv-cli.ts", import.meta.url)), "status"], {
      encoding: "utf8", timeout: 5_000, windowsHide: true,
      env: { ...process.env, GAMEFORGE_OPENCHAMBER_URL: "https://example.com:43163/" },
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("OpenChamber URL must be credential-free loopback HTTP(S)");
  });

  it("does not leave shutdown intent behind when down validation fails", async () => {
    const marker = path.resolve(import.meta.dirname, "../../..", ".gameforge-validation", "testenv-shutdown-requested");
    await rm(marker, { force: true });
    const result = spawnSync("bun", [fileURLToPath(new URL("./testenv-cli.ts", import.meta.url)), "down"], {
      encoding: "utf8", timeout: 5_000, windowsHide: true,
      env: { ...process.env, GAMEFORGE_OPENCHAMBER_URL: "https://example.com:43163/" },
    });

    expect(result.status).not.toBe(0);
    await expect(access(marker)).rejects.toMatchObject({ code: "ENOENT" });
  });

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
        timeout: 15_000,
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
        timeout: 15_000,
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
  }, 20_000);
});
