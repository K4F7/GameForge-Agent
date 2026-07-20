import { describe, expect, it } from "vitest";
import { imageRuntimeAssetRoleSchema, runtimeAssetManifestSchema } from "./runtime-assets.js";

const provenance = {
  assetId: "images/hero.jpg",
  kind: "image" as const,
  origin: "generated" as const,
  provider: "volcengine-ark",
  model: "seedream",
  prompt: "Hero",
  license: "provider-terms",
  sha256: "a".repeat(64),
};

describe("runtime asset manifest", () => {
  it("keeps image generation roles separate from audio roles", () => {
    expect(imageRuntimeAssetRoleSchema.options).toEqual(["player", "collectible", "hazard", "background"]);
    expect(imageRuntimeAssetRoleSchema.safeParse("voice").success).toBe(false);
    expect(imageRuntimeAssetRoleSchema.safeParse("bgm").success).toBe(false);
  });

  it("validates matching provenance and unique roles", () => {
    expect(runtimeAssetManifestSchema.parse({
      schemaVersion: "1.0",
      projectId: "safety-sprint",
      revision: 1,
      assets: [{
        assetId: "images/hero.jpg",
        kind: "image",
        role: "player",
        path: "assets/images/hero.jpg",
        mimeType: "image/jpeg",
        bytes: 128,
        sha256: "a".repeat(64),
        provenance,
      }],
    }).assets).toHaveLength(1);
  });

  it("rejects mismatched hashes and duplicate runtime roles", () => {
    const entry = {
      assetId: "images/hero.jpg",
      kind: "image",
      role: "player",
      path: "assets/images/hero.jpg",
      mimeType: "image/jpeg",
      bytes: 128,
      sha256: "b".repeat(64),
      provenance,
    };
    expect(runtimeAssetManifestSchema.safeParse({
      schemaVersion: "1.0",
      projectId: "safety-sprint",
      revision: 1,
      assets: [entry, { ...entry, assetId: "images/rival.jpg", path: "assets/images/rival.jpg" }],
    }).success).toBe(false);
  });
});
