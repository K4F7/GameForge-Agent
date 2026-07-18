import {
  assetProvenanceSchema,
  managedGeneratedProjectManifestSchema,
  projectIdSchema,
  runtimeAssetManifestSchema,
  runtimeAssetMimeTypeSchema,
  runtimeAssetRoleSchema,
  type AssetProvenance,
  type RuntimeAssetEntry,
  type RuntimeAssetManifest,
  type RuntimeAssetMimeType,
  type RuntimeAssetRole,
  type GamePlatformTarget,
} from "@gameforge/contracts";
import { createHash, randomUUID } from "node:crypto";
import { link, lstat, mkdir, open, readFile, realpath, rename, rm, unlink, type FileHandle } from "node:fs/promises";
import { hostname as systemHostname } from "node:os";
import path from "node:path";
import { z } from "zod";

const IMAGE_MAX_BYTES = 32 * 1024 * 1024;
const AUDIO_MAX_BYTES = 64 * 1024 * 1024;
const LOCK_STALE_AFTER_MS = 10 * 60 * 1000;
const LOCK_METADATA_MAX_BYTES = 4 * 1024;
const ASSET_TRANSACTION_MAX_BYTES = 32 * 1024;
const assetLockMetadataSchema = z.strictObject({
  version: z.literal(1),
  token: z.string().uuid(),
  pid: z.number().int().positive(),
  hostname: z.string().trim().min(1).max(255),
  createdAtMs: z.number().int().nonnegative(),
});
const assetTransactionBase = {
  version: z.literal(1),
  transactionId: z.string().uuid(),
  projectId: projectIdSchema,
  oldRevision: z.number().int().nonnegative(),
  newRevision: z.number().int().positive(),
  oldManifestSha256: z.string().regex(/^[a-f0-9]{64}$/),
  newManifestSha256: z.string().regex(/^[a-f0-9]{64}$/),
  newEntry: runtimeAssetManifestSchema.shape.assets.element,
};
const assetTransactionSchema = z.discriminatedUnion("operation", [
  z.strictObject({ ...assetTransactionBase, operation: z.literal("create") }),
  z.strictObject({
    ...assetTransactionBase,
    operation: z.literal("replace"),
    oldEntry: runtimeAssetManifestSchema.shape.assets.element,
  }),
]);

type AssetLockMetadata = z.infer<typeof assetLockMetadataSchema>;
type AssetTransaction = z.infer<typeof assetTransactionSchema>;
type ManagedAssetProject = { directory: string; target: GamePlatformTarget };
type RuntimeAssetLayout = { runtimeDirectory: string; assetsDirectory: string };

export type AssetLockRuntime = {
  now(): number;
  hostname: string;
  isProcessAlive(pid: number): boolean;
};

export type StoreAssetRequest = {
  projectId: string;
  bytes: Uint8Array;
  mimeType: RuntimeAssetMimeType;
  provenance: AssetProvenance;
  role?: RuntimeAssetRole;
  mode?: "create" | "replace";
  expectedRevision?: number;
};

export type StoreAssetResult = {
  entry: RuntimeAssetEntry;
  manifestRevision: number;
};

export class ProjectAssetStore {
  readonly #projectsRoot: string;
  readonly #lockRuntime: AssetLockRuntime;

  constructor(options: { projectsRoot: string; lockRuntime?: AssetLockRuntime }) {
    if (!path.isAbsolute(options.projectsRoot)) throw new Error("Asset projects root must be absolute.");
    const normalized = path.resolve(options.projectsRoot);
    if (path.parse(normalized).root === normalized) throw new Error("Asset projects root cannot be a filesystem root.");
    this.#projectsRoot = normalized;
    this.#lockRuntime = options.lockRuntime ?? {
      now: Date.now,
      hostname: systemHostname(),
      isProcessAlive: processIsAlive,
    };
  }

  async read(projectIdInput: string): Promise<RuntimeAssetManifest> {
    const projectId = projectIdSchema.parse(projectIdInput);
    const project = await verifiedManagedProject(this.#projectsRoot, projectId);
    const { runtimeDirectory, assetsDirectory } = await verifiedRuntimeAssetLayout(project);
    const manifest = runtimeAssetManifestSchema.parse(await readVerifiedJson(
      safeChild(assetsDirectory, "manifest.json"),
      assetsDirectory,
      "Runtime asset manifest",
    ));
    if (manifest.projectId !== projectId) throw new Error("Runtime asset manifest project ID does not match.");
    for (const entry of manifest.assets) {
      const target = safeChild(runtimeDirectory, entry.path);
      const actualHash = await verifiedAssetHash(target, runtimeDirectory, entry.bytes, entry.assetId);
      if (actualHash !== entry.sha256 || actualHash !== entry.provenance.sha256) {
        throw new Error(`Runtime asset file hash is inconsistent: ${entry.assetId}`);
      }
    }
    return manifest;
  }

  async recover(projectIdInput: string): Promise<RuntimeAssetManifest> {
    const projectId = projectIdSchema.parse(projectIdInput);
    const project = await verifiedManagedProject(this.#projectsRoot, projectId);
    const metadataDirectory = await verifiedDirectory(safeChild(project.directory, ".gameforge"), "Project metadata directory");
    const lockPath = safeChild(metadataDirectory, "assets.lock");
    const recoveryPath = safeChild(metadataDirectory, "assets.lock.recovery");
    const lock = await acquireAssetLock(lockPath, recoveryPath, this.#lockRuntime);
    try {
      const { runtimeDirectory, assetsDirectory } = await verifiedRuntimeAssetLayout(project);
      await recoverAssetTransaction(
        safeChild(metadataDirectory, "assets.transaction.json"),
        metadataDirectory,
        runtimeDirectory,
        assetsDirectory,
        safeChild(assetsDirectory, "manifest.json"),
        projectId,
      );
    } finally {
      await releaseAssetLock(lockPath, lock);
    }
    return this.read(projectId);
  }

  async store(request: StoreAssetRequest): Promise<StoreAssetResult> {
    const projectId = projectIdSchema.parse(request.projectId);
    const provenance = assetProvenanceSchema.parse(request.provenance);
    const mimeType = runtimeAssetMimeTypeSchema.parse(request.mimeType);
    const role = request.role === undefined ? undefined : runtimeAssetRoleSchema.parse(request.role);
    const mode = request.mode ?? "create";
    if (mode !== "create" && mode !== "replace") throw new Error("Asset store mode must be create or replace.");
    const expectedRevision = request.expectedRevision;
    if (expectedRevision !== undefined && (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0)) {
      throw new Error("Expected asset manifest revision must be a non-negative safe integer.");
    }
    if (mode === "replace" && expectedRevision === undefined) {
      throw new Error("Asset replacement requires expectedRevision.");
    }
    if (mode === "create" && expectedRevision !== undefined) {
      throw new Error("expectedRevision is only valid for asset replacement.");
    }
    const bytes = new Uint8Array(request.bytes);
    validateMedia(bytes, mimeType, provenance.kind, role);
    const actualHash = sha256(bytes);
    if (actualHash !== provenance.sha256) throw new Error("Asset bytes do not match the provenance SHA-256.");

    const realProject = await verifiedManagedProject(this.#projectsRoot, projectId);

    const metadataDirectory = await verifiedDirectory(safeChild(realProject.directory, ".gameforge"), "Project metadata directory");
    const lockPath = safeChild(metadataDirectory, "assets.lock");
    const recoveryPath = safeChild(metadataDirectory, "assets.lock.recovery");
    const lock = await acquireAssetLock(lockPath, recoveryPath, this.#lockRuntime);

    try {
      const { runtimeDirectory, assetsDirectory } = await verifiedRuntimeAssetLayout(realProject);
      const manifestPath = safeChild(assetsDirectory, "manifest.json");
      const transactionPath = safeChild(metadataDirectory, "assets.transaction.json");
      await recoverAssetTransaction(
        transactionPath,
        metadataDirectory,
        runtimeDirectory,
        assetsDirectory,
        manifestPath,
        projectId,
      );
      const manifest = runtimeAssetManifestSchema.parse(
        await readVerifiedJson(manifestPath, assetsDirectory, "Runtime asset manifest"),
      );
      if (manifest.projectId !== projectId) throw new Error("Runtime asset manifest project ID does not match.");
      if (mode === "replace" && manifest.revision !== expectedRevision) {
        throw new Error(`Asset manifest revision conflict: expected ${expectedRevision}, found ${manifest.revision}.`);
      }
      const existingIndex = manifest.assets.findIndex((asset) => asset.assetId === provenance.assetId);
      if (mode === "create" && existingIndex !== -1) {
        throw new Error(`Runtime asset already exists: ${provenance.assetId}`);
      }
      if (mode === "replace" && existingIndex === -1) {
        throw new Error(`Runtime asset does not exist for replacement: ${provenance.assetId}`);
      }
      const existing = existingIndex === -1 ? undefined : manifest.assets[existingIndex];
      const effectiveRole = role ?? existing?.role;
      validateMedia(bytes, mimeType, provenance.kind, effectiveRole);
      if (
        effectiveRole !== undefined &&
        manifest.assets.some((asset, index) => index !== existingIndex && asset.role === effectiveRole)
      ) throw new Error(`Runtime asset role already exists: ${effectiveRole}`);

      const relativePath = assetPublicPath(provenance.assetId, mimeType);
      const destination = await safeAssetDestination(assetsDirectory, relativePath.slice("assets/".length));
      if (mode === "create" && await pathExists(destination)) throw new Error("Runtime asset file already exists.");
      const entry = runtimeAssetManifestSchema.shape.assets.element.parse({
        assetId: provenance.assetId,
        kind: provenance.kind,
        ...(effectiveRole === undefined ? {} : { role: effectiveRole }),
        path: relativePath,
        mimeType,
        bytes: bytes.byteLength,
        sha256: actualHash,
        provenance,
      });
      const nextManifest = runtimeAssetManifestSchema.parse({
        ...manifest,
        revision: manifest.revision + 1,
        assets: mode === "create"
          ? [...manifest.assets, entry]
          : manifest.assets.map((asset, index) => index === existingIndex ? entry : asset),
      });
      if (mode === "create") {
        await commitCreatedAsset(
          destination,
          manifestPath,
          assetsDirectory,
          transactionPath,
          projectId,
          manifest,
          entry,
          bytes,
          nextManifest,
        );
      } else {
        if (existing === undefined) throw new Error("Asset replacement target disappeared.");
        const oldDestination = safeChild(runtimeDirectory, existing.path);
        const oldHash = await verifiedAssetHash(
          oldDestination,
          runtimeDirectory,
          existing.bytes,
          existing.assetId,
        );
        if (oldHash !== existing.sha256 || oldHash !== existing.provenance.sha256) {
          throw new Error(`Runtime asset file hash is inconsistent: ${existing.assetId}`);
        }
        if (oldDestination !== destination && await pathExists(destination)) {
          throw new Error("Replacement asset destination already exists.");
        }
        await commitReplacedAsset(
          oldDestination,
          destination,
          manifestPath,
          assetsDirectory,
          transactionPath,
          projectId,
          manifest,
          entry,
          bytes,
          nextManifest,
        );
      }

      return { entry, manifestRevision: nextManifest.revision };
    } finally {
      await releaseAssetLock(lockPath, lock);
    }
  }
}

async function commitCreatedAsset(
  destination: string,
  manifestPath: string,
  assetsDirectory: string,
  transactionPath: string,
  projectId: string,
  oldManifest: RuntimeAssetManifest,
  newEntry: RuntimeAssetEntry,
  bytes: Uint8Array,
  manifest: RuntimeAssetManifest,
): Promise<void> {
  const transactionId = randomUUID();
  const assetTemporary = `${destination}.${transactionId}.tmp`;
  const manifestTemporary = safeChild(assetsDirectory, `.manifest.${transactionId}.tmp`);
  let assetCommitted = false;
  const transaction = assetTransactionSchema.parse({
    version: 1,
    transactionId,
    projectId,
    operation: "create",
    oldRevision: oldManifest.revision,
    newRevision: manifest.revision,
    oldManifestSha256: sha256(manifestBytes(oldManifest)),
    newManifestSha256: sha256(manifestBytes(manifest)),
    newEntry,
  });
  try {
    await writeSynced(transactionPath, Buffer.from(`${JSON.stringify(transaction, null, 2)}\n`, "utf8"), 0o600);
    await writeSynced(assetTemporary, bytes);
    await writeSynced(manifestTemporary, manifestBytes(manifest));
    await link(assetTemporary, destination);
    assetCommitted = true;
    await unlink(assetTemporary);
    await rename(manifestTemporary, manifestPath);
  } catch (error) {
    const rollbackErrors: unknown[] = [];
    await rm(assetTemporary, { force: true }).catch((cleanupError: unknown) => rollbackErrors.push(cleanupError));
    await rm(manifestTemporary, { force: true }).catch((cleanupError: unknown) => rollbackErrors.push(cleanupError));
    if (assetCommitted) {
      await unlink(destination).catch((cleanupError: unknown) => rollbackErrors.push(cleanupError));
    }
    await rm(transactionPath, { force: true }).catch((cleanupError: unknown) => rollbackErrors.push(cleanupError));
    if (rollbackErrors.length > 0) {
      throw new AggregateError(
        [error, ...rollbackErrors],
        "Asset creation failed and rollback encountered additional filesystem errors.",
      );
    }
    throw error;
  }
  await rm(transactionPath, { force: true }).catch(() => undefined);
}

async function commitReplacedAsset(
  oldDestination: string,
  destination: string,
  manifestPath: string,
  assetsDirectory: string,
  transactionPath: string,
  projectId: string,
  oldManifest: RuntimeAssetManifest,
  newEntry: RuntimeAssetEntry,
  bytes: Uint8Array,
  manifest: RuntimeAssetManifest,
): Promise<void> {
  const transactionId = randomUUID();
  const assetTemporary = `${destination}.${transactionId}.tmp`;
  const oldBackup = `${oldDestination}.${transactionId}.bak`;
  const manifestTemporary = safeChild(assetsDirectory, `.manifest.${transactionId}.tmp`);
  let oldBackedUp = false;
  let newCommitted = false;
  let manifestCommitted = false;
  const oldEntry = oldManifest.assets.find((entry) => entry.assetId === newEntry.assetId);
  if (oldEntry === undefined) throw new Error("Asset replacement transaction target is missing.");
  const transaction = assetTransactionSchema.parse({
    version: 1,
    transactionId,
    projectId,
    operation: "replace",
    oldRevision: oldManifest.revision,
    newRevision: manifest.revision,
    oldManifestSha256: sha256(manifestBytes(oldManifest)),
    newManifestSha256: sha256(manifestBytes(manifest)),
    oldEntry,
    newEntry,
  });
  try {
    await writeSynced(assetTemporary, bytes);
    await writeSynced(manifestTemporary, manifestBytes(manifest));
    await writeSynced(transactionPath, Buffer.from(`${JSON.stringify(transaction, null, 2)}\n`, "utf8"), 0o600);
    await rename(oldDestination, oldBackup);
    oldBackedUp = true;
    await link(assetTemporary, destination);
    newCommitted = true;
    await unlink(assetTemporary);
    await rename(manifestTemporary, manifestPath);
    manifestCommitted = true;
  } catch (error) {
    const rollbackErrors: unknown[] = [];
    await rm(assetTemporary, { force: true }).catch((cleanupError: unknown) => rollbackErrors.push(cleanupError));
    await rm(manifestTemporary, { force: true }).catch((cleanupError: unknown) => rollbackErrors.push(cleanupError));
    if (!manifestCommitted) {
      if (newCommitted) {
        await rm(destination, { force: true }).catch((cleanupError: unknown) => rollbackErrors.push(cleanupError));
      }
      if (oldBackedUp) {
        await rename(oldBackup, oldDestination).catch((rollbackError: unknown) => rollbackErrors.push(rollbackError));
      }
    }
    if (rollbackErrors.length > 0) {
      throw new AggregateError(
        [error, ...rollbackErrors],
        "Asset replacement failed and rollback encountered additional filesystem errors.",
      );
    }
    await rm(transactionPath, { force: true }).catch(() => undefined);
    throw error;
  }
  const backupCleaned = await rm(oldBackup, { force: true }).then(() => true, () => false);
  if (backupCleaned) await rm(transactionPath, { force: true }).catch(() => undefined);
}

function manifestBytes(manifest: RuntimeAssetManifest): Uint8Array {
  return Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

async function recoverAssetTransaction(
  transactionPath: string,
  metadataDirectory: string,
  runtimeDirectory: string,
  assetsDirectory: string,
  manifestPath: string,
  projectId: string,
): Promise<void> {
  const transactionInfo = await lstat(transactionPath).catch((error: unknown) => {
    if (isNodeError(error, "ENOENT")) return undefined;
    throw error;
  });
  if (transactionInfo === undefined) return;
  if (
    !transactionInfo.isFile() || transactionInfo.isSymbolicLink() || transactionInfo.nlink !== 1 ||
    transactionInfo.size < 1 || transactionInfo.size > ASSET_TRANSACTION_MAX_BYTES
  ) throw new Error("Asset transaction log is invalid; refusing automatic recovery.");
  const transaction = assetTransactionSchema.parse(
    await readVerifiedJson(transactionPath, metadataDirectory, "Asset transaction log"),
  );
  validateAssetTransaction(transaction, projectId);
  const currentManifest = runtimeAssetManifestSchema.parse(
    await readVerifiedJson(manifestPath, assetsDirectory, "Runtime asset manifest"),
  );
  const currentHash = sha256(manifestBytes(currentManifest));
  const newDestination = safeChild(runtimeDirectory, transaction.newEntry.path);
  const assetTemporary = `${newDestination}.${transaction.transactionId}.tmp`;
  const manifestTemporary = safeChild(assetsDirectory, `.manifest.${transaction.transactionId}.tmp`);

  if (
    currentManifest.revision === transaction.newRevision &&
    currentHash === transaction.newManifestSha256 &&
    manifestContainsEntry(currentManifest, transaction.newEntry)
  ) {
    await assertTransactionAsset(newDestination, runtimeDirectory, transaction.newEntry, "new");
    if (transaction.operation === "replace") {
      const oldDestination = safeChild(runtimeDirectory, transaction.oldEntry.path);
      const backup = `${oldDestination}.${transaction.transactionId}.bak`;
      await removeTransactionAssetIfPresent(backup, runtimeDirectory, transaction.oldEntry, "backup");
    }
    await removeTransactionAssetIfPresent(assetTemporary, runtimeDirectory, transaction.newEntry, "temporary");
    await removeManifestTemporaryIfPresent(manifestTemporary, assetsDirectory, transaction.newManifestSha256);
    await rm(transactionPath);
    return;
  }

  if (
    currentManifest.revision !== transaction.oldRevision ||
    currentHash !== transaction.oldManifestSha256 ||
    (transaction.operation === "create"
      ? currentManifest.assets.some((entry) => entry.assetId === transaction.newEntry.assetId)
      : !manifestContainsEntry(currentManifest, transaction.oldEntry))
  ) throw new Error("Asset transaction does not match the old or new manifest; refusing automatic recovery.");

  if (transaction.operation === "create") {
    await removeTransactionAssetIfPresent(newDestination, runtimeDirectory, transaction.newEntry, "new");
    await removeTransactionAssetIfPresent(assetTemporary, runtimeDirectory, transaction.newEntry, "temporary");
    await removeManifestTemporaryIfPresent(manifestTemporary, assetsDirectory, transaction.newManifestSha256);
    await rm(transactionPath);
    return;
  }

  const oldDestination = safeChild(runtimeDirectory, transaction.oldEntry.path);
  const backup = `${oldDestination}.${transaction.transactionId}.bak`;
  const backupExists = await pathExists(backup);
  if (oldDestination === newDestination) {
    if (backupExists && await pathExists(newDestination)) {
      await assertTransactionAsset(newDestination, runtimeDirectory, transaction.newEntry, "new");
      await rm(newDestination);
    }
  } else {
    await removeTransactionAssetIfPresent(newDestination, runtimeDirectory, transaction.newEntry, "new");
  }
  if (backupExists) {
    await assertTransactionAsset(backup, runtimeDirectory, transaction.oldEntry, "backup");
    if (await pathExists(oldDestination)) {
      throw new Error("Old asset destination already exists during transaction rollback.");
    }
    await link(backup, oldDestination);
    await unlink(backup);
  } else {
    await assertTransactionAsset(oldDestination, runtimeDirectory, transaction.oldEntry, "old");
  }
  await removeTransactionAssetIfPresent(assetTemporary, runtimeDirectory, transaction.newEntry, "temporary");
  await removeManifestTemporaryIfPresent(manifestTemporary, assetsDirectory, transaction.newManifestSha256);
  await rm(transactionPath);
}

function validateAssetTransaction(transaction: AssetTransaction, projectId: string): void {
  if (transaction.projectId !== projectId) throw new Error("Asset transaction belongs to another project.");
  if (transaction.newRevision !== transaction.oldRevision + 1) {
    throw new Error("Asset transaction revisions are not consecutive.");
  }
  if (transaction.operation === "replace" && transaction.oldEntry.assetId !== transaction.newEntry.assetId) {
    throw new Error("Asset transaction entries do not identify the same asset.");
  }
}

function manifestContainsEntry(manifest: RuntimeAssetManifest, expected: RuntimeAssetEntry): boolean {
  const actual = manifest.assets.find((entry) => entry.assetId === expected.assetId);
  return actual !== undefined && JSON.stringify(actual) === JSON.stringify(expected);
}

async function assertTransactionAsset(
  target: string,
  runtimeDirectory: string,
  entry: RuntimeAssetEntry,
  label: string,
): Promise<void> {
  const digest = await verifiedAssetHash(target, runtimeDirectory, entry.bytes, `${entry.assetId} (${label})`);
  if (digest !== entry.sha256 || digest !== entry.provenance.sha256) {
    throw new Error(`Asset transaction ${label} file hash is inconsistent.`);
  }
}

async function removeTransactionAssetIfPresent(
  target: string,
  runtimeDirectory: string,
  entry: RuntimeAssetEntry,
  label: string,
): Promise<void> {
  if (!await pathExists(target)) return;
  await assertTransactionAsset(target, runtimeDirectory, entry, label);
  await rm(target);
}

async function removeManifestTemporaryIfPresent(
  target: string,
  assetsDirectory: string,
  expectedHash: string,
): Promise<void> {
  if (!await pathExists(target)) return;
  const manifest = runtimeAssetManifestSchema.parse(
    await readVerifiedJson(target, assetsDirectory, "Temporary runtime asset manifest"),
  );
  if (sha256(manifestBytes(manifest)) !== expectedHash) {
    throw new Error("Temporary runtime asset manifest hash is inconsistent.");
  }
  await rm(target);
}


type OwnedAssetLock = { handle: FileHandle; token: string };

async function acquireAssetLock(
  lockPath: string,
  recoveryPath: string,
  runtime: AssetLockRuntime,
): Promise<OwnedAssetLock> {
  try {
    return await createAssetLock(lockPath, runtime);
  } catch (error) {
    if (!isNodeError(error, "EEXIST")) throw error;
  }

  const recovery = await acquireRecoveryGuard(recoveryPath, runtime);
  try {
    const candidate = await readAssetLock(lockPath);
    if (candidate.kind === "missing") return await createAssetLock(lockPath, runtime);
    if (candidate.kind === "invalid") {
      throw new Error("Asset manifest lock has unknown or legacy metadata; refusing automatic recovery.");
    }
    if (candidate.metadata.hostname !== runtime.hostname) {
      throw new Error("Asset manifest lock belongs to another host; refusing automatic recovery.");
    }
    const age = runtime.now() - candidate.metadata.createdAtMs;
    if (!Number.isSafeInteger(age) || age < LOCK_STALE_AFTER_MS) {
      throw new Error("Asset manifest lock is too recent for crash recovery.");
    }
    if (runtime.isProcessAlive(candidate.metadata.pid)) {
      throw new Error("Asset manifest is locked by an active writer.");
    }
    const current = await readAssetLock(lockPath);
    if (current.kind !== "valid" || current.metadata.token !== candidate.metadata.token) {
      throw new Error("Asset manifest lock changed during recovery; refusing to remove it.");
    }
    await unlink(lockPath);
    try {
      return await createAssetLock(lockPath, runtime);
    } catch (error) {
      if (isNodeError(error, "EEXIST")) throw new Error("Asset manifest lock was acquired by another writer during recovery.");
      throw error;
    }
  } finally {
    await releaseAssetLock(recoveryPath, recovery);
  }
}

async function acquireRecoveryGuard(pathname: string, runtime: AssetLockRuntime): Promise<OwnedAssetLock> {
  try {
    return await createAssetLock(pathname, runtime);
  } catch (error) {
    if (!isNodeError(error, "EEXIST")) throw error;
  }
  const candidate = await readAssetLock(pathname);
  if (candidate.kind !== "valid" || candidate.metadata.hostname !== runtime.hostname) {
    throw new Error("Asset manifest lock recovery guard is active or has unknown ownership.");
  }
  const age = runtime.now() - candidate.metadata.createdAtMs;
  if (!Number.isSafeInteger(age) || age < LOCK_STALE_AFTER_MS || runtime.isProcessAlive(candidate.metadata.pid)) {
    throw new Error("Asset manifest lock recovery is already in progress.");
  }
  const current = await readAssetLock(pathname);
  if (current.kind !== "valid" || current.metadata.token !== candidate.metadata.token) {
    throw new Error("Asset manifest recovery guard changed; refusing to remove it.");
  }
  await unlink(pathname);
  try {
    return await createAssetLock(pathname, runtime);
  } catch (error) {
    if (isNodeError(error, "EEXIST")) throw new Error("Asset manifest lock recovery was claimed by another writer.");
    throw error;
  }
}

async function createAssetLock(lockPath: string, runtime: AssetLockRuntime): Promise<OwnedAssetLock> {
  const handle = await open(lockPath, "wx", 0o600);
  try {
    const metadata = assetLockMetadataSchema.parse({
      version: 1,
      token: randomUUID(),
      pid: process.pid,
      hostname: runtime.hostname,
      createdAtMs: runtime.now(),
    });
    await handle.writeFile(`${JSON.stringify(metadata)}\n`, "utf8");
    await handle.sync();
    return { handle, token: metadata.token };
  } catch (error) {
    await handle.close().catch(() => undefined);
    await unlink(lockPath).catch(() => undefined);
    throw error;
  }
}

async function releaseAssetLock(lockPath: string, lock: OwnedAssetLock): Promise<void> {
  try {
    const handleInfo = await lock.handle.stat({ bigint: true });
    const pathInfo = await lstat(lockPath, { bigint: true }).catch(() => undefined);
    const candidate = await readAssetLock(lockPath);
    const owned = pathInfo !== undefined && pathInfo.isFile() && !pathInfo.isSymbolicLink() &&
      pathInfo.dev === handleInfo.dev && pathInfo.ino === handleInfo.ino &&
      candidate.kind === "valid" && candidate.metadata.token === lock.token;
    if (owned) {
      await unlink(lockPath).catch((error: unknown) => {
        if (!isNodeError(error, "ENOENT")) throw error;
      });
    }
  } finally {
    await lock.handle.close();
  }
}

type AssetLockRead =
  | { kind: "missing" }
  | { kind: "invalid" }
  | { kind: "valid"; metadata: AssetLockMetadata };

async function readAssetLock(lockPath: string): Promise<AssetLockRead> {
  const info = await lstat(lockPath).catch((error: unknown) => {
    if (isNodeError(error, "ENOENT")) return undefined;
    throw error;
  });
  if (info === undefined) return { kind: "missing" };
  if (!info.isFile() || info.isSymbolicLink() || info.size < 1 || info.size > LOCK_METADATA_MAX_BYTES) {
    return { kind: "invalid" };
  }
  try {
    const parsed = assetLockMetadataSchema.safeParse(JSON.parse(await readFile(lockPath, "utf8")) as unknown);
    return parsed.success ? { kind: "valid", metadata: parsed.data } : { kind: "invalid" };
  } catch {
    return { kind: "invalid" };
  }
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return !isNodeError(error, "ESRCH");
  }
}

async function verifiedManagedProject(projectsRoot: string, projectId: string): Promise<ManagedAssetProject> {
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
  const managed = managedGeneratedProjectManifestSchema.parse(
    await readVerifiedJson(managedPath, realProject, "Generated project manifest"),
  );
  if (managed.projectId !== projectId) throw new Error("Generated project manifest ID does not match.");
  return { directory: realProject, target: managed.target };
}

async function verifiedRuntimeAssetLayout(project: ManagedAssetProject): Promise<RuntimeAssetLayout> {
  const runtimeRelative = project.target === "web" ? "public" : "assets/resources";
  const runtimeLabel = project.target === "web" ? "Project public directory" : "Project Laya resources directory";
  const runtimeDirectory = await verifiedDirectory(safeChild(project.directory, runtimeRelative), runtimeLabel);
  const assetsDirectory = await verifiedDirectory(safeChild(runtimeDirectory, "assets"), "Project assets directory");
  return { runtimeDirectory, assetsDirectory };
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

async function writeSynced(target: string, bytes: Uint8Array, mode?: number): Promise<void> {
  const handle = await open(target, "wx", mode);
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
  runtimeDirectory: string,
  expectedBytes: number,
  assetId: string,
): Promise<string> {
  const handle = await open(target, "r").catch(() => undefined);
  if (handle === undefined) throw new Error(`Runtime asset file is missing or inconsistent: ${assetId}`);
  try {
    const before = await handle.stat({ bigint: true });
    await assertPathMatchesHandle(target, runtimeDirectory, before.dev, before.ino, expectedBytes, assetId);
    const digest = await sha256Handle(handle);
    const after = await handle.stat({ bigint: true });
    if (
      after.dev !== before.dev || after.ino !== before.ino || after.size !== before.size ||
      after.mtimeNs !== before.mtimeNs || after.ctimeNs !== before.ctimeNs
    ) {
      throw new Error(`Runtime asset file changed while being verified: ${assetId}`);
    }
    await assertPathMatchesHandle(target, runtimeDirectory, after.dev, after.ino, expectedBytes, assetId);
    return digest;
  } finally {
    await handle.close();
  }
}

async function assertPathMatchesHandle(
  target: string,
  runtimeDirectory: string,
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
  if (!isStrictChild(runtimeDirectory, realTarget)) {
    throw new Error(`Runtime asset file escaped the project: ${assetId}`);
  }
}

async function readVerifiedJson(target: string, root: string, label: string): Promise<unknown> {
  const handle = await open(target, "r").catch(() => undefined);
  if (handle === undefined) throw new Error(`${label} must be an existing real file.`);
  try {
    const handleInfo = await handle.stat({ bigint: true });
    const pathInfo = await lstat(target, { bigint: true }).catch(() => undefined);
    if (
      !handleInfo.isFile() || pathInfo === undefined || !pathInfo.isFile() || pathInfo.isSymbolicLink() ||
      pathInfo.dev !== handleInfo.dev || pathInfo.ino !== handleInfo.ino
    ) {
      throw new Error(`${label} must be an existing real file.`);
    }
    const realTarget = await realpath(target);
    if (!isStrictChild(root, realTarget)) throw new Error(`${label} escaped its project directory.`);
    const contents = await handle.readFile("utf8");
    const after = await handle.stat({ bigint: true });
    if (
      after.dev !== handleInfo.dev || after.ino !== handleInfo.ino || after.size !== handleInfo.size ||
      after.mtimeNs !== handleInfo.mtimeNs || after.ctimeNs !== handleInfo.ctimeNs
    ) {
      throw new Error(`${label} changed while being read.`);
    }
    return JSON.parse(contents) as unknown;
  } finally {
    await handle.close();
  }
}

function isStrictChild(root: string, candidate: string): boolean {
  const normalizedRoot = path.resolve(root).toLowerCase();
  const normalizedCandidate = path.resolve(candidate).toLowerCase();
  return normalizedCandidate.startsWith(`${normalizedRoot}${path.sep}`);
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
