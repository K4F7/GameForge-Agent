import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";

export async function fingerprintProject(root: string): Promise<string> {
  const files = await collectFiles(root);
  const digest = createHash("sha256").update("gameforge-project-fingerprint-v1\0");
  for (const file of files.sort()) {
    const info = await stat(path.join(root, file)).catch(() => undefined);
    if (info === undefined || !info.isFile()) continue;
    digest.update(`${file}\0${info.size}\0${info.mtimeMs}\n`);
  }
  return digest.digest("hex");
}

async function collectFiles(directory: string, relativeDirectory = ""): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  const files: string[] = [];
  for (const entry of entries) {
    const relative = path.join(relativeDirectory, entry.name);
    if (entry.isDirectory()) files.push(...await collectFiles(path.join(directory, entry.name), relative));
    else if (entry.isFile()) files.push(relative);
  }
  return files;
}
