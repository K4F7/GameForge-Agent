import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { bindChildLifecycle, resolveRuntime, writeRuntimeConfig } from "../shared/runtime.js";
import { codeArtsSpawnCommand, resolveCodeArtsLaunchTarget } from "./executable.js";
import { resolveCodeArtsServerOptions, withoutExternalProviderEnvironment } from "./server-config.js";

const runtime = await resolveRuntime(import.meta.dirname, "codearts");
await writeRuntimeConfig(runtime);
const options = resolveCodeArtsServerOptions(process.argv.slice(2));
const home = userHome();
const launchTarget = await resolveCodeArtsLaunchTarget({
  home,
  ...(process.env.CODEARTS_BIN === undefined ? {} : { configured: process.env.CODEARTS_BIN }),
  ...(process.env.ComSpec === undefined ? {} : { comspec: process.env.ComSpec }),
});
const clientArgs = [
  "serve",
  "--pure",
  "--hostname", options.hostname,
  "--port", String(options.port),
  ...options.corsOrigins.flatMap((origin) => ["--cors", origin]),
];
const connectionPath = path.join(path.dirname(runtime.configPath), "server.json");
const connection = {
  client: "codearts",
  protocol: "opencode-compatible-http",
  baseUrl: options.baseUrl,
  corsOrigins: options.corsOrigins,
  passwordProtected: Boolean(process.env.CODEARTS_SERVER_PASSWORD?.trim()),
};
await writeFile(connectionPath, `${JSON.stringify(connection, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });

if (options.dryRun) {
  process.stdout.write(`${JSON.stringify({
    ...connection,
    executable: launchTarget.executable,
    configPath: runtime.configPath,
    connectionPath,
  }, null, 2)}\n`);
  process.exit(0);
}

process.stdout.write(`GameForge CodeArts server: ${options.baseUrl}\n`);
process.stdout.write(`Connection descriptor: ${connectionPath}\n`);
const spawnCommand = codeArtsSpawnCommand(launchTarget, clientArgs);
const childEnvironment = withoutExternalProviderEnvironment(process.env);
const child = spawn(spawnCommand.command, spawnCommand.args, {
  cwd: runtime.repoRoot,
  stdio: "inherit",
  windowsVerbatimArguments: spawnCommand.windowsVerbatimArguments,
  env: {
    ...childEnvironment,
    KERNEL_DATA_DIR: process.env.KERNEL_DATA_DIR ?? path.join(home, ".codeartsdoer", "cli-data"),
    KERNEL_CONFIG_DIR: process.env.KERNEL_CONFIG_DIR ?? path.join(home, ".codeartsdoer"),
    OPENCODE_CONFIG: runtime.configPath,
    SCENARIO: "codeartsdoer",
  },
});
bindChildLifecycle(child);

function userHome(): string {
  const value = process.env.USERPROFILE?.trim() || process.env.HOME?.trim();
  if (!value) throw new Error("USERPROFILE or HOME is required to locate CodeArts.");
  return value;
}
