import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  OPENCHAMBER_PINNED_COMMIT,
  OPENCHAMBER_UPSTREAM_URL,
  resolveOpenChamberIntegrationOptions,
  safeLoopbackBaseUrl,
} from "./config.js";

const repoRoot = path.resolve("D:/workspace/GameForge-Agent");

describe("OpenChamber integration configuration", () => {
  it("pins the official upstream and isolates checkout and runtime state", () => {
    expect(OPENCHAMBER_UPSTREAM_URL).toBe("https://github.com/openchamber/openchamber.git");
    expect(OPENCHAMBER_PINNED_COMMIT).toMatch(/^[a-f0-9]{40}$/);
    expect(resolveOpenChamberIntegrationOptions([], {}, repoRoot)).toEqual({
      checkoutRoot: path.join(repoRoot, ".third-party", "openchamber"),
      dataDirectory: path.join(repoRoot, ".gameforge-validation", "integrations", "openchamber", "data"),
      codeArtsUrl: "http://127.0.0.1:4096/",
      baseUrl: "http://127.0.0.1:3000/",
      hostname: "127.0.0.1",
      port: 3000,
      dryRun: false,
    });
  });

  it("accepts explicit absolute roots and a loopback CodeArts endpoint", () => {
    expect(resolveOpenChamberIntegrationOptions([
      "--root", path.resolve("D:/vendor/openchamber"),
      "--data-dir", path.resolve("D:/state/openchamber"),
      "--codearts-url", "http://localhost:4317",
      "--port", "3080",
      "--dry-run",
    ], {}, repoRoot)).toMatchObject({
      codeArtsUrl: "http://localhost:4317/",
      baseUrl: "http://127.0.0.1:3080/",
      port: 3080,
      dryRun: true,
    });
  });

  it("rejects remote listeners and ambiguous paths", () => {
    expect(() => safeLoopbackBaseUrl("http://192.168.1.2:4096", "CodeArts")).toThrow("loopback HTTP");
    expect(() => safeLoopbackBaseUrl("http://127.0.0.1:4096/api", "CodeArts")).toThrow("must not contain");
    expect(() => resolveOpenChamberIntegrationOptions(["--port", "0"], {}, repoRoot)).toThrow("between 1 and 65535");
    expect(() => resolveOpenChamberIntegrationOptions([], { GAMEFORGE_OPENCHAMBER_ROOT: "relative" }, repoRoot)).toThrow("must be absolute");
  });
});
