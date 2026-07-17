import { spawn } from "node:child_process";
import path from "node:path";
import { access } from "node:fs/promises";
import { bindChildLifecycle, resolveRuntime, writeRuntimeConfig } from "../shared/runtime.js";

const runtime = await resolveRuntime(import.meta.dirname, "codearts");
await writeRuntimeConfig(runtime);
const args = process.argv.slice(2);
if (args.includes("--dry-run")) {
  process.stdout.write(`${JSON.stringify({ client: "codearts", ...runtime }, null, 2)}\n`);
  process.exit(0);
}
const executable = await findCodeArtsExecutable();
const child = spawn(executable, args.length === 0 ? [runtime.repoRoot] : args, {
  cwd: runtime.repoRoot,
  stdio: "inherit",
  env: {
    ...process.env,
    KERNEL_DATA_DIR: process.env.KERNEL_DATA_DIR ?? path.join(userHome(), ".codeartsdoer", "cli-data"),
    KERNEL_CONFIG_DIR: process.env.KERNEL_CONFIG_DIR ?? path.join(userHome(), ".codeartsdoer"),
    OPENCODE_CONFIG: runtime.configPath,
    OPENCODE_MODE: "tui",
    SCENARIO: "codeartsdoer",
  },
});
bindChildLifecycle(child);

async function findCodeArtsExecutable(): Promise<string> {
  const configured = process.env.CODEARTS_BIN?.trim();
  if (configured) return configured;
  if (process.platform === "win32") {
    const candidate = path.join(userHome(), ".codeartsdoer", "installers", "bin", "codearts.exe");
    await access(candidate);
    return candidate;
  }
  return "codearts";
}

function userHome(): string {
  const value = process.env.USERPROFILE?.trim() || process.env.HOME?.trim();
  if (!value) throw new Error("USERPROFILE or HOME is required to locate CodeArts.");
  return value;
}
