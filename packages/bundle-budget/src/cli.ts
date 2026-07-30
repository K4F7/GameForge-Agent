#!/usr/bin/env bun

import { readFile } from "node:fs/promises";
import path from "node:path";
import { webGameBundleLimits } from "@gameforge/contracts";
import { budgetIssues, measureBundle, type BundleLimits, type ViteManifest } from "./budget.js";

const root = process.cwd();
const targets: Array<{ name: string; dist: string; limits: BundleLimits }> = [
  { name: "game", dist: "apps/game/dist", limits: webGameBundleLimits },
];
const report: Record<string, unknown> = { generatedAt: new Date().toISOString(), targets: {} };
let failed = false;
for (const target of targets) {
  const dist = path.resolve(root, target.dist);
  const manifest = JSON.parse(await readFile(path.join(dist, ".vite", "manifest.json"), "utf8")) as ViteManifest;
  const metrics = await measureBundle(dist, manifest);
  const issues = budgetIssues(metrics, target.limits);
  (report.targets as Record<string, unknown>)[target.name] = { metrics, limits: target.limits, issues };
  failed ||= issues.length > 0;
}
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (failed) process.exitCode = 1;
