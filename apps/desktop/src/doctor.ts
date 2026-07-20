#!/usr/bin/env bun

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { desktopDoctorIssues } from "./doctor-core.js";

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const readJson = async (relative: string): Promise<Record<string, unknown>> =>
  JSON.parse(await readFile(path.join(desktopRoot, relative), "utf8")) as Record<string, unknown>;
const exists = async (target: string): Promise<boolean> => readFile(target).then(() => true, () => false);
const input = {
  config: await readJson("src-tauri/tauri.conf.json"),
  capability: await readJson("src-tauri/capabilities/default.json"),
  rustSource: await readFile(path.join(desktopRoot, "src-tauri/src/lib.rs"), "utf8"),
  workbenchBuilt: await exists(path.resolve(desktopRoot, "../workbench/dist/index.html")),
};
const issues = desktopDoctorIssues(input);
console.log(JSON.stringify({ ok: issues.length === 0, permissions: 0, plugins: 0, workbenchBuilt: input.workbenchBuilt, issues }, null, 2));
if (issues.length > 0) process.exitCode = 1;
