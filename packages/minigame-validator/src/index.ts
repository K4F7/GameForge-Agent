import { createHash } from "node:crypto";
import { lstat, open, opendir, realpath } from "node:fs/promises";
import { isIP } from "node:net";
import path from "node:path";
import { douyinPlatformPolicySchema, type DouyinPlatformPolicy } from "@gameforge/contracts";
import { z } from "zod";

const MIB = 1024 * 1024;
const MAX_MAIN_PACKAGE_BYTES = 4 * MIB;
const MAX_TOTAL_BYTES = 20 * MIB;
const MAX_CONFIG_BYTES = 256 * 1024;
const PLATFORM_POLICY_PATH = "resources/gameforge-platform.json";
const POLICY_SCAN_EXTENSIONS = new Set([".js", ".json", ".ls"]);
const TRUSTED_ENGINE_SCRIPT_HASHES = new Map([
  ["microgame-adapter.js", "7a70507864ef92630a48b392aa214f1e669998ec79049dd8b02a0b3f316e7185"],
  ["libs/laya.adapter-bytedance.js", "ea1de2cb8eb5756a2ca94ea0777594c4cc50aacab0cbce7816f4bd7a9c0e7321"],
]);
const ALLOWED_FILE_EXTENSIONS = new Set([
  ".js", ".json", ".ls", ".txt", ".bin", ".wasm", ".map",
  ".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp",
  ".ktx", ".ktx2", ".dds", ".pvr",
  ".mp3", ".wav", ".ogg", ".aac", ".m4a",
  ".ttf", ".otf", ".fnt", ".atlas", ".sk", ".ani",
  ".lh", ".lm", ".lmat", ".lav", ".ltcb", ".part", ".glsl",
]);

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
  capabilities: DouyinPlatformPolicy["capabilities"];
  allowedNetworkHosts: readonly string[];
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
  const platformPolicy = douyinPlatformPolicySchema.parse(
    JSON.parse((await readRequiredFile(root, PLATFORM_POLICY_PATH, MAX_CONFIG_BYTES)).text) as unknown,
  );
  const subpackageRoots = normalizeSubpackageRoots(gameConfig.subPackages ?? []);
  const files = await walkFiles(root);
  await validateArtifactPolicy(root, files, platformPolicy);
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
    capabilities: platformPolicy.capabilities,
    allowedNetworkHosts: platformPolicy.allowedNetworkHosts,
  };
}

export { DouyinMiniGameBuilder, type DouyinMiniGameBuildResult } from "./builder.js";

async function readRequiredFile(root: string, relativePath: string, maximumBytes: number): Promise<{ text: string }> {
  const filePath = path.join(root, relativePath);
  const info = await lstat(filePath).catch(() => undefined);
  if (info === undefined || !info.isFile() || info.isSymbolicLink()) throw new Error(`Douyin mini-game requires a regular ${relativePath}.`);
  if (info.size > maximumBytes) throw new Error(`Douyin mini-game ${relativePath} exceeds its size limit.`);
  const actual = await realpath(filePath);
  if (pathKey(actual) !== pathKey(path.resolve(root, ...relativePath.split("/")))) {
    throw new Error(`Douyin mini-game ${relativePath} escaped the project root.`);
  }
  return { text: (await readStableProjectFile(root, relativePath, maximumBytes)).toString("utf8") };
}

function pathKey(value: string): string {
  const normalized = path.normalize(value);
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
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
      else if (info.isFile()) {
        const relative = path.relative(root, absolute).replace(/\\/g, "/");
        const extension = path.posix.extname(relative).toLowerCase();
        if (!ALLOWED_FILE_EXTENSIONS.has(extension)) {
          throw new Error(`Douyin mini-game project contains an unsupported file type: ${relative}.`);
        }
        files.push({ path: relative, bytes: info.size });
      }
      else throw new Error(`Douyin mini-game project contains an unsupported filesystem entry: ${entry.name}.`);
    }
  };
  await visit(root);
  return files.sort((left, right) => left.path.localeCompare(right.path));
}

async function validateArtifactPolicy(
  root: string,
  files: ReadonlyArray<{ path: string }>,
  policy: DouyinPlatformPolicy,
): Promise<void> {
  const allowedHosts = new Set(policy.allowedNetworkHosts);
  for (const file of files) {
    const extension = path.posix.extname(file.path).toLowerCase();
    if (!POLICY_SCAN_EXTENSIONS.has(extension)) continue;
    const content = await readStableProjectFile(root, file.path);
    const text = content.toString("utf8");
    if (extension === ".js" && containsRemoteScriptImport(text)) {
      throw new Error(`Douyin mini-game must not load remote JavaScript: ${file.path}.`);
    }
    for (const rawUrl of extractRemoteUrls(text)) {
      if (isRemoteJavaScriptUrl(rawUrl)) throw new Error(`Douyin mini-game must not load remote JavaScript: ${file.path}.`);
      validateRemoteUrl(rawUrl, allowedHosts, policy.capabilities.network, file.path);
    }
    if (isApplicationJavaScript(file.path, content)) validateDeclaredCapabilities(text, policy.capabilities, file.path);
  }
}

function containsRemoteScriptImport(text: string): boolean {
  const unsafeScheme = "(?:https?:)?\\/\\/|data:|blob:|javascript:";
  return new RegExp(`\\b(?:require|importScripts)\\s*\\(\\s*["'](?:${unsafeScheme})`, "i").test(text)
    || new RegExp(`\\bimport\\s*(?:\\(\\s*|[^;\\n]*?\\bfrom\\s*)["'](?:${unsafeScheme})`, "i").test(text)
    || /data\s*:\s*(?:text|application)\s*\/\s*javascript/i.test(text);
}

function extractRemoteUrls(text: string): string[] {
  const absolute = text.match(/https?:\/\/[a-z0-9](?:[a-z0-9._~:/?#[\]@!$&'()*+,;=%-]*[a-z0-9/#])?/gi) ?? [];
  const protocolRelative = [...text.matchAll(/["'](\/\/[a-z0-9](?:[a-z0-9._~:/?#[\]@!$&'()*+,;=%-]*[a-z0-9/#])?)/gi)]
    .map((match) => match[1])
    .filter((value): value is string => value !== undefined);
  return [...absolute, ...protocolRelative];
}

function isRemoteJavaScriptUrl(rawUrl: string): boolean {
  const parsed = new URL(rawUrl.startsWith("//") ? `https:${rawUrl}` : rawUrl);
  return /\.m?js$/i.test(parsed.pathname);
}

function validateRemoteUrl(rawUrl: string, allowedHosts: ReadonlySet<string>, networkDeclared: boolean, filePath: string): void {
  if (rawUrl.startsWith("//")) throw new Error(`Douyin mini-game remote URL must explicitly use HTTPS: ${filePath}.`);
  const parsed = new URL(rawUrl);
  if (parsed.protocol !== "https:") throw new Error(`Douyin mini-game remote URL must use HTTPS: ${filePath}.`);
  if (parsed.username !== "" || parsed.password !== "" || parsed.port !== "") {
    throw new Error(`Douyin mini-game remote URL must not contain credentials or a port: ${filePath}.`);
  }
  const hostname = parsed.hostname.toLowerCase();
  if (hostname === "localhost" || isIP(hostname) !== 0 || !hostname.includes(".")) {
    throw new Error(`Douyin mini-game remote URL host is unsafe: ${filePath}.`);
  }
  if (!networkDeclared) throw new Error(`Douyin mini-game uses a remote URL without declaring network capability: ${filePath}.`);
  if (!allowedHosts.has(hostname)) throw new Error(`Douyin mini-game remote URL host is not declared: ${hostname}.`);
}

function isApplicationJavaScript(filePath: string, content: Buffer): boolean {
  if (!filePath.endsWith(".js")) return false;
  const trustedHash = TRUSTED_ENGINE_SCRIPT_HASHES.get(filePath);
  if (trustedHash === undefined) return true;
  const actualHash = createHash("sha256").update(content).digest("hex");
  if (actualHash !== trustedHash) throw new Error(`Douyin mini-game trusted engine script hash mismatch: ${filePath}.`);
  return false;
}

function validateDeclaredCapabilities(
  text: string,
  capabilities: DouyinPlatformPolicy["capabilities"],
  filePath: string,
): void {
  const patterns: ReadonlyArray<[keyof typeof capabilities, RegExp]> = [
    ["network", ttApiPattern("request|downloadFile|uploadFile|connectSocket")],
    ["login", ttApiPattern("login")],
    ["share", ttApiPattern("shareAppMessage|onShareAppMessage|showShareMenu")],
    ["ads", ttApiPattern("create(?:RewardedVideo|Banner|Interstitial)Ad")],
    ["payments", ttApiPattern("requestGamePayment|pay")],
  ];
  for (const [capability, pattern] of patterns) {
    if (!capabilities[capability] && pattern.test(text)) {
      throw new Error(`Douyin mini-game uses undeclared ${capability} capability: ${filePath}.`);
    }
  }
}

function ttApiPattern(names: string): RegExp {
  return new RegExp(`\\btt\\s*(?:\\?\\s*)?(?:\\.\\s*(?:${names})\\b|\\[\\s*["'](?:${names})["']\\s*\\])`);
}

async function readStableProjectFile(root: string, relativePath: string, maximumBytes = MAX_TOTAL_BYTES): Promise<Buffer> {
  const expected = path.resolve(root, ...relativePath.split("/"));
  const before = await lstat(expected).catch(() => undefined);
  if (before === undefined || !before.isFile() || before.isSymbolicLink()) {
    throw new Error(`Douyin mini-game project file became unsafe: ${relativePath}.`);
  }
  if (before.size > maximumBytes) throw new Error(`Douyin mini-game ${relativePath} exceeds its size limit.`);
  const actual = await realpath(expected);
  if (pathKey(actual) !== pathKey(expected)) throw new Error(`Douyin mini-game ${relativePath} escaped the project root.`);
  const handle = await open(actual, "r");
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino || opened.size !== before.size) {
      throw new Error(`Douyin mini-game project file changed during validation: ${relativePath}.`);
    }
    return await handle.readFile();
  } finally {
    await handle.close();
  }
}
