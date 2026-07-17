import { describe, expect, it } from "vitest";
import { missingProviderEnvironment, parseProviderSelection, publicEvidence } from "./provider-smoke-core.js";

describe("provider smoke core", () => {
  it("parses a bounded provider selection", () => {
    expect(parseProviderSelection("qwen,tts,qwen")).toEqual(["qwen", "tts"]);
    expect(() => parseProviderSelection("unknown")).toThrow("Unsupported provider");
  });

  it("reports names of missing variables without values", () => {
    expect(missingProviderEnvironment("seedream", { VOLCENGINE_ARK_API_KEY: "set" })).toEqual([
      "GAMEFORGE_IMAGE_MODEL",
      "GAMEFORGE_IMAGE_LICENSE",
    ]);
  });

  it("removes credentials, handles, and audio URLs from evidence", () => {
    expect(publicEvidence({ taskId: "ok", jobHandle: "private", previewUrl: "private", sourceUrl: "private", nested: { apiToken: "private", bytes: 2 } }))
      .toEqual({ taskId: "ok", nested: { bytes: 2 } });
  });
});
