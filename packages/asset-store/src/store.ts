import {
  assetProvenanceSchema,
  projectIdSchema,
  runtimeAssetManifestSchema,
  runtimeAssetMimeTypeSchema,
  runtimeAssetRoleSchema,
  type AssetProvenance,
  type RuntimeAssetEntry,
  type RuntimeAssetManifest,
  type RuntimeAssetMimeType,
  type RuntimeAssetRole,
} from "@gameforge/contracts";
import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, open, readFile, realpath, rename, rm, unlink, type FileHandle } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

const managedProjectSchema = z.object({ projectId: projectIdSchema });
const IMAGE_MAX_BYTES = 32 * 1024 * 1024;
const AUDIO_MAX_BYTES = 64 * 1024 * 1024;

export type StoreAssetRequest = {
  projectId: string;
  bytes: Uint8Array;
  mimeType: RuntimeAssetMimeType;
  provenance: AssetProvenance;
  role?: RuntimeAssetRole;
};

export type StoreAssetResult = {
  entry: RuntimeAssetEntry;
  manifestRevision: number;
};

export class ProjectAssetStore {
  readonly #projectsRoot: string;

  constructor(options: { projectsRoot: string }) {
    if (!path.isAbsolute(options.projectsRoot)) throw new Error("Asset projects root must be absolute.");
    const normalized = path.resolve(options.projectsRoot);
    if (path.parse(normalized).root === normalized) throw new Error("Asset projects root cannot be a filesystem root.");
    this.#projectsRoot = normalized;
  }

  async read(projectIdInput: string): Promise<RuntimeAssetManifest> {
    const projectId = projectIdSchema.parse(projectIdInput);
    const project = await verifiedManagedProject(this.#projectsRoot, projectId);
    const publicDirectory = await verifiedDirectory(safeChild(project, "public"), "Project public directory");
    const assetsDirectory = await verifiedDirectory(safeChild(publicDirectory, "assets"), "Project assets directory");
    const manifest = runtimeAssetManifestSchema.parse(
      JSON.parse(await readFile(safeChild(assetsDirectory, "manifest.json"), "utf8")) as unknown,
    );
    if (manifest.projectId !== projectId) throw new Error("Runtime asset manifest project ID does not match.");
    for (const entry of manifest.assets) {
      const target = safeChild(publicDirectory, entry.path);
      const actualHash = await verifiedAssetHash(target, publicDirectory, entry.bytes, entry.assetId);
      if (actualHash !== entry.sha256 || actualHash !== entry.provenance.sha256) {
        throw new Error(`Runtime asset file hash is inconsistent: ${entry.assetId}`);
      }
    }
    return manifest;
  }

  async store(request: StoreAssetRequest): Promise<StoreAssetResult> {
    const projectId = projectIdSchema.parse(request.projectId);
    const provenance = assetProvenanceSchema.parse(request.provenance);
    const mimeType = runtimeAssetMimeTypeSchema.parse(request.mimeType);
    const role = request.role === undefined ? undefined : runtimeAssetRoleSchema.parse(request.role);
    const bytes = new Uint8Array(request.bytes);
    validateMedia(bytes, mimeType, provenance.kind, role);
    const actualHash = sha256(bytes);
    if (actualHash !== provenance.sha256) throw new Error("Asset bytes do not match the provenance SHA-256.");

    const realProject = await verifiedManagedProject(this.#projectsRoot, projectId);

    const metadataDirectory = await verifiedDirectory(safeChild(realProject, ".gameforge"), "Project metadata directory");
    const lockPath = safeChild(metadataDirectory, "assets.lock");
    let lock;
    try {
      lock = await open(lockPath, "wx");
    } catch (error) {
      if (isNodeError(error, "EEXIST")) throw new Error("Asset manifest is locked by another writer.");
      throw error;
    }

    try {
      const publicDirectory = await verifiedDirectory(safeChild(realProject, "public"), "Project public directory");
      const assetsDirectory = await verifiedDirectory(safeChild(publicDirectory, "assets"), "Project assets directory");
      const manifestPath = safeChild(assetsDirectory, "manifest.json");
      const manifest = runtimeAssetManifestSchema.parse(
        JSON.parse(await readFile(manifestPath, "utf8")) as unknown,
      );
      if (manifest.projectId !== projectId) throw new Error("Runtime asset manifest project ID does not match.");
      if (manifest.assets.some((asset) => asset.assetId === provenance.assetId)) {
        throw new Error(`Runtime asset already exists: ${provenance.assetId}`);
      }
      if (role !== undefined && manifest.assets.some((asset) => asset.role === role)) {
        throw new Error(`Runtime asset role already exists: ${role}`);
      }

      const relativePath = assetPublicPath(provenance.assetId, mimeType);
      const destination = await safeAssetDestination(assetsDirectory, relativePath.slice("assets/".length));
      if (await pathExists(destination)) throw new Error("Runtime asset file already exists.");
      const entry = runtimeAssetManifestSchema.shape.assets.element.parse({
        assetId: provenance.assetId,
        kind: provenance.kind,
        ...(role === undefined ? {} : { role }),
        path: relativePath,
        mimeType,
        bytes: bytes.byteLength,
        sha256: actualHash,
        provenance,
      });
      const nextManifest = runtimeAssetManifestSchema.parse({
        ...manifest,
        revision: manifest.revision + 1,
        assets: [...manifest.assets, entry],
      });

      const assetTemporary = `${destination}.${randomUUID()}.tmp`;
      const manifestTemporary = safeChild(assetsDirectory, `.manifest.${randomUUID()}.tmp`);
      let assetCommitted = false;
      try {
        await writeSynced(assetTemporary, bytes);
        await writeSynced(manifestTemporary, Buffer.from(`${JSON.stringify(nextManifest, null, 2)}\n`, "utf8"));
        await rename(assetTemporary, destination);
        assetCommitted = true;
        await rename(manifestTemporary, manifestPath);
      } catch (error) {
        await rm(assetTemporary, { force: true });
        await rm(manifestTemporary, { force: true });
        if (assetCommitted) await unlink(destination).catch(() => undefined);
        throw error;
      }

      return { entry, manifestRevision: nextManifest.revision };
    } finally {
      await lock.close();
      await unlink(lockPath).catch(() => undefined);
    }
  }
}

async function verifiedManagedProject(projectsRoot: string, projectId: string): Promise<string> {
  const root = await verifiedDirectory(projectsRoot, "Asset projects root");
  const project = safeChild(root, projectId);
  const projectInfo = await lstat(project).catch(() => undefined);
  if (projectInfo === undefined || !projectInfo.isDirectory() || projectInfo.isSymbolicLink()) {
    throw new Error("Asset target must be an existing generated project directory.");
  }
  const realProject = await realpath(project);
  if (path.dirname(realProject).toLowerCase() !== root.toLowerCase()) {
    throw new Error("Generated project escaped the configured projects root.");
  }
  const managedPath = safeChild(realProject, ".gameforge/manifest.json");
  const managed = managedProjectSchema.parse(JSON.parse(await readFile(managedPath, "utf8")) as unknown);
  if (managed.projectId !== projectId) throw new Error("Generated project manifest ID does not match.");
  return realProject;
}

function validateMedia(
  bytes: Uint8Array,
  mimeType: RuntimeAssetMimeType,
  kind: AssetProvenance["kind"],
  role?: RuntimeAssetRole,
): void {
  if (bytes.byteLength === 0) throw new Error("Asset bytes cannot be empty.");
  const isImage = mimeType.startsWith("image/");
  if (isImage && bytes.byteLength > IMAGE_MAX_BYTES) throw new Error("Image asset exceeds the byte limit.");
  if (!isImage && bytes.byteLength > AUDIO_MAX_BYTES) throw new Error("Audio asset exceeds the byte limit.");
  if (isImage !== (kind === "image")) throw new Error("Asset MIME type does not match its provenance kind.");
  if (role !== undefined) {
    const imageRole = ["player", "collectible", "hazard", "background"].includes(role);
    if (imageRole !== isImage) throw new Error("Runtime role does not match the asset media type.");
    if (role === "voice" && kind !== "voice") throw new Error("Voice role requires voice provenance.");
    if (role === "bgm" && kind !== "music") throw new Error("BGM role requires music provenance.");
    if (["collect-sound", "hit-sound"].includes(role) && kind !== "sound") {
      throw new Error("Sound effect role requires sound provenance.");
    }
  }
  if (!matchesMagic(bytes, mimeType)) throw new Error("Asset bytes do not match the declared media type.");
}

function matchesMagic(bytes: Uint8Array, mimeType: RuntimeAssetMimeType): boolean {
  switch (mimeType) {
    case "image/jpeg": return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    case "image/png": return bytes.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((value, index) => bytes[index] === value);
    case "image/webp": return bytes.length >= 12 && ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WEBP";
    case "audio/ogg": return bytes.length >= 4 && ascii(bytes, 0, 4) === "OggS";
    case "audio/wav": return bytes.length >= 12 && ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WAVE";
    case "audio/mpeg": return bytes.length >= 3 && (ascii(bytes, 0, 3) === "ID3" || (bytes[0] === 0xff && (bytes[1] ?? 0) >= 0xe0));
  }
}

function assetPublicPath(assetId: string, mimeType: RuntimeAssetMimeType): string {
  const extension = extensionFor(mimeType);
  const existing = path.posix.extname(assetId).toLowerCase();
  const allowed = existing === "" || extensionsFor(mimeType).includes(existing);
  if (!allowed) throw new Error("Asset ID extension does not match the media type.");
  return `assets/${existing === "" ? `${assetId}${extension}` : assetId}`;
}

function extensionFor(mimeType: RuntimeAssetMimeType): string {
  return extensionsFor(mimeType)[0] ?? "";
}

function extensionsFor(mimeType: RuntimeAssetMimeType): ReadonlyArray<string> {
  switch (mimeType) {
    case "image/jpeg": return [".jpg", ".jpeg"];
    case "image/png": return [".png"];
    case "image/webp": return [".webp"];
    case "audio/mpeg": return [".mp3"];
    case "audio/ogg": return [".ogg"];
    case "audio/wav": return [".wav"];
  }
}

async function safeAssetDestination(root: string, relative: string): Promise<string> {
  const segments = relative.split("/");
  const fileName = segments.pop();
  if (fileName === undefined) throw new Error("Asset path is invalid.");
  let directory = root;
  for (const segment of segments) {
    directory = safeChild(directory, segment);
    const info = await lstat(directory).catch(() => undefined);
    if (info === undefined) await mkdir(directory);
    else if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("Asset path contains a symbolic link or non-directory.");
  }
  return safeChild(directory, fileName);
}

async function verifiedDirectory(target: string, label: string): Promise<string> {
  const info = await lstat(target).catch(() => undefined);
  if (info === undefined || !info.isDirectory() || info.isSymbolicLink()) {
    throw new Error(`${label} must be an existing real directory.`);
  }
  return realpath(target);
}

async function writeSynced(target: string, bytes: Uint8Array): Promise<void> {
  const handle = await open(target, "wx");
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

function safeChild(root: string, relative: string): string {
  const candidate = path.resolve(root, relative.replaceAll("/", path.sep));
  if (candidate === root || !candidate.startsWith(`${root}${path.sep}`)) throw new Error("Asset path escaped its configured root.");
  return candidate;
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function verifiedAssetHash(
  target: string,
  publicDirectory: string,
  expectedBytes: number,
  assetId: string,
): Promise<string> {
  const handle = await open(target, "r").catch(() => undefined);
  if (handle === undefined) throw new Error(`Runtime asset file is missing or inconsistent: ${assetId}`);
  try {
    const before = await handle.stat({ bigint: true });
    await assertPathMatchesHandle(target, publicDirectory, before.dev, before.ino, expectedBytes, assetId);
    const digest = await sha256Handle(handle);
    const after = await handle.stat({ bigint: true });
    if (
      after.dev !== before.dev || after.ino !== before.ino || after.size !== before.size ||
      after.mtimeNs !== before.mtimeNs || after.ctimeNs !== before.ctimeNs
    ) {
      throw new Error(`Runtime asset file changed while being verified: ${assetId}`);
    }
    await assertPathMatchesHandle(target, publicDirectory, after.dev, after.ino, expectedBytes, assetId);
    return digest;
  } finally {
    await handle.close();
  }
}

async function assertPathMatchesHandle(
  target: string,
  publicDirectory: string,
  device: bigint,
  inode: bigint,
  expectedBytes: number,
  assetId: string,
): Promise<void> {
  const info = await lstat(target, { bigint: true }).catch(() => undefined);
  if (
    info === undefined || !info.isFile() || info.isSymbolicLink() || info.size !== BigInt(expectedBytes) ||
    info.dev !== device || info.ino !== inode
  ) {
    throw new Error(`Runtime asset file is missing or inconsistent: ${assetId}`);
  }
  const realTarget = await realpath(target);
  if (!realTarget.startsWith(`${publicDirectory}${path.sep}`)) {
    throw new Error(`Runtime asset file escaped the project: ${assetId}`);
  }
}

async function sha256Handle(handle: FileHandle): Promise<string> {
  const hash = createHash("sha256");
  const buffer = Buffer.allocUnsafe(64 * 1024);
  while (true) {
    const { bytesRead } = await handle.read(buffer, 0, buffer.byteLength, null);
    if (bytesRead === 0) break;
    hash.update(buffer.subarray(0, bytesRead));
  }
  return hash.digest("hex");
}

function ascii(bytes: Uint8Array, start: number, end: number): string {
  return String.fromCharCode(...bytes.slice(start, end));
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await lstat(target);
    return true;
  } catch (error) {
    if (isNodeError(error, "ENOENT")) return false;
    throw error;
  }
}

function isNodeError(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}
