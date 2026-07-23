import { readFile } from "node:fs/promises";
import path from "node:path";

type ReviewEntry = { name: string; version: string; license: string; source: string; purpose: string; officialGap: string; transitiveRuntimeDependencies: string[] };
type ReviewRecord = { reviewedAt: string; verification: string; dependencies: ReviewEntry[] };
type PackageManifest = { name?: string; version?: string; license?: string; dependencies?: Record<string, string> };

const packageRoot = path.resolve(import.meta.dirname, "..");

export async function verifyHarnessDependencyReview(): Promise<{ verified: number }> {
  const manifest = await readJson<PackageManifest>(path.join(packageRoot, "package.json"));
  const record = await readJson<ReviewRecord>(path.join(packageRoot, "dependency-review.json"));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(record.reviewedAt) || record.verification.length === 0) throw new Error("Dependency review metadata is incomplete.");
  const declared = Object.fromEntries(Object.entries(manifest.dependencies ?? {}).filter(([, version]) => !version.startsWith("workspace:")));
  if (record.dependencies.length !== Object.keys(declared).length) throw new Error("Dependency review must cover every runtime dependency exactly once.");
  for (const expected of record.dependencies) {
    if (declared[expected.name] !== expected.version) throw new Error(`${expected.name} is not pinned to reviewed version ${expected.version}.`);
    if (!expected.source.startsWith("https://") || expected.purpose.length === 0 || expected.officialGap.length === 0) throw new Error(`${expected.name} provenance or rationale is incomplete.`);
    const installed = await readJson<PackageManifest>(path.join(packageRoot, "node_modules", ...expected.name.split("/"), "package.json"));
    if (installed.name !== expected.name || installed.version !== expected.version || installed.license !== expected.license) throw new Error(`${expected.name} installed metadata does not match the dependency review.`);
    const actualTransitive = Object.keys(installed.dependencies ?? {}).sort();
    const reviewedTransitive = [...expected.transitiveRuntimeDependencies].sort();
    if (JSON.stringify(actualTransitive) !== JSON.stringify(reviewedTransitive)) throw new Error(`${expected.name} runtime dependency closure changed.`);
  }
  return { verified: record.dependencies.length };
}

async function readJson<T>(file: string): Promise<T> {
  return JSON.parse(await readFile(file, "utf8")) as T;
}
