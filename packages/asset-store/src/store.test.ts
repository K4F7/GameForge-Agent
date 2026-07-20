import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { GameProjectGenerator } from "@gameforge/generator";
import { afterEach, describe, expect, it } from "vitest";
import { ProjectAssetStore, type AssetLockRuntime } from "./store.js";

const roots: string[] = [];
const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0xff, 0xd9]);
const revisedJpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0x00, 0x10, 0xff, 0xd9]);
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
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

async function fixture(lockRuntime?: AssetLockRuntime): Promise<{ root: string; store: ProjectAssetStore }> {
  const temporary = await mkdtemp(path.join(tmpdir(), "gameforge-assets-test-"));
  roots.push(temporary);
  const root = path.join(temporary, "projects");
  await new GameProjectGenerator({ outputRoot: root }).execute({
    projectId: "safety-sprint",
    spec,
    mode: "apply",
  });
  return { root, store: new ProjectAssetStore({ projectsRoot: root, ...(lockRuntime === undefined ? {} : { lockRuntime }) }) };
}

async function layaFixture(target: "douyin-mini-game" | "wechat-mini-game" = "douyin-mini-game"): Promise<{ root: string; store: ProjectAssetStore }> {
  const temporary = await mkdtemp(path.join(tmpdir(), "gameforge-douyin-assets-test-"));
  roots.push(temporary);
  const root = path.join(temporary, "projects");
  await new GameProjectGenerator({ outputRoot: root }).execute({
    projectId: "safety-sprint",
    spec,
    target,
    mode: "apply",
  });
  return { root, store: new ProjectAssetStore({ projectsRoot: root }) };
}

const imageRequest = () => ({
  projectId: "safety-sprint",
  bytes: jpeg,
  mimeType: "image/jpeg" as const,
  role: "player" as const,
  provenance: {
    assetId: "images/hero.jpg",
    kind: "image" as const,
    origin: "generated" as const,
    provider: "volcengine-ark",
    model: "seedream",
    prompt: "Hero",
    license: "provider-terms",
    sha256: createHash("sha256").update(jpeg).digest("hex"),
  },
});

const lockMetadata = (overrides: Partial<{ pid: number; hostname: string; createdAtMs: number; token: string }> = {}) => ({
  version: 1,
  token: overrides.token ?? "00000000-0000-4000-8000-000000000001",
  pid: overrides.pid ?? 424242,
  hostname: overrides.hostname ?? "test-host",
  createdAtMs: overrides.createdAtMs ?? 0,
});

const lockRuntime = (options: { now?: number; alive?: boolean; hostname?: string } = {}): AssetLockRuntime => ({
  now: () => options.now ?? 1_000_000,
  hostname: options.hostname ?? "test-host",
  isProcessAlive: () => options.alive ?? false,
});

async function stageInterruptedReplacement(
  root: string,
  store: ProjectAssetStore,
  manifestState: "old" | "new",
  pathMode: "same" | "different" = "different",
): Promise<{ transactionPath: string; backup: string; oldPath: string; newPath: string }> {
  const first = imageRequest();
  first.provenance.assetId = "images/hero";
  const stored = await store.store(first);
  const project = path.join(root, "safety-sprint");
  const manifestPath = path.join(project, "public", "assets", "manifest.json");
  const oldManifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
    schemaVersion: "1.0"; projectId: string; revision: number; assets: Array<Record<string, unknown>>;
  };
  const oldEntry = stored.entry;
  const newBytes = pathMode === "same" ? revisedJpeg : png;
  const newHash = createHash("sha256").update(newBytes).digest("hex");
  const newEntry = {
    ...oldEntry,
    path: pathMode === "same" ? oldEntry.path : "assets/images/hero.png",
    mimeType: pathMode === "same" ? oldEntry.mimeType : "image/png" as const,
    bytes: newBytes.byteLength,
    sha256: newHash,
    provenance: { ...oldEntry.provenance, model: "seedream-revised", prompt: "Revised hero", sha256: newHash },
  };
  const newManifest = { ...oldManifest, revision: 2, assets: [newEntry] };
  const transactionId = "00000000-0000-4000-8000-000000000099";
  const oldPath = path.join(project, "public", "assets", "images", "hero.jpg");
  const newPath = pathMode === "same" ? oldPath : path.join(project, "public", "assets", "images", "hero.png");
  const backup = `${oldPath}.${transactionId}.bak`;
  const transactionPath = path.join(project, ".gameforge", "assets.transaction.json");
  await rename(oldPath, backup);
  await writeFile(newPath, newBytes);
  if (manifestState === "new") await writeFile(manifestPath, `${JSON.stringify(newManifest, null, 2)}\n`);
  const canonicalHash = (value: unknown) => createHash("sha256").update(`${JSON.stringify(value, null, 2)}\n`).digest("hex");
  await writeFile(transactionPath, `${JSON.stringify({
    version: 1,
    transactionId,
    projectId: "safety-sprint",
    operation: "replace",
    oldRevision: 1,
    newRevision: 2,
    oldManifestSha256: canonicalHash(oldManifest),
    newManifestSha256: canonicalHash(newManifest),
    oldEntry,
    newEntry,
  }, null, 2)}\n`);
  return { transactionPath, backup, oldPath, newPath };
}

async function stageInterruptedCreate(
  root: string,
  manifestState: "old" | "new",
): Promise<{ transactionPath: string; destination: string }> {
  const project = path.join(root, "safety-sprint");
  const assetsDirectory = path.join(project, "public", "assets");
  const manifestPath = path.join(assetsDirectory, "manifest.json");
  const oldManifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
    schemaVersion: "1.0"; projectId: string; revision: number; assets: unknown[];
  };
  const request = imageRequest();
  const hash = createHash("sha256").update(jpeg).digest("hex");
  const newEntry = {
    assetId: request.provenance.assetId,
    kind: "image",
    role: "player",
    path: "assets/images/hero.jpg",
    mimeType: "image/jpeg",
    bytes: jpeg.byteLength,
    sha256: hash,
    provenance: request.provenance,
  };
  const newManifest = { ...oldManifest, revision: 1, assets: [newEntry] };
  const transactionId = "00000000-0000-4000-8000-000000000088";
  const destination = path.join(project, "public", "assets", "images", "hero.jpg");
  const transactionPath = path.join(project, ".gameforge", "assets.transaction.json");
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, jpeg);
  if (manifestState === "new") await writeFile(manifestPath, `${JSON.stringify(newManifest, null, 2)}\n`);
  const canonicalHash = (value: unknown) => createHash("sha256").update(`${JSON.stringify(value, null, 2)}\n`).digest("hex");
  await writeFile(transactionPath, `${JSON.stringify({
    version: 1,
    transactionId,
    projectId: "safety-sprint",
    operation: "create",
    oldRevision: 0,
    newRevision: 1,
    oldManifestSha256: canonicalHash(oldManifest),
    newManifestSha256: canonicalHash(newManifest),
    newEntry,
  }, null, 2)}\n`);
  return { transactionPath, destination };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("ProjectAssetStore", () => {
  it("stores generated MiniMax music as the unique Laya BGM asset", async () => {
    const { root, store } = await layaFixture();
    const hash = createHash("sha256").update(mp3).digest("hex");
    const stored = await store.store({
      projectId: "safety-sprint",
      bytes: mp3,
      mimeType: "audio/mpeg",
      role: "bgm",
      provenance: {
        assetId: "music/main-theme",
        kind: "music",
        origin: "generated",
        provider: "minimax",
        model: "music-2.6",
        prompt: "Instrumental casual game loop",
        license: "account-confirmed-output-terms",
        sha256: hash,
      },
    });
    expect(stored).toMatchObject({
      manifestRevision: 1,
      entry: { kind: "music", role: "bgm", path: "assets/music/main-theme.mp3", mimeType: "audio/mpeg" },
    });
    expect(await readFile(path.join(root, "safety-sprint", "assets", "resources", "assets", "music", "main-theme.mp3")))
      .toEqual(Buffer.from(mp3));
    await expect(store.read("safety-sprint")).resolves.toMatchObject({
      revision: 1,
      assets: [{ role: "bgm", provenance: { provider: "minimax", model: "music-2.6" } }],
    });
  });

  it("stores the same logical asset paths in the Laya resources tree for Douyin projects", async () => {
    const { root, store } = await layaFixture();
    await expect(store.store(imageRequest())).resolves.toMatchObject({
      manifestRevision: 1,
      entry: { path: "assets/images/hero.jpg", role: "player" },
    });
    const physical = path.join(root, "safety-sprint", "assets", "resources", "assets");
    expect(await readFile(path.join(physical, "images", "hero.jpg"))).toEqual(Buffer.from(jpeg));
    const replacementHash = createHash("sha256").update(revisedJpeg).digest("hex");
    await expect(store.store({
      ...imageRequest(),
      bytes: revisedJpeg,
      mode: "replace",
      expectedRevision: 1,
      provenance: { ...imageRequest().provenance, sha256: replacementHash, model: "seedream-revised" },
    })).resolves.toMatchObject({ manifestRevision: 2 });
    expect(await readFile(path.join(physical, "images", "hero.jpg"))).toEqual(Buffer.from(revisedJpeg));
    await expect(store.read("safety-sprint")).resolves.toMatchObject({
      revision: 2,
      assets: [{ path: "assets/images/hero.jpg", role: "player" }],
    });
    expect(JSON.parse(await readFile(path.join(physical, "manifest.json"), "utf8"))).toMatchObject({
      projectId: "safety-sprint",
      revision: 2,
    });
    await expect(readFile(path.join(root, "safety-sprint", "public", "assets", "manifest.json")))
      .rejects.toMatchObject({ code: "ENOENT" });
  });

  it("uses the explicit Laya resources layout for WeChat projects", async () => {
    const { root, store } = await layaFixture("wechat-mini-game");
    await expect(store.store(imageRequest())).resolves.toMatchObject({
      entry: { path: "assets/images/hero.jpg", role: "player" },
    });
    expect(await readFile(path.join(
      root, "safety-sprint", "assets", "resources", "assets", "images", "hero.jpg",
    ))).toEqual(Buffer.from(jpeg));
  });

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

  it("replaces an existing asset with revision CAS and removes the old path", async () => {
    const { root, store } = await fixture();
    const first = imageRequest();
    first.provenance.assetId = "images/hero";
    await expect(store.store(first)).resolves.toMatchObject({ manifestRevision: 1 });

    const replacement = {
      ...first,
      bytes: png,
      mimeType: "image/png" as const,
      mode: "replace" as const,
      expectedRevision: 1,
      provenance: {
        ...first.provenance,
        model: "seedream-revised",
        prompt: "Revised hero",
        sha256: createHash("sha256").update(png).digest("hex"),
      },
    };
    await expect(store.store(replacement)).resolves.toMatchObject({
      manifestRevision: 2,
      entry: { assetId: "images/hero", role: "player", path: "assets/images/hero.png" },
    });
    await expect(readFile(path.join(root, "safety-sprint", "public", "assets", "images", "hero.jpg")))
      .rejects.toMatchObject({ code: "ENOENT" });
    expect(await readFile(path.join(root, "safety-sprint", "public", "assets", "images", "hero.png")))
      .toEqual(Buffer.from(png));
    await expect(store.read("safety-sprint")).resolves.toMatchObject({
      revision: 2,
      assets: [{ assetId: "images/hero", role: "player", mimeType: "image/png" }],
    });
  });

  it("rejects stale or missing replacement revisions without changing the asset", async () => {
    const { root, store } = await fixture();
    await store.store(imageRequest());
    const replacement = {
      ...imageRequest(),
      bytes: png,
      mimeType: "image/png" as const,
      mode: "replace" as const,
      provenance: {
        ...imageRequest().provenance,
        assetId: "images/hero.jpg",
        sha256: createHash("sha256").update(png).digest("hex"),
      },
    };
    await expect(store.store(replacement)).rejects.toThrow("expectedRevision");
    await expect(store.store({ ...replacement, expectedRevision: 0 })).rejects.toThrow("revision conflict");
    expect(await readFile(path.join(root, "safety-sprint", "public", "assets", "images", "hero.jpg")))
      .toEqual(Buffer.from(jpeg));
    await expect(store.read("safety-sprint")).resolves.toMatchObject({ revision: 1 });
  });

  it("never overwrites a destination file that already exists outside the manifest", async () => {
    const { root, store } = await fixture();
    const destination = path.join(root, "safety-sprint", "public", "assets", "images", "hero.jpg");
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, new Uint8Array([1, 2, 3, 4]));
    await expect(store.store(imageRequest())).rejects.toThrow("already exists");
    expect(await readFile(destination)).toEqual(Buffer.from([1, 2, 3, 4]));
    await expect(store.read("safety-sprint")).resolves.toMatchObject({ revision: 0, assets: [] });
  });

  it("rolls back an interrupted replacement when the old manifest is authoritative", async () => {
    const { root, store } = await fixture();
    const staged = await stageInterruptedReplacement(root, store, "old");
    await expect(store.recover("safety-sprint")).resolves.toMatchObject({ revision: 1 });
    expect(await readFile(staged.oldPath)).toEqual(Buffer.from(jpeg));
    await expect(readFile(staged.newPath)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(staged.backup)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(staged.transactionPath)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(store.read("safety-sprint")).resolves.toMatchObject({
      revision: 1,
      assets: [{ assetId: "images/hero", mimeType: "image/jpeg" }],
    });
  });

  it("finalizes an interrupted replacement when the new manifest is authoritative", async () => {
    const { root, store } = await fixture();
    const staged = await stageInterruptedReplacement(root, store, "new");
    const other = imageRequest();
    other.provenance.assetId = "images/other.jpg";
    delete (other as { role?: unknown }).role;
    await expect(store.store(other)).resolves.toMatchObject({ manifestRevision: 3 });
    await expect(readFile(staged.oldPath)).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readFile(staged.newPath)).toEqual(Buffer.from(png));
    await expect(readFile(staged.backup)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(staged.transactionPath)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(store.read("safety-sprint")).resolves.toMatchObject({
      revision: 3,
      assets: [{ assetId: "images/hero", mimeType: "image/png" }, { assetId: "images/other.jpg" }],
    });
  });

  it("refuses an unknown transaction log without modifying project files", async () => {
    const { root, store } = await fixture();
    await store.store(imageRequest());
    const transactionPath = path.join(root, "safety-sprint", ".gameforge", "assets.transaction.json");
    await writeFile(transactionPath, JSON.stringify({ version: 999, projectId: "safety-sprint" }));
    const other = imageRequest();
    other.provenance.assetId = "images/other.jpg";
    delete (other as { role?: unknown }).role;
    await expect(store.store(other)).rejects.toThrow();
    expect(await readFile(transactionPath, "utf8")).toContain("999");
    await expect(store.read("safety-sprint")).resolves.toMatchObject({ revision: 1 });
  });

  it("rolls back an interrupted same-path replacement without deleting the old asset", async () => {
    const { root, store } = await fixture();
    const staged = await stageInterruptedReplacement(root, store, "old", "same");
    const other = imageRequest();
    other.provenance.assetId = "images/other.jpg";
    delete (other as { role?: unknown }).role;
    await expect(store.store(other)).resolves.toMatchObject({ manifestRevision: 2 });
    expect(await readFile(staged.oldPath)).toEqual(Buffer.from(jpeg));
    await expect(readFile(staged.backup)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(staged.transactionPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("removes an interrupted create orphan when the old manifest is authoritative", async () => {
    const { root, store } = await fixture();
    const staged = await stageInterruptedCreate(root, "old");
    await expect(store.recover("safety-sprint")).resolves.toMatchObject({ revision: 0, assets: [] });
    await expect(readFile(staged.destination)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(staged.transactionPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("finalizes an interrupted create when the new manifest is authoritative", async () => {
    const { root, store } = await fixture();
    const staged = await stageInterruptedCreate(root, "new");
    await expect(store.recover("safety-sprint")).resolves.toMatchObject({
      revision: 1,
      assets: [{ assetId: "images/hero.jpg", role: "player" }],
    });
    expect(await readFile(staged.destination)).toEqual(Buffer.from(jpeg));
    await expect(readFile(staged.transactionPath)).rejects.toMatchObject({ code: "ENOENT" });
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

  it("recovers an old same-host lock only when its owner process is dead", async () => {
    const { root, store } = await fixture(lockRuntime());
    const metadata = path.join(root, "safety-sprint", ".gameforge");
    await writeFile(path.join(metadata, "assets.lock"), `${JSON.stringify(lockMetadata())}\n`, "utf8");

    await expect(store.store(imageRequest())).resolves.toMatchObject({ manifestRevision: 1 });
    await expect(readFile(path.join(metadata, "assets.lock"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("refuses active, recent, foreign-host, and legacy asset locks", async () => {
    const cases = [
      { runtime: lockRuntime({ alive: true }), metadata: lockMetadata(), message: "active writer" },
      { runtime: lockRuntime(), metadata: lockMetadata({ createdAtMs: 999_000 }), message: "too recent" },
      { runtime: lockRuntime(), metadata: lockMetadata({ hostname: "other-host" }), message: "another host" },
    ];
    for (const item of cases) {
      const { root, store } = await fixture(item.runtime);
      const lockPath = path.join(root, "safety-sprint", ".gameforge", "assets.lock");
      await writeFile(lockPath, `${JSON.stringify(item.metadata)}\n`, "utf8");
      await expect(store.store(imageRequest())).rejects.toThrow(item.message);
      await expect(readFile(lockPath, "utf8")).resolves.toContain(item.metadata.token);
    }

    const { root, store } = await fixture(lockRuntime());
    const legacy = path.join(root, "safety-sprint", ".gameforge", "assets.lock");
    await writeFile(legacy, "", "utf8");
    await expect(store.store(imageRequest())).rejects.toThrow("unknown or legacy");
    await expect(readFile(legacy)).resolves.toHaveLength(0);
  });

  it("recovers stale recovery guard and main lock metadata", async () => {
    const { root, store } = await fixture(lockRuntime({ alive: false }));
    const metadata = path.join(root, "safety-sprint", ".gameforge");
    await writeFile(path.join(metadata, "assets.lock"), `${JSON.stringify(lockMetadata())}\n`, "utf8");
    await writeFile(path.join(metadata, "assets.lock.recovery"), `${JSON.stringify(lockMetadata({
      token: "00000000-0000-4000-8000-000000000002",
    }))}\n`, "utf8");

    await expect(store.store(imageRequest())).resolves.toMatchObject({ manifestRevision: 1 });
    await expect(readFile(path.join(metadata, "assets.lock.recovery"))).rejects.toMatchObject({ code: "ENOENT" });
  });
});
