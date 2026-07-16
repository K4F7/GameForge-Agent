import { describe, expect, it } from "vitest";
import { runtimeAssetManifestSchema } from "./runtime-assets.js";

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
