import { spawn } from "node:child_process";
import path from "node:path";
import { bindChildLifecycle, resolveRuntime, writeRuntimeConfig } from "../shared/runtime.js";
import { codeArtsSpawnCommand, resolveCodeArtsLaunchTarget } from "./executable.js";

const runtime = await resolveRuntime(import.meta.dirname, "codearts");
const fullAccess = process.env.GAMEFORGE_CODEARTS_FULL_ACCESS === "1";
await writeRuntimeConfig(runtime, { permissionMode: fullAccess ? "full-access" : "scoped" });
const args = process.argv.slice(2);
const launchTarget = await resolveCodeArtsLaunchTarget({
  home: userHome(),
  ...(process.env.CODEARTS_BIN === undefined ? {} : { configured: process.env.CODEARTS_BIN }),
  ...(process.env.ComSpec === undefined ? {} : { comspec: process.env.ComSpec }),
});
if (args.includes("--dry-run")) {
  process.stdout.write(`${JSON.stringify({ client: "codearts", executable: launchTarget.executable, ...runtime }, null, 2)}\n`);
  process.exit(0);
}
const clientArgs = args.length === 0 ? [runtime.repoRoot] : args;
const spawnCommand = codeArtsSpawnCommand(launchTarget, clientArgs);
const child = spawn(spawnCommand.command, spawnCommand.args, {
  cwd: runtime.repoRoot,
  stdio: "inherit",
  windowsVerbatimArguments: spawnCommand.windowsVerbatimArguments,
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

function userHome(): string {
  const value = process.env.USERPROFILE?.trim() || process.env.HOME?.trim();
  if (!value) throw new Error("USERPROFILE or HOME is required to locate CodeArts.");
  return value;
}
