import {
  generatedProjectPlanSchema,
  generatedProjectFileSchema,
  managedGeneratedProjectManifestSchema,
  projectUpdateSummarySchema,
  projectGenerationRequestSchema,
  projectGenerationResultSchema,
  projectIdSchema,
  type GameSpec,
  type GamePlatformTarget,
  type GeneratedProjectPlan,
  type ProjectGenerationRequest,
  type ProjectGenerationResult,
  type ManagedGeneratedProjectManifest,
  type ProjectUpdateSummary,
} from "@gameforge/contracts";
import { createHash, randomUUID } from "node:crypto";
import { link, mkdir, lstat, open, readFile, realpath, rename, rm, unlink } from "node:fs/promises";
import { hostname as systemHostname } from "node:os";
import path from "node:path";
import { z } from "zod";
import { createIndexHtml, loaderSource, runtimeSource } from "./template.js";

export const GAMEFORGE_GENERATOR_VERSION = "0.13.0";
const MAX_PROJECT_BYTES = 2 * 1024 * 1024;

type GeneratedFile = { path: string; content: string; bytes: number; sha256: string };
type UpdateInspection = {
  target: string;
  manifest: ManagedGeneratedProjectManifest;
  summary: ProjectUpdateSummary;
  manifestFileSha256: string;
};

const PRESERVED_UPDATE_PATHS = new Set([
  "public/assets/manifest.json",
]);
const UPDATE_LOCK_STALE_AFTER_MS = 10 * 60 * 1000;
const UPDATE_TRANSACTION_MAX_BYTES = 128 * 1024;
type OwnedUpdateLock = { handle: Awaited<ReturnType<typeof open>>; token: string };
const updateTransactionFileSchema = z.strictObject({
  path: generatedProjectFileSchema.shape.path,
  action: z.enum(["add", "update", "delete"]),
  old: generatedProjectFileSchema.optional(),
  new: generatedProjectFileSchema.optional(),
});
const updateTransactionSchema = z.strictObject({
  version: z.literal(1),
  transactionId: z.string().uuid(),
  projectId: projectIdSchema,
  oldManifestSha256: z.string().regex(/^[a-f0-9]{64}$/),
  newManifestSha256: z.string().regex(/^[a-f0-9]{64}$/),
  oldPlanSha256: z.string().regex(/^[a-f0-9]{64}$/),
  newPlanSha256: z.string().regex(/^[a-f0-9]{64}$/),
  files: z.array(updateTransactionFileSchema).max(30),
});
type UpdateTransaction = z.infer<typeof updateTransactionSchema>;

export type GameProjectGeneratorOptions = {
  outputRoot: string;
};
export type ProjectUpdateRecoveryResult = {
  projectId: string;
  status: "clean" | "rolled-back" | "committed";
  planSha256: string;
};

export class GameProjectGenerator {
  readonly #outputRoot: string;

  constructor(options: GameProjectGeneratorOptions) {
    if (!path.isAbsolute(options.outputRoot)) {
      throw new Error("Game project output root must be an absolute path.");
    }
    const normalized = path.resolve(options.outputRoot);
    if (path.parse(normalized).root === normalized) {
      throw new Error("Game project output root cannot be a filesystem root.");
    }
    this.#outputRoot = normalized;
  }

  async execute(request: ProjectGenerationRequest): Promise<ProjectGenerationResult> {
    const input = projectGenerationRequestSchema.parse(request);
    if (input.target !== "web") {
      throw new Error("Game project generation only supports Web Phaser/Vite projects.");
    }
    const generated = createGeneratedFiles(input.projectId, input.spec, input.target);
    const plan = generatedProjectPlanSchema.parse({
      generatorVersion: GAMEFORGE_GENERATOR_VERSION,
      projectId: input.projectId,
      target: input.target,
      specSha256: generated.specSha256,
      planSha256: generated.planSha256,
      files: generated.files.map(({ path: filePath, bytes, sha256 }) => ({
        path: filePath,
        bytes,
        sha256,
      })),
    });

    if (input.operation === "update") {
      const inspection = await this.#inspectUpdate(input.projectId, input.target, generated.files);
      if (input.mode === "dry-run") {
        return projectGenerationResultSchema.parse({ mode: "dry-run", operation: "update", plan, update: inspection.summary });
      }
      if (input.expectedPlanSha256 === undefined) {
        throw new Error("Project update apply requires expectedPlanSha256 from the latest dry-run.");
      }
      const applied = await this.#applyUpdate(
        input.projectId,
        input.target,
        generated.files,
        input.expectedPlanSha256,
      );
      return projectGenerationResultSchema.parse({
        mode: "apply",
        operation: "update",
        plan,
        outputPath: applied.outputPath,
        update: applied.update,
      });
    }

    if (input.expectedPlanSha256 !== undefined) {
      throw new Error("expectedPlanSha256 is only valid for project updates.");
    }
    if (input.mode === "dry-run") {
      return projectGenerationResultSchema.parse({ mode: "dry-run", operation: "create", plan });
    }

    const outputPath = await this.#apply(input.projectId, generated.files);
    return projectGenerationResultSchema.parse({ mode: "apply", operation: "create", plan, outputPath });
  }

  async recover(projectIdInput: string): Promise<ProjectUpdateRecoveryResult> {
    const projectId = projectIdSchema.parse(projectIdInput);
    const root = await verifiedRoot(this.#outputRoot);
    const target = await verifiedManagedProject(root, projectId);
    const lockPath = safeRelativeFile(target, ".gameforge/update.lock");
    const lock = await acquireUpdateLock(lockPath);
    try {
      const status = await recoverProjectUpdate(target, projectId);
      const manifest = managedGeneratedProjectManifestSchema.parse(JSON.parse(
        await readManagedText(target, ".gameforge/manifest.json"),
      ) as unknown);
      return { projectId, status, planSha256: manifest.planSha256 };
    } finally {
      await releaseUpdateLock(lockPath, lock);
    }
  }

  async #apply(projectId: string, files: ReadonlyArray<GeneratedFile>): Promise<string> {
    await mkdir(this.#outputRoot, { recursive: true });
    const rootInfo = await lstat(this.#outputRoot);
    if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) {
      throw new Error("Game project output root must be a real directory, not a symbolic link.");
    }
    const root = await realpath(this.#outputRoot);
    const target = safeChild(root, projectId);
    if (await exists(target)) {
      throw new Error(`Generated project already exists: ${projectId}`);
    }

    const temporary = safeChild(root, `.gameforge-tmp-${projectId}-${randomUUID()}`);
    await mkdir(temporary, { recursive: false });
    try {
      for (const file of files) {
        const destination = safeRelativeFile(temporary, file.path);
        await mkdir(path.dirname(destination), { recursive: true });
        const handle = await open(destination, "wx");
        try {
          await handle.writeFile(file.content, { encoding: "utf8" });
          await handle.sync();
        } finally {
          await handle.close();
        }
      }
      await rename(temporary, target);
      return target;
    } catch (error) {
      if (temporary.startsWith(`${root}${path.sep}`)) {
        await rm(temporary, { recursive: true, force: true });
      }
      throw error;
    }
  }

  async #inspectUpdate(projectId: string, platformTarget: GamePlatformTarget, files: ReadonlyArray<GeneratedFile>): Promise<UpdateInspection> {
    const root = await verifiedRoot(this.#outputRoot);
    const target = safeChild(root, projectId);
    const targetInfo = await lstat(target).catch(() => undefined);
    if (targetInfo === undefined || !targetInfo.isDirectory() || targetInfo.isSymbolicLink()) {
      throw new Error(`Generated project does not exist for update: ${projectId}`);
    }
    const realTarget = await realpath(target);
    if (path.dirname(realTarget).toLowerCase() !== root.toLowerCase()) {
      throw new Error("Generated project escaped the configured output root.");
    }
    const manifestText = await readManagedText(realTarget, ".gameforge/manifest.json");
    const manifest = managedGeneratedProjectManifestSchema.parse(JSON.parse(manifestText) as unknown);
    if (manifest.projectId !== projectId) throw new Error("Generated project manifest ID does not match.");
    if (manifest.target !== platformTarget) {
      throw new Error(`Generated project target cannot change during update: ${manifest.target} -> ${platformTarget}.`);
    }
    const desired = new Map(files.filter((file) => file.path !== ".gameforge/manifest.json").map((file) => [file.path, file]));
    const current = new Map(manifest.files.map((file) => [file.path, file]));
    const updatedPaths: string[] = [];
    const unchangedPaths: string[] = [];
    const preservedPaths: string[] = [];
    const deletedPaths: string[] = [];
    const conflicts: string[] = [];

    for (const [filePath, currentFile] of current) {
      if (PRESERVED_UPDATE_PATHS.has(filePath)) {
        preservedPaths.push(filePath);
        continue;
      }
      const actual = await managedFileHash(realTarget, filePath);
      if (actual !== undefined && actual !== currentFile.sha256) {
        conflicts.push(filePath);
        continue;
      }
      const next = desired.get(filePath);
      if (next === undefined) {
        if (actual !== undefined) deletedPaths.push(filePath);
        else unchangedPaths.push(filePath);
      }
      else if (actual === next.sha256) unchangedPaths.push(filePath);
      else updatedPaths.push(filePath);
    }
    for (const [filePath] of desired) {
      if (current.has(filePath) || PRESERVED_UPDATE_PATHS.has(filePath)) continue;
      if (await managedFileHash(realTarget, filePath) !== undefined) conflicts.push(filePath);
      else updatedPaths.push(filePath);
    }
    const summary = projectUpdateSummarySchema.parse({
      currentPlanSha256: manifest.planSha256,
      updatedPaths: sortedUnique(updatedPaths),
      unchangedPaths: sortedUnique(unchangedPaths),
      preservedPaths: sortedUnique(preservedPaths),
      deletedPaths: sortedUnique(deletedPaths),
      conflicts: sortedUnique(conflicts),
    });
    return { target: realTarget, manifest, summary, manifestFileSha256: sha256(manifestText) };
  }

  async #applyUpdate(
    projectId: string,
    platformTarget: GamePlatformTarget,
    files: ReadonlyArray<GeneratedFile>,
    expectedPlanSha256: string,
  ): Promise<{ outputPath: string; update: ProjectUpdateSummary }> {
    const initial = await this.#inspectUpdate(projectId, platformTarget, files);
    const lockPath = safeRelativeFile(initial.target, ".gameforge/update.lock");
    const lock = await acquireUpdateLock(lockPath);
    try {
      const inspection = await this.#inspectUpdate(projectId, platformTarget, files);
      if (inspection.manifest.planSha256 !== expectedPlanSha256) {
        throw new Error(`Generated project plan conflict: expected ${expectedPlanSha256}, found ${inspection.manifest.planSha256}.`);
      }
      if (inspection.summary.conflicts.length > 0) {
        throw new Error(`Generated project contains modified managed files: ${inspection.summary.conflicts.join(", ")}`);
      }
      const desired = new Map(files.map((file) => [file.path, file]));
      const current = new Map(inspection.manifest.files.map((file) => [file.path, file]));
      const transactionId = randomUUID();
      const managedManifest = desired.get(".gameforge/manifest.json");
      if (managedManifest === undefined) throw new Error("Generated update manifest is missing from the plan.");
      const transactionPath = safeRelativeFile(inspection.target, ".gameforge/update.transaction.json");
      if (await exists(transactionPath)) {
        throw new Error("Generated project has an unfinished update transaction; recover it before applying another update.");
      }
      const transaction = updateTransactionSchema.parse({
        version: 1,
        transactionId,
        projectId,
        oldManifestSha256: inspection.manifestFileSha256,
        newManifestSha256: managedManifest.sha256,
        oldPlanSha256: inspection.manifest.planSha256,
        newPlanSha256: managedManifestContent(managedManifest.content).planSha256,
        files: [
          ...inspection.summary.updatedPaths.map((filePath) => {
            const old = current.get(filePath);
            const next = desired.get(filePath);
            if (next === undefined) throw new Error(`Generated update file is missing from the plan: ${filePath}`);
            return {
              path: filePath,
              action: old === undefined ? "add" as const : "update" as const,
              ...(old === undefined ? {} : { old }),
              new: generatedFileMetadata(next),
            };
          }),
          ...inspection.summary.deletedPaths.map((filePath) => ({
            path: filePath,
            action: "delete" as const,
            old: current.get(filePath),
          })),
        ],
      });
      validateUpdateTransaction(transaction);
      await writeSynced(transactionPath, `${JSON.stringify(transaction, null, 2)}\n`);
      const applied: Array<{ destination: string; backup?: string }> = [];
      const temporaries: string[] = [];
      try {
        for (const filePath of inspection.summary.updatedPaths) {
          const next = desired.get(filePath);
          if (next === undefined) throw new Error(`Generated update file is missing from the plan: ${filePath}`);
          const destination = await safeManagedDestination(inspection.target, filePath);
          const currentFile = current.get(filePath);
          const beforeHash = await managedFileHash(inspection.target, filePath);
          if (currentFile === undefined ? beforeHash !== undefined : beforeHash !== currentFile.sha256) {
            throw new Error(`Generated managed file changed during update: ${filePath}`);
          }
          const temporary = `${destination}.${transactionId}.tmp`;
          temporaries.push(temporary);
          await writeSynced(temporary, next.content);
          const destinationInfo = await lstat(destination).catch(() => undefined);
          let backup: string | undefined;
          if (destinationInfo !== undefined) {
            if (!destinationInfo.isFile() || destinationInfo.isSymbolicLink()) {
              throw new Error(`Generated managed path is not a real file: ${filePath}`);
            }
            backup = `${destination}.${transactionId}.bak`;
            await rename(destination, backup);
            applied.push({ destination, backup });
          }
          await link(temporary, destination);
          if (backup === undefined) applied.push({ destination });
          await unlink(temporary);
        }
        for (const filePath of inspection.summary.deletedPaths) {
          const destination = await safeManagedDestination(inspection.target, filePath);
          const currentFile = current.get(filePath);
          if (currentFile === undefined || await managedFileHash(inspection.target, filePath) !== currentFile.sha256) {
            throw new Error(`Generated managed file changed during update: ${filePath}`);
          }
          const backup = `${destination}.${transactionId}.bak`;
          await rename(destination, backup);
          applied.push({ destination, backup });
        }
        const manifestDestination = await safeManagedDestination(inspection.target, managedManifest.path);
        const manifestTemporary = `${manifestDestination}.${transactionId}.tmp`;
        const manifestBackup = `${manifestDestination}.${transactionId}.bak`;
        temporaries.push(manifestTemporary);
        await writeSynced(manifestTemporary, managedManifest.content);
        if (sha256(await readManagedText(inspection.target, managedManifest.path)) !== inspection.manifestFileSha256) {
          throw new Error("Generated project manifest changed during update.");
        }
        await rename(manifestDestination, manifestBackup);
        applied.push({ destination: manifestDestination, backup: manifestBackup });
        await link(manifestTemporary, manifestDestination);
        await unlink(manifestTemporary);
      } catch (error) {
        const rollbackErrors: unknown[] = [];
        for (const temporary of temporaries) {
          await rm(temporary, { force: true }).catch((cleanup: unknown) => rollbackErrors.push(cleanup));
        }
        for (const item of [...applied].reverse()) {
          await rm(item.destination, { force: true }).catch((cleanup: unknown) => rollbackErrors.push(cleanup));
          if (item.backup !== undefined) {
            await rename(item.backup, item.destination).catch((cleanup: unknown) => rollbackErrors.push(cleanup));
          }
        }
        if (rollbackErrors.length > 0) {
          throw new AggregateError([error, ...rollbackErrors], "Generated project update failed and rollback encountered errors.");
        }
        await rm(transactionPath, { force: true }).catch(() => undefined);
        throw error;
      }
      let cleanupComplete = true;
      for (const item of applied) {
        if (item.backup !== undefined) {
          const removed = await rm(item.backup, { force: true }).then(() => true, () => false);
          cleanupComplete &&= removed;
        }
      }
      if (cleanupComplete) await rm(transactionPath, { force: true }).catch(() => undefined);
      return { outputPath: inspection.target, update: inspection.summary };
    } finally {
      await releaseUpdateLock(lockPath, lock);
    }
  }
}

function createGeneratedFiles(projectId: string, spec: GameSpec, target: GamePlatformTarget): {
  files: ReadonlyArray<GeneratedFile>;
  specSha256: string;
  planSha256: string;
} {
  const specContent = `${JSON.stringify(spec, null, 2)}\n`;
  const baseFiles = [
    file(".npmrc", "registry=https://registry.npmjs.org/\n"),
    file("game-spec.json", specContent),
    file("index.html", createIndexHtml(spec.locale)),
    file("package.json", `${JSON.stringify({
      name: `gameforge-${projectId}`,
      version: "0.1.0",
      private: true,
      type: "module",
      packageManager: "bun@1.3.14",
      scripts: { dev: "vite", build: "tsc --noEmit && vite build", check: "tsc --noEmit" },
      dependencies: { phaser: "4.2.1" },
      devDependencies: { typescript: "7.0.2", vite: "8.1.4" },
    }, null, 2)}\n`),
    file("public/assets/manifest.json", `${JSON.stringify({
      schemaVersion: "1.0",
      projectId,
      revision: 0,
      assets: [],
    }, null, 2)}\n`),
    file("src/main.ts", loaderSource),
    file("src/game.ts", runtimeSource),
    file("tsconfig.json", `${JSON.stringify({
      compilerOptions: {
        target: "ES2023",
        module: "ESNext",
        moduleResolution: "Bundler",
        strict: true,
        noUncheckedIndexedAccess: true,
        exactOptionalPropertyTypes: true,
        skipLibCheck: true,
        resolveJsonModule: true,
        esModuleInterop: true,
        lib: ["ES2023", "DOM", "DOM.Iterable"],
        types: ["vite/client"],
      },
      include: ["src", "vite.config.ts", "game-spec.json"],
    }, null, 2)}\n`),
    file("vite.config.ts", 'import { defineConfig } from "vite";\n\nexport default defineConfig({ base: "./", build: { manifest: true } });\n'),
  ].sort((left, right) => left.path.localeCompare(right.path));

  const specSha256 = sha256(specContent);
  const planSha256 = sha256(JSON.stringify({
    target,
    files: baseFiles.map(({ path: filePath, bytes, sha256: hash }) => ({
      path: filePath,
      bytes,
      sha256: hash,
    })),
  }));
  const manifest = file(".gameforge/manifest.json", `${JSON.stringify({
    schemaVersion: "1.0",
    generatorVersion: GAMEFORGE_GENERATOR_VERSION,
    projectId,
    target,
    specSha256,
    planSha256,
    files: baseFiles.map(({ path: filePath, bytes, sha256: hash }) => ({
      path: filePath,
      bytes,
      sha256: hash,
    })),
  }, null, 2)}\n`);
  const files = [...baseFiles, manifest].sort((left, right) => left.path.localeCompare(right.path));
  const totalBytes = files.reduce((total, current) => total + current.bytes, 0);
  if (totalBytes > MAX_PROJECT_BYTES) {
    throw new Error("Generated project exceeds the maximum template size.");
  }
  return { files, specSha256, planSha256 };
}

function file(filePath: string, content: string): GeneratedFile {
  return {
    path: filePath,
    content,
    bytes: Buffer.byteLength(content, "utf8"),
    sha256: sha256(content),
  };
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function safeChild(root: string, name: string): string {
  const candidate = path.resolve(root, name);
  if (candidate === root || !candidate.startsWith(`${root}${path.sep}`)) {
    throw new Error("Generated project path escaped the configured output root.");
  }
  return candidate;
}

function safeRelativeFile(root: string, filePath: string): string {
  if (path.isAbsolute(filePath) || filePath.includes("\0")) {
    throw new Error("Generated file path must be relative and normalized.");
  }
  const normalized = filePath.replaceAll("/", path.sep);
  if (normalized.split(path.sep).some((segment) => segment === "" || segment === "." || segment === "..")) {
    throw new Error("Generated file path contains an unsafe segment.");
  }
  return safeChild(root, normalized);
}

async function exists(target: string): Promise<boolean> {
  try {
    await lstat(target);
    return true;
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

async function verifiedRoot(outputRoot: string): Promise<string> {
  await mkdir(outputRoot, { recursive: true });
  const info = await lstat(outputRoot);
  if (!info.isDirectory() || info.isSymbolicLink()) {
    throw new Error("Game project output root must be a real directory, not a symbolic link.");
  }
  return realpath(outputRoot);
}

async function verifiedManagedProject(root: string, projectId: string): Promise<string> {
  const target = safeChild(root, projectId);
  const info = await lstat(target).catch(() => undefined);
  if (info === undefined || !info.isDirectory() || info.isSymbolicLink()) {
    throw new Error(`Generated project does not exist: ${projectId}`);
  }
  const realTarget = await realpath(target);
  if (path.dirname(realTarget).toLowerCase() !== root.toLowerCase()) {
    throw new Error("Generated project escaped the configured output root.");
  }
  return realTarget;
}

function generatedFileMetadata(file: GeneratedFile): { path: string; bytes: number; sha256: string } {
  return { path: file.path, bytes: file.bytes, sha256: file.sha256 };
}

function managedManifestContent(content: string): ManagedGeneratedProjectManifest {
  return managedGeneratedProjectManifestSchema.parse(JSON.parse(content) as unknown);
}

function validateUpdateTransaction(transaction: UpdateTransaction): void {
  const paths = new Set<string>();
  for (const item of transaction.files) {
    if (paths.has(item.path)) throw new Error(`Generated update transaction repeats a path: ${item.path}`);
    paths.add(item.path);
    if (item.old?.path !== undefined && item.old.path !== item.path) throw new Error("Update old metadata path mismatch.");
    if (item.new?.path !== undefined && item.new.path !== item.path) throw new Error("Update new metadata path mismatch.");
    if (
      (item.action === "add" && (item.old !== undefined || item.new === undefined)) ||
      (item.action === "update" && (item.old === undefined || item.new === undefined)) ||
      (item.action === "delete" && (item.old === undefined || item.new !== undefined))
    ) throw new Error(`Generated update transaction metadata is invalid for ${item.action}: ${item.path}`);
    if (PRESERVED_UPDATE_PATHS.has(item.path) || item.path === ".gameforge/manifest.json") {
      throw new Error(`Generated update transaction contains a protected path: ${item.path}`);
    }
  }
}

async function recoverProjectUpdate(
  target: string,
  projectId: string,
): Promise<"clean" | "rolled-back" | "committed"> {
  const transactionPath = safeRelativeFile(target, ".gameforge/update.transaction.json");
  const info = await lstat(transactionPath).catch((error: unknown) => {
    if (isNodeError(error, "ENOENT")) return undefined;
    throw error;
  });
  if (info === undefined) return "clean";
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size < 1 || info.size > UPDATE_TRANSACTION_MAX_BYTES) {
    throw new Error("Generated update transaction log is invalid.");
  }
  const transaction = updateTransactionSchema.parse(JSON.parse(await readManagedText(
    target,
    ".gameforge/update.transaction.json",
  )) as unknown);
  validateUpdateTransaction(transaction);
  if (transaction.projectId !== projectId) throw new Error("Generated update transaction belongs to another project.");
  const manifestPath = safeRelativeFile(target, ".gameforge/manifest.json");
  const manifestBackup = `${manifestPath}.${transaction.transactionId}.bak`;
  const manifestTemporary = `${manifestPath}.${transaction.transactionId}.tmp`;
  const manifestHash = await managedFileHash(target, ".gameforge/manifest.json");
  const committed = manifestHash === transaction.newManifestSha256;
  const rolledBack = manifestHash === transaction.oldManifestSha256 || (
    manifestHash === undefined && await rawFileMatches(manifestBackup, transaction.oldManifestSha256)
  );
  if (!committed && !rolledBack) {
    throw new Error("Generated update transaction does not match the old or new managed manifest.");
  }

  if (committed) {
    for (const item of transaction.files) await finalizeUpdateItem(target, transaction.transactionId, item);
    await removeRawIfMatches(manifestBackup, transaction.oldManifestSha256);
    await removeRawIfMatches(manifestTemporary, transaction.newManifestSha256);
    await rm(transactionPath);
    return "committed";
  }

  for (const item of [...transaction.files].reverse()) {
    await rollbackUpdateItem(target, transaction.transactionId, item);
  }
  if (manifestHash === undefined) {
    await restoreRawBackup(manifestBackup, manifestPath, transaction.oldManifestSha256);
  } else {
    await removeRawIfMatches(manifestBackup, transaction.oldManifestSha256);
  }
  await removeRawIfMatches(manifestTemporary, transaction.newManifestSha256);
  await rm(transactionPath);
  return "rolled-back";
}

async function finalizeUpdateItem(
  root: string,
  transactionId: string,
  item: z.infer<typeof updateTransactionFileSchema>,
): Promise<void> {
  const destination = safeRelativeFile(root, item.path);
  const temporary = `${destination}.${transactionId}.tmp`;
  const backup = `${destination}.${transactionId}.bak`;
  if (item.action === "delete") {
    if (await exists(destination)) throw new Error(`Deleted managed file reappeared during recovery: ${item.path}`);
  } else {
    await assertGeneratedFile(root, item.new!, "new");
  }
  if (item.old !== undefined) await removeRawIfMatches(backup, item.old.sha256);
  if (item.new !== undefined) await removeRawIfMatches(temporary, item.new.sha256);
}

async function rollbackUpdateItem(
  root: string,
  transactionId: string,
  item: z.infer<typeof updateTransactionFileSchema>,
): Promise<void> {
  const destination = safeRelativeFile(root, item.path);
  const temporary = `${destination}.${transactionId}.tmp`;
  const backup = `${destination}.${transactionId}.bak`;
  if (item.action === "add") {
    if (await exists(destination)) await removeGeneratedIfMatches(root, item.new!, "new");
  } else if (await exists(backup)) {
    if (await exists(destination)) {
      if (item.action === "delete") {
        throw new Error(`Deleted managed file reappeared during rollback: ${item.path}`);
      }
      await removeGeneratedIfMatches(root, item.new!, "new");
    }
    await restoreRawBackup(backup, destination, item.old!.sha256);
  } else {
    await assertGeneratedFile(root, item.old!, "old");
  }
  if (item.new !== undefined) await removeRawIfMatches(temporary, item.new.sha256);
}

async function assertGeneratedFile(
  root: string,
  metadata: { path: string; bytes: number; sha256: string },
  label: string,
): Promise<void> {
  const target = safeRelativeFile(root, metadata.path);
  const info = await lstat(target).catch(() => undefined);
  if (info === undefined || !info.isFile() || info.isSymbolicLink() || info.size !== metadata.bytes) {
    throw new Error(`Generated update ${label} file is missing or inconsistent: ${metadata.path}`);
  }
  if (await managedFileHash(root, metadata.path) !== metadata.sha256) {
    throw new Error(`Generated update ${label} file hash is inconsistent: ${metadata.path}`);
  }
}

async function removeGeneratedIfMatches(
  root: string,
  metadata: { path: string; bytes: number; sha256: string },
  label: string,
): Promise<void> {
  await assertGeneratedFile(root, metadata, label);
  await rm(safeRelativeFile(root, metadata.path));
}

async function rawFileMatches(target: string, expectedHash: string): Promise<boolean> {
  const info = await lstat(target).catch(() => undefined);
  if (info === undefined || !info.isFile() || info.isSymbolicLink()) return false;
  return sha256(await readFile(target, "utf8")) === expectedHash;
}

async function removeRawIfMatches(target: string, expectedHash: string): Promise<void> {
  if (!await exists(target)) return;
  if (!await rawFileMatches(target, expectedHash)) throw new Error(`Generated update artifact hash is inconsistent: ${target}`);
  await rm(target);
}

async function restoreRawBackup(backup: string, destination: string, expectedHash: string): Promise<void> {
  if (!await rawFileMatches(backup, expectedHash)) throw new Error("Generated update backup hash is inconsistent.");
  if (await exists(destination)) throw new Error("Generated update destination exists during rollback.");
  await link(backup, destination);
  await unlink(backup);
}

async function readManagedText(root: string, filePath: string): Promise<string> {
  const target = safeRelativeFile(root, filePath);
  const handle = await open(target, "r").catch(() => undefined);
  if (handle === undefined) throw new Error(`Generated managed file is missing: ${filePath}`);
  try {
    const handleInfo = await handle.stat({ bigint: true });
    const pathInfo = await lstat(target, { bigint: true }).catch(() => undefined);
    if (
      !handleInfo.isFile() || pathInfo === undefined || !pathInfo.isFile() || pathInfo.isSymbolicLink() ||
      handleInfo.dev !== pathInfo.dev || handleInfo.ino !== pathInfo.ino
    ) throw new Error(`Generated managed path is not a real file: ${filePath}`);
    const realTarget = await realpath(target);
    if (!isStrictChild(root, realTarget)) throw new Error(`Generated managed file escaped the project: ${filePath}`);
    return handle.readFile("utf8");
  } finally {
    await handle.close();
  }
}

async function managedFileHash(root: string, filePath: string): Promise<string | undefined> {
  const target = safeRelativeFile(root, filePath);
  const info = await lstat(target).catch((error: unknown) => {
    if (isNodeError(error, "ENOENT")) return undefined;
    throw error;
  });
  if (info === undefined) return undefined;
  if (!info.isFile() || info.isSymbolicLink()) throw new Error(`Generated managed path is not a real file: ${filePath}`);
  return sha256(await readManagedText(root, filePath));
}

async function safeManagedDestination(root: string, filePath: string): Promise<string> {
  const destination = safeRelativeFile(root, filePath);
  const relativeDirectory = path.dirname(filePath.replaceAll("/", path.sep));
  let directory = root;
  if (relativeDirectory !== ".") {
    for (const segment of relativeDirectory.split(path.sep)) {
      directory = safeChild(directory, segment);
      const info = await lstat(directory).catch((error: unknown) => {
        if (isNodeError(error, "ENOENT")) return undefined;
        throw error;
      });
      if (info === undefined) await mkdir(directory);
      else if (!info.isDirectory() || info.isSymbolicLink()) {
        throw new Error(`Generated managed path contains an unsafe directory: ${filePath}`);
      }
    }
  }
  return destination;
}

async function writeSynced(target: string, content: string): Promise<void> {
  const handle = await open(target, "wx");
  try {
    await handle.writeFile(content, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
}

function sortedUnique(values: ReadonlyArray<string>): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function isStrictChild(root: string, candidate: string): boolean {
  const normalizedRoot = path.resolve(root).toLowerCase();
  const normalizedCandidate = path.resolve(candidate).toLowerCase();
  return normalizedCandidate.startsWith(`${normalizedRoot}${path.sep}`);
}

function isNodeError(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}

async function acquireUpdateLock(lockPath: string): Promise<OwnedUpdateLock> {
  try {
    return await createUpdateLock(lockPath);
  } catch (error) {
    if (!isNodeError(error, "EEXIST")) throw error;
  }
  const candidate = await readUpdateLock(lockPath);
  if (candidate === undefined) throw new Error("Generated project update lock has invalid ownership metadata.");
  if (candidate.hostname !== systemHostname()) throw new Error("Generated project update lock belongs to another host.");
  const age = Date.now() - candidate.createdAtMs;
  if (!Number.isSafeInteger(age) || age < UPDATE_LOCK_STALE_AFTER_MS || processIsAlive(candidate.pid)) {
    throw new Error("Generated project update is already in progress.");
  }
  const current = await readUpdateLock(lockPath);
  if (current?.token !== candidate.token) throw new Error("Generated project update lock changed during recovery.");
  await unlink(lockPath);
  try {
    return await createUpdateLock(lockPath);
  } catch (error) {
    if (isNodeError(error, "EEXIST")) throw new Error("Generated project update was claimed by another process.");
    throw error;
  }
}

async function createUpdateLock(lockPath: string): Promise<OwnedUpdateLock> {
  const handle = await open(lockPath, "wx", 0o600);
  const token = randomUUID();
  try {
    await handle.writeFile(`${JSON.stringify({
      version: 1,
      token,
      pid: process.pid,
      hostname: systemHostname(),
      createdAtMs: Date.now(),
    })}\n`, "utf8");
    await handle.sync();
    return { handle, token };
  } catch (error) {
    await handle.close().catch(() => undefined);
    await unlink(lockPath).catch(() => undefined);
    throw error;
  }
}

async function readUpdateLock(lockPath: string): Promise<{
  token: string;
  pid: number;
  hostname: string;
  createdAtMs: number;
} | undefined> {
  const info = await lstat(lockPath).catch(() => undefined);
  if (info === undefined || !info.isFile() || info.isSymbolicLink() || info.size < 1 || info.size > 4096) return undefined;
  try {
    const value = JSON.parse(await readFile(lockPath, "utf8")) as Record<string, unknown>;
    if (
      value.version !== 1 || typeof value.token !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.token) ||
      typeof value.pid !== "number" || !Number.isSafeInteger(value.pid) || value.pid < 1 ||
      typeof value.hostname !== "string" || value.hostname.trim().length < 1 || value.hostname.length > 255 ||
      typeof value.createdAtMs !== "number" || !Number.isSafeInteger(value.createdAtMs) || value.createdAtMs < 0 ||
      Object.keys(value).sort().join(",") !== "createdAtMs,hostname,pid,token,version"
    ) return undefined;
    return {
      token: value.token,
      pid: value.pid,
      hostname: value.hostname,
      createdAtMs: value.createdAtMs,
    };
  } catch {
    return undefined;
  }
}

async function releaseUpdateLock(lockPath: string, lock: OwnedUpdateLock): Promise<void> {
  try {
    const handleInfo = await lock.handle.stat({ bigint: true });
    const pathInfo = await lstat(lockPath, { bigint: true }).catch(() => undefined);
    const current = await readUpdateLock(lockPath);
    if (
      pathInfo !== undefined && pathInfo.isFile() && !pathInfo.isSymbolicLink() &&
      pathInfo.dev === handleInfo.dev && pathInfo.ino === handleInfo.ino && current?.token === lock.token
    ) await unlink(lockPath).catch((error: unknown) => { if (!isNodeError(error, "ENOENT")) throw error; });
  } finally {
    await lock.handle.close();
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
