import { spawn } from "node:child_process";
import { bindChildLifecycle, resolveRuntime, writeRuntimeConfig } from "../shared/runtime.js";

const runtime = await resolveRuntime(import.meta.dirname, "opencode");
await writeRuntimeConfig(runtime);
const executable = process.env.OPENCODE_BIN?.trim() || "opencode";
const args = process.argv.slice(2);
if (args.includes("--dry-run")) {
  process.stdout.write(`${JSON.stringify({ client: "opencode", executable, ...runtime }, null, 2)}\n`);
  process.exit(0);
}
const child = spawn(executable, args.length === 0 ? [runtime.repoRoot] : args, {
  cwd: runtime.repoRoot,
  stdio: "inherit",
  env: { ...process.env, OPENCODE_CONFIG: runtime.configPath },
});
bindChildLifecycle(child);
child.once("error", (error) => {
  process.stderr.write(`Failed to start OpenCode: ${error.message}\n`);
  process.exitCode = 1;
});
