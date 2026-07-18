#!/usr/bin/env bun

import { spawn } from "node:child_process";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "../../..");

for (const packageName of ["@gameforge/contracts", "@gameforge/minigame-validator"]) {
  const result = await runBuild(process.execPath, ["run", "--silent", "--filter", packageName, "build"]);
  if (result.code !== 0) {
    if (result.stdout.length > 0) process.stderr.write(result.stdout);
    process.exitCode = result.code;
    break;
  }
}

function runBuild(command: string, args: string[]): Promise<{ code: number; stdout: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: repoRoot,
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "inherit"],
      env: process.env,
    });
    const chunks: Buffer[] = [];
    let bytes = 0;
    child.stdout.on("data", (chunk: Buffer) => {
      const remaining = 64 * 1024 - bytes;
      bytes += chunk.length;
      if (remaining > 0) chunks.push(chunk.subarray(0, remaining));
    });
    child.once("error", reject);
    child.once("close", (code) => resolve({ code: code ?? 1, stdout: Buffer.concat(chunks).toString("utf8") }));
  });
}

if (process.exitCode === undefined || process.exitCode === 0) {
  process.exitCode = await run(
    "node",
    [path.join(repoRoot, "packages", "minigame-validator", "dist", "handoff-cli.js"), ...process.argv.slice(2)],
    "inherit",
  );
}

function run(command: string, args: string[], stdout: "ignore" | "inherit"): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: repoRoot,
      shell: false,
      windowsHide: true,
      stdio: ["ignore", stdout, "inherit"],
      env: process.env,
    });
    child.once("error", reject);
    child.once("close", (code) => resolve(code ?? 1));
  });
}
