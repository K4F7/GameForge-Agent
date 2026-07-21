import { describe, expect, it } from "vitest";
import {
  resolveCodeArtsServerOptions,
  safeCodeArtsServerUrl,
  withoutExternalProviderEnvironment,
} from "./server-config.js";

describe("CodeArts server configuration", () => {
  it("defaults to a fixed loopback endpoint for the Workbench", () => {
    expect(resolveCodeArtsServerOptions([], {})).toEqual({
      baseUrl: "http://127.0.0.1:4096/",
      corsOrigins: ["http://127.0.0.1:4173", "http://localhost:4173"],
      dryRun: false,
      hostname: "127.0.0.1",
      port: 4096,
    });
  });

  it("accepts explicit fork origins and deduplicates them", () => {
    expect(resolveCodeArtsServerOptions([
      "--port", "4317",
      "--cors", "http://localhost:3000",
      "--cors", "http://localhost:3000/",
      "--dry-run",
    ], {})).toMatchObject({
      baseUrl: "http://127.0.0.1:4317/",
      corsOrigins: ["http://localhost:3000"],
      dryRun: true,
      port: 4317,
    });
  });

  it("rejects unsafe listeners, origins, and ports", () => {
    expect(() => resolveCodeArtsServerOptions(["--port", "0"], {})).toThrow("between 1 and 65535");
    expect(() => resolveCodeArtsServerOptions(["--cors", "http://studio.example.com"], {}))
      .toThrow("Studio CORS origins");
    expect(() => resolveCodeArtsServerOptions(["--hostname", "0.0.0.0"], {})).toThrow("Unknown");
    expect(() => safeCodeArtsServerUrl("http://192.168.1.2:4096/"))
      .toThrow("loopback HTTP");
  });

  it("does not inherit external Provider accounts into the first GUI server spike", () => {
    expect(withoutExternalProviderEnvironment({
      PATH: "safe",
      VOLCENGINE_ARK_API_KEY: "private",
      GAMEFORGE_IMAGE_LICENSE: "private",
      MINIMAX_API_KEY: "private",
    })).toEqual({ PATH: "safe" });
  });
});
