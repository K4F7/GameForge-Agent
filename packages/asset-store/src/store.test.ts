import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { GameProjectGenerator } from "@gameforge/generator";
import { afterEach, describe, expect, it } from "vitest";
import { ProjectAssetStore } from "./store.js";

const roots: string[] = [];
const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0xff, 0xd9]);
const mp3 = new Uint8Array([0x49, 0x44, 0x33, 0x04]);
const spec = {
  title: "Safety Sprint",
  genre: "arcade" as const,
  objective: "Collect all safety equipment before the timer expires.",
  controls: ["Arrow keys"],
  winCondition: "Collect all equipment.",
  loseCondition: "The timer reaches zero.",
  targetDurationSeconds: 90,
};

async function fixture(): Promise<{ root: string; store: ProjectAssetStore }> {
  const temporary = await mkdtemp(path.join(tmpdir(), "gameforge-assets-test-"));
  roots.push(temporary);
  const root = path.join(temporary, "projects");
  await new GameProjectGenerator({ outputRoot: root }).execute({
    projectId: "safety-sprint",
    spec,
    mode: "apply",
  });
  return { root, store: new ProjectAssetStore({ projectsRoot: root }) };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("ProjectAssetStore", () => {
  it("stores verified media and atomically advances the runtime manifest", async () => {
    const { root, store } = await fixture();
    const hash = createHash("sha256").update(jpeg).digest("hex");
    const result = await store.store({
      projectId: "safety-sprint",
      bytes: jpeg,
      mimeType: "image/jpeg",
      role: "player",
      provenance: {
        assetId: "images/hero.jpg",
        kind: "image",
        origin: "generated",
        provider: "volcengine-ark",
        model: "seedream",
        prompt: "Hero",
        license: "provider-terms",
        sha256: hash,
      },
    });

    expect(result).toMatchObject({ manifestRevision: 1, entry: { role: "player", path: "assets/images/hero.jpg" } });
    expect(await readFile(path.join(root, "safety-sprint", "public", "assets", "images", "hero.jpg"))).toEqual(Buffer.from(jpeg));
    const manifest = JSON.parse(await readFile(
      path.join(root, "safety-sprint", "public", "assets", "manifest.json"),
      "utf8",
    )) as { revision: number; assets: unknown[] };
    expect(manifest).toMatchObject({ revision: 1 });
    expect(manifest.assets).toHaveLength(1);
  });

  it("reads an authoritative manifest for event recovery and rejects inconsistent files", async () => {
    const { root, store } = await fixture();
    const hash = createHash("sha256").update(jpeg).digest("hex");
    await store.store({
      projectId: "safety-sprint",
      bytes: jpeg,
      mimeType: "image/jpeg",
      role: "player",
      provenance: {
        assetId: "images/hero.jpg",
        kind: "image",
        origin: "generated",
        provider: "volcengine-ark",
        model: "seedream",
        prompt: "Hero",
        license: "provider-terms",
        sha256: hash,
      },
    });
    await expect(store.read("safety-sprint")).resolves.toMatchObject({
      projectId: "safety-sprint",
      revision: 1,
      assets: [{ assetId: "images/hero.jpg", role: "player" }],
    });
    await writeFile(path.join(root, "safety-sprint", "public", "assets", "images", "hero.jpg"), new Uint8Array([1]));
    await expect(store.read("safety-sprint")).rejects.toThrow("missing or inconsistent");
  });

  it("rejects same-size asset tampering during event recovery", async () => {
    const { root, store } = await fixture();
    const hash = createHash("sha256").update(jpeg).digest("hex");
    await store.store({
      projectId: "safety-sprint",
      bytes: jpeg,
      mimeType: "image/jpeg",
      role: "player",
      provenance: {
        assetId: "images/hero.jpg",
        kind: "image",
        origin: "generated",
        provider: "volcengine-ark",
        model: "seedream",
        prompt: "Hero",
        license: "provider-terms",
        sha256: hash,
      },
    });
    const tampered = new Uint8Array(jpeg);
    tampered[tampered.length - 1] = 0xda;
    await writeFile(path.join(root, "safety-sprint", "public", "assets", "images", "hero.jpg"), tampered);

    await expect(store.read("safety-sprint")).rejects.toThrow("hash is inconsistent");
  });

  it("rejects hash mismatches, media spoofing, and duplicate assets", async () => {
    const { store } = await fixture();
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
    await expect(store.store({
      projectId: "safety-sprint", bytes: jpeg, mimeType: "image/jpeg", provenance,
    })).rejects.toThrow("SHA-256");
    await expect(store.store({
      projectId: "safety-sprint",
      bytes: new Uint8Array([1, 2, 3, 4]),
      mimeType: "image/jpeg",
      provenance: { ...provenance, sha256: createHash("sha256").update(new Uint8Array([1, 2, 3, 4])).digest("hex") },
    })).rejects.toThrow("media type");
  });

  it("rejects unknown projects and incompatible runtime roles", async () => {
    const { store } = await fixture();
    const hash = createHash("sha256").update(jpeg).digest("hex");
    const provenance = {
      assetId: "images/hero.jpg",
      kind: "image" as const,
      origin: "generated" as const,
      provider: "volcengine-ark",
      model: "seedream",
      prompt: "Hero",
      license: "provider-terms",
      sha256: hash,
    };
    await expect(store.store({
      projectId: "missing", bytes: jpeg, mimeType: "image/jpeg", provenance,
    })).rejects.toThrow("existing generated project");
    await expect(store.store({
      projectId: "safety-sprint", bytes: jpeg, mimeType: "image/jpeg", role: "hit-sound", provenance,
    })).rejects.toThrow("role");
  });

  it("stores voice provenance in the voice role and rejects sound-effect substitution", async () => {
    const { store } = await fixture();
    const hash = createHash("sha256").update(mp3).digest("hex");
    const voice = {
      assetId: "voices/guide.mp3",
      kind: "voice" as const,
      origin: "generated" as const,
      provider: "volcengine-speech",
      model: "voice-test",
      prompt: "Guide line",
      license: "provider-terms",
      sha256: hash,
    };
    await expect(store.store({
      projectId: "safety-sprint",
      bytes: mp3,
      mimeType: "audio/mpeg",
      role: "voice",
      provenance: voice,
    })).resolves.toMatchObject({ entry: { kind: "voice", role: "voice" } });

    const { store: secondStore } = await fixture();
    await expect(secondStore.store({
      projectId: "safety-sprint",
      bytes: mp3,
      mimeType: "audio/mpeg",
      role: "voice",
      provenance: { ...voice, assetId: "sounds/impact.mp3", kind: "sound" },
    })).rejects.toThrow("Voice role");
  });
});
