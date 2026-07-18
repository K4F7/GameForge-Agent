import { createHash } from "node:crypto";
import { constants, type BigIntStats } from "node:fs";
import { lstat, open, opendir, realpath } from "node:fs/promises";
import path from "node:path";
import {
  miniGameHandoffFilePathSchema,
  miniGameLocalHandoffManifestSchema,
  projectIdSchema,
  type MiniGameHandoffFile,
  type MiniGameLocalHandoffManifest,
} from "@gameforge/contracts";

const MAX_ARTIFACT_BYTES = 20 * 1024 * 1024;
const MAX_ARTIFACT_FILES = 4_096;
const HASH_BUFFER_BYTES = 64 * 1024;

export type MiniGameHandoffTarget = "douyin-mini-game" | "wechat-mini-game";

export async function createMiniGameLocalHandoffManifest(input: {
  projectRoot: string;
  projectId: string;
  target: MiniGameHandoffTarget;
}): Promise<MiniGameLocalHandoffManifest> {
  if (!path.isAbsolute(input.projectRoot)) throw new Error("Mini-game handoff root must be absolute.");
  const projectId = projectIdSchema.parse(input.projectId);
  const rootInfo = await lstat(input.projectRoot, { bigint: true }).catch(() => undefined);
  if (rootInfo === undefined || !rootInfo.isDirectory() || rootInfo.isSymbolicLink()) {
    throw new Error("Mini-game handoff root must be a real directory.");
  }
  const root = await realpath(input.projectRoot);
  const rootAfterResolution = await lstat(input.projectRoot, { bigint: true });
  if (!sameDirectoryIdentity(rootInfo, rootAfterResolution)) {
    throw new Error("Mini-game handoff root changed during resolution.");
  }
  const expectedDirectory = input.target === "douyin-mini-game" ? "bytedancegame" : "wxgame";
  if (path.basename(root) !== expectedDirectory || path.basename(path.dirname(root)) !== "release") {
    throw new Error(`Mini-game handoff root must be release/${expectedDirectory}.`);
  }
  const files: MiniGameHandoffFile[] = [];
  let totalBytes = 0;

  const visit = async (directory: string): Promise<void> => {
    const directoryHandle = await opendir(directory);
    for await (const entry of directoryHandle) {
      const absolute = path.join(directory, entry.name);
      const info = await lstat(absolute, { bigint: true });
      if (info.isSymbolicLink()) throw new Error("Mini-game handoff contains a symbolic link.");
      if (info.isDirectory()) {
        const actualDirectory = await realpath(absolute);
        if (pathKey(actualDirectory) !== pathKey(absolute)) throw new Error("Mini-game handoff directory escaped its root.");
        await visit(actualDirectory);
        continue;
      }
      if (!info.isFile()) throw new Error("Mini-game handoff contains an unsupported filesystem entry.");
      if (files.length >= MAX_ARTIFACT_FILES) throw new Error("Mini-game handoff contains too many files.");
      const relative = path.relative(root, absolute).replace(/\\/g, "/");
      const normalizedPath = miniGameHandoffFilePathSchema.parse(relative);
      const hashed = await hashStableFile(absolute, normalizedPath);
      totalBytes += hashed.bytes;
      if (totalBytes > MAX_ARTIFACT_BYTES) throw new Error("Mini-game handoff exceeds 20 MiB.");
      files.push({ path: normalizedPath, ...hashed });
    }
  };
  await visit(root);
  const rootAfterTraversal = await lstat(input.projectRoot, { bigint: true }).catch(() => undefined);
  const actualRootAfterTraversal = await realpath(input.projectRoot).catch(() => undefined);
  if (rootAfterTraversal === undefined || actualRootAfterTraversal === undefined ||
      !sameDirectoryIdentity(rootInfo, rootAfterTraversal) || pathKey(actualRootAfterTraversal) !== pathKey(root)) {
    throw new Error("Mini-game handoff root changed during hashing.");
  }
  files.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
  if (files.length === 0) throw new Error("Mini-game handoff must contain at least one file.");
  const artifactRoot = input.target === "douyin-mini-game" ? "release/bytedancegame" : "release/wxgame";
  const unsigned = {
    schemaVersion: "1.0" as const,
    projectId,
    target: input.target,
    artifactRoot,
    engine: "layaair" as const,
    engineVersion: "3.4.0" as const,
    fileCount: files.length,
    totalBytes,
    files,
    remoteOperations: "forbidden" as const,
    devToolVerification: "not-run" as const,
  };
  const aggregateSha256 = createHash("sha256").update(`${JSON.stringify(unsigned)}\n`, "utf8").digest("hex");
  return miniGameLocalHandoffManifestSchema.parse({ ...unsigned, aggregateSha256 });
}

export function assertMiniGameHandoffSnapshot(
  before: MiniGameLocalHandoffManifest,
  after: MiniGameLocalHandoffManifest,
): void {
  if (before.aggregateSha256 !== after.aggregateSha256) {
    throw new Error("Mini-game artifact changed while its handoff evidence was being validated.");
  }
}

async function hashStableFile(
  expected: string,
  relativePath: string,
): Promise<{ bytes: number; sha256: string }> {
  const before = await lstat(expected, { bigint: true }).catch(() => undefined);
  if (before === undefined || !before.isFile() || before.isSymbolicLink() || before.size > BigInt(MAX_ARTIFACT_BYTES)) {
    throw new Error(`Mini-game handoff file is missing, unsafe, or oversized: ${relativePath}.`);
  }
  const actual = await realpath(expected);
  if (pathKey(actual) !== pathKey(expected)) throw new Error(`Mini-game handoff file escaped its root: ${relativePath}.`);
  const flags = process.platform === "win32" ? constants.O_RDONLY : constants.O_RDONLY | constants.O_NOFOLLOW;
  const handle = await open(actual, flags);
  try {
    const opened = await handle.stat({ bigint: true });
    if (!sameFileSnapshot(before, opened)) throw new Error(`Mini-game handoff file changed before hashing: ${relativePath}.`);
    const digest = createHash("sha256");
    const buffer = Buffer.allocUnsafe(HASH_BUFFER_BYTES);
    let bytes = 0;
    while (true) {
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
      if (bytesRead === 0) break;
      bytes += bytesRead;
      if (bytes > MAX_ARTIFACT_BYTES) throw new Error(`Mini-game handoff file exceeds its size limit: ${relativePath}.`);
      digest.update(buffer.subarray(0, bytesRead));
    }
    const afterHandle = await handle.stat({ bigint: true });
    const afterPath = await lstat(expected, { bigint: true });
    if (bytes !== Number(opened.size) || !sameFileSnapshot(opened, afterHandle) || !sameFileSnapshot(opened, afterPath)) {
      throw new Error(`Mini-game handoff file changed while hashing: ${relativePath}.`);
    }
    const actualAfter = await realpath(expected);
    if (pathKey(actualAfter) !== pathKey(expected)) throw new Error(`Mini-game handoff file escaped its root: ${relativePath}.`);
    return { bytes, sha256: digest.digest("hex") };
  } finally {
    await handle.close();
  }
}

function sameFileSnapshot(left: BigIntStats, right: BigIntStats): boolean {
  return left.isFile() && right.isFile() &&
    left.dev === right.dev && left.ino === right.ino && left.size === right.size &&
    left.mtimeNs === right.mtimeNs && left.ctimeNs === right.ctimeNs;
}

function sameDirectoryIdentity(left: BigIntStats, right: BigIntStats): boolean {
  return left.isDirectory() && right.isDirectory() && !left.isSymbolicLink() && !right.isSymbolicLink() &&
    left.dev === right.dev && left.ino === right.ino;
}

function pathKey(value: string): string {
  const normalized = path.normalize(value);
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}
