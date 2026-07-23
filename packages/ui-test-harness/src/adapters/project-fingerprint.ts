import { createHash } from "node:crypto";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";

export async function projectFingerprint(projectRoot: string): Promise<string> {
  const entries: string[] = [];
  const visit = async (directory: string): Promise<void> => {
    const children = await readdir(directory, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return [];
      throw error;
    });
    for (const entry of children) {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(target);
      else if (entry.isFile()) {
        const info = await stat(target).catch((error: NodeJS.ErrnoException) => {
          if (error.code === "ENOENT") return undefined;
          throw error;
        });
        if (info !== undefined) entries.push(`${path.relative(projectRoot, target).replaceAll("\\", "/")}:${info.size}:${info.mtimeMs}`);
      }
    }
  };
  await visit(projectRoot);
  return createHash("sha256").update(entries.sort().join("\n")).digest("hex");
}
