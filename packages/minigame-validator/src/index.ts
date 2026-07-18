import { lstat, opendir, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

const MIB = 1024 * 1024;
const MAX_MAIN_PACKAGE_BYTES = 4 * MIB;
const MAX_TOTAL_BYTES = 20 * MIB;
const MAX_CONFIG_BYTES = 256 * 1024;

const subpackageSchema = z.strictObject({
  name: z.string().trim().min(1).max(100).optional(),
  root: z.string().trim().min(1).max(200).regex(/^[a-zA-Z0-9][a-zA-Z0-9._/-]*$/),
});

const gameConfigSchema = z.object({
  deviceOrientation: z.enum(["portrait", "landscape"]).optional(),
  showStatusBar: z.boolean().optional(),
  networkTimeout: z.object({
    request: z.number().int().positive().max(60_000).optional(),
    connectSocket: z.number().int().positive().max(60_000).optional(),
    uploadFile: z.number().int().positive().max(60_000).optional(),
    downloadFile: z.number().int().positive().max(60_000).optional(),
  }).strict().optional(),
  subPackages: z.array(subpackageSchema).max(100).optional(),
}).passthrough();

const projectConfigSchema = z.object({
  description: z.string().max(500).optional(),
  appid: z.string().max(100).optional(),
  projectname: z.string().max(100).optional(),
  setting: z.object({ es6: z.boolean().optional() }).passthrough().optional(),
}).passthrough();

export type DouyinMiniGameValidationReport = {
  platform: "douyin-mini-game";
  passed: true;
  fileCount: number;
  totalBytes: number;
  mainPackageBytes: number;
  subpackages: ReadonlyArray<{ root: string; bytes: number }>;
  deviceOrientation: "portrait" | "landscape";
};

export async function validateDouyinMiniGameProject(projectRoot: string): Promise<DouyinMiniGameValidationReport> {
  if (!path.isAbsolute(projectRoot)) throw new Error("Douyin mini-game project root must be absolute.");
  const rootInfo = await lstat(projectRoot);
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) throw new Error("Douyin mini-game project root must be a real directory.");
  const root = await realpath(projectRoot);
  const gameEntry = await readRequiredFile(root, "game.js", MAX_TOTAL_BYTES);
  if (gameEntry.text.trim().length === 0) throw new Error("Douyin mini-game game.js must not be empty.");
  if (/\b(?:document|window)\s*\./.test(gameEntry.text)) throw new Error("Douyin mini-game entry must not depend on browser DOM globals.");
  const gameConfig = gameConfigSchema.parse(JSON.parse((await readRequiredFile(root, "game.json", MAX_CONFIG_BYTES)).text) as unknown);
  projectConfigSchema.parse(JSON.parse((await readRequiredFile(root, "project.config.json", MAX_CONFIG_BYTES)).text) as unknown);
  const subpackageRoots = normalizeSubpackageRoots(gameConfig.subPackages ?? []);
  const files = await walkFiles(root);
  const packages = new Map(subpackageRoots.map((subpackageRoot) => [subpackageRoot, 0]));
  let mainPackageBytes = 0;
  let totalBytes = 0;
  for (const file of files) {
    totalBytes += file.bytes;
    const matchedRoot = subpackageRoots.find((subpackageRoot) => file.path === subpackageRoot || file.path.startsWith(`${subpackageRoot}/`));
    if (matchedRoot === undefined) mainPackageBytes += file.bytes;
    else packages.set(matchedRoot, (packages.get(matchedRoot) ?? 0) + file.bytes);
  }
  if (mainPackageBytes > MAX_MAIN_PACKAGE_BYTES) throw new Error(`Douyin mini-game main package exceeds 4 MiB: ${mainPackageBytes} bytes.`);
  if (totalBytes > MAX_TOTAL_BYTES) throw new Error(`Douyin mini-game project exceeds 20 MiB: ${totalBytes} bytes.`);
  for (const [subpackageRoot, bytes] of packages) {
    if (bytes > MAX_TOTAL_BYTES) throw new Error(`Douyin mini-game subpackage exceeds 20 MiB: ${subpackageRoot}.`);
  }
  return {
    platform: "douyin-mini-game",
    passed: true,
    fileCount: files.length,
    totalBytes,
    mainPackageBytes,
    subpackages: [...packages].map(([subpackageRoot, bytes]) => ({ root: subpackageRoot, bytes })),
    deviceOrientation: gameConfig.deviceOrientation ?? "landscape",
  };
}

export { DouyinMiniGameBuilder, type DouyinMiniGameBuildResult } from "./builder.js";

async function readRequiredFile(root: string, relativePath: string, maximumBytes: number): Promise<{ text: string }> {
  const filePath = path.join(root, relativePath);
  const info = await lstat(filePath).catch(() => undefined);
  if (info === undefined || !info.isFile() || info.isSymbolicLink()) throw new Error(`Douyin mini-game requires a regular ${relativePath}.`);
  if (info.size > maximumBytes) throw new Error(`Douyin mini-game ${relativePath} exceeds its size limit.`);
  const actual = await realpath(filePath);
  if (path.dirname(actual) !== root) throw new Error(`Douyin mini-game ${relativePath} escaped the project root.`);
  return { text: await readFile(actual, "utf8") };
}

function normalizeSubpackageRoots(subpackages: ReadonlyArray<{ root: string }>): string[] {
  const roots = subpackages.map(({ root }) => root.replace(/\\/g, "/").replace(/\/$/, ""));
  if (new Set(roots).size !== roots.length) throw new Error("Douyin mini-game subpackage roots must be unique.");
  for (const root of roots) {
    if (root === "." || root.includes("..") || path.posix.isAbsolute(root)) throw new Error("Douyin mini-game subpackage root is unsafe.");
  }
  return roots.sort((left, right) => right.length - left.length);
}

async function walkFiles(root: string): Promise<Array<{ path: string; bytes: number }>> {
  const files: Array<{ path: string; bytes: number }> = [];
  const visit = async (directory: string): Promise<void> => {
    const handle = await opendir(directory);
    for await (const entry of handle) {
      const absolute = path.join(directory, entry.name);
      const info = await lstat(absolute);
      if (info.isSymbolicLink()) throw new Error(`Douyin mini-game project contains a symbolic link: ${entry.name}.`);
      if (info.isDirectory()) await visit(absolute);
      else if (info.isFile()) files.push({ path: path.relative(root, absolute).replace(/\\/g, "/"), bytes: info.size });
      else throw new Error(`Douyin mini-game project contains an unsupported filesystem entry: ${entry.name}.`);
    }
  };
  await visit(root);
  return files.sort((left, right) => left.path.localeCompare(right.path));
}
