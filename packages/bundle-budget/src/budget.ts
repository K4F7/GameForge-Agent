import { readFile } from "node:fs/promises";
import path from "node:path";
import { gzipSync } from "node:zlib";
import {
  bundleBudgetIssues,
  type BundleLimits,
  type BundleMetrics,
} from "@gameforge/contracts";

export type ManifestChunk = { file: string; isEntry?: boolean; imports?: string[]; dynamicImports?: string[]; css?: string[] };
export type ViteManifest = Record<string, ManifestChunk>;
export type Size = { raw: number; gzip: number };
export type { BundleLimits, BundleMetrics } from "@gameforge/contracts";

export function classifyManifest(manifest: ViteManifest): Map<string, "initial" | "async"> {
  const phases = new Map<string, "initial" | "async">();
  const visit = (key: string, phase: "initial" | "async"): void => {
    const current = phases.get(key);
    if (current === "initial" || current === phase) return;
    phases.set(key, phase);
    const chunk = manifest[key];
    if (chunk === undefined) throw new Error(`Manifest references missing chunk: ${key}`);
    for (const imported of chunk.imports ?? []) visit(imported, phase);
    for (const imported of chunk.dynamicImports ?? []) visit(imported, "async");
  };
  for (const [key, chunk] of Object.entries(manifest)) if (chunk.isEntry) visit(key, "initial");
  if (![...phases.values()].includes("initial")) throw new Error("Manifest contains no entry chunk.");
  return phases;
}

export async function measureBundle(dist: string, manifest: ViteManifest): Promise<BundleMetrics> {
  const phases = classifyManifest(manifest);
  const files: BundleMetrics["files"] = [];
  const seen = new Set<string>();
  for (const [key, phase] of phases) {
    const chunk = manifest[key] as ManifestChunk;
    for (const relative of [chunk.file, ...(chunk.css ?? [])]) {
      if (seen.has(relative) || !/\.(?:js|css)$/.test(relative)) continue;
      seen.add(relative);
      const target = path.resolve(dist, relative);
      const root = `${path.resolve(dist)}${path.sep}`;
      if (!target.startsWith(root)) throw new Error(`Manifest file escapes dist: ${relative}`);
      const bytes = await readFile(target);
      files.push({ path: relative.replaceAll("\\", "/"), phase, raw: bytes.byteLength, gzip: gzipSync(bytes).byteLength });
    }
  }
  const sum = (phase?: "initial" | "async"): Size => files.filter((file) => phase === undefined || file.phase === phase)
    .reduce((size, file) => ({ raw: size.raw + file.raw, gzip: size.gzip + file.gzip }), { raw: 0, gzip: 0 });
  return { initial: sum("initial"), async: sum("async"), total: sum(), files };
}

export function budgetIssues(metrics: BundleMetrics, limits: BundleLimits): string[] {
  return bundleBudgetIssues(metrics, limits);
}
