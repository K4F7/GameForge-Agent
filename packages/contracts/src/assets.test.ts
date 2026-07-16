import { describe, expect, it } from "vitest";
import {
  assetManifestSchema,
  assetProvenanceSchema,
  validateAssetManifest,
} from "./assets.js";

const sha256 = "a".repeat(64);

const generatedImage = {
  assetId: "images/hero-portrait.png",
  kind: "image",
  origin: "generated",
  provider: "volcengine-ark",
  model: "doubao-seedream-4-0-250828",
  prompt: "A brave pixel-art mechanic, front-facing portrait.",
  license: "volcengine-generated-content-terms",
  sha256,
} as const;

describe("assetProvenanceSchema", () => {
  it("accepts generated assets with model and prompt provenance", () => {
    expect(assetProvenanceSchema.parse(generatedImage)).toEqual(generatedImage);
  });

  it("accepts retrieved sound effects with an HTTPS source", () => {
    const result = assetProvenanceSchema.parse({
      assetId: "sounds/jump.wav",
      kind: "sound",
      origin: "retrieved",
      provider: "freesound",
      sourceUrl: "https://freesound.org/people/example/sounds/123/",
      license: "CC0-1.0",
      sha256: "b".repeat(64),
    });

    expect(result.origin).toBe("retrieved");
  });

  it("rejects generated assets without a model and prompt", () => {
    const result = assetProvenanceSchema.safeParse({
      assetId: "images/hero.png",
      kind: "image",
      origin: "generated",
      provider: "volcengine-ark",
      license: "provider-terms",
      sha256,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((issue) => issue.path.join("."))).toEqual(
        expect.arrayContaining(["model", "prompt"]),
      );
    }
  });

  it("rejects insecure retrieval URLs and malformed hashes", () => {
    const result = assetProvenanceSchema.safeParse({
      assetId: "sounds/hit.wav",
      kind: "sound",
      origin: "retrieved",
      provider: "freesound",
      sourceUrl: "http://example.com/hit.wav",
      license: "CC0-1.0",
      sha256: "ABC123",
    });

    expect(result.success).toBe(false);
  });

  it("rejects undeclared metadata", () => {
    expect(
      assetProvenanceSchema.safeParse({
        ...generatedImage,
        apiKey: "not-allowed",
      }).success,
    ).toBe(false);
  });

  it.each(["sounds//jump.wav", "sounds/./jump.wav", "sounds/jump.wav/"])(
    "rejects non-normalized logical path %s",
    (assetId) => {
      expect(
        assetProvenanceSchema.safeParse({
          ...generatedImage,
          assetId,
        }).success,
      ).toBe(false);
    },
  );
});

describe("assetManifestSchema", () => {
  it("accepts a manifest with unique asset IDs", () => {
    const result = validateAssetManifest({
      schemaVersion: "1.0",
      projectId: "safety-sprint",
      generatedAt: "2026-07-16T05:30:00+08:00",
      assets: [generatedImage],
    });

    expect(result.assets).toHaveLength(1);
  });

  it("allows an empty manifest before asset generation starts", () => {
    expect(
      validateAssetManifest({
        schemaVersion: "1.0",
        projectId: "new-game",
        generatedAt: "2026-07-16T05:30:00+08:00",
        assets: [],
      }).assets,
    ).toEqual([]);
  });

  it("rejects duplicate asset IDs", () => {
    const result = assetManifestSchema.safeParse({
      schemaVersion: "1.0",
      projectId: "safety-sprint",
      generatedAt: "2026-07-16T05:30:00+08:00",
      assets: [generatedImage, generatedImage],
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(["assets", 1, "assetId"]);
    }
  });
});
