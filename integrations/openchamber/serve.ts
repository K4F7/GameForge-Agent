import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { bindChildLifecycle, findRepoRoot } from "../shared/runtime.js";
import { assertOpenChamberCheckout } from "./checkout.js";
import { OPENCHAMBER_PINNED_COMMIT, resolveOpenChamberIntegrationOptions } from "./config.js";

const repoRoot = await findRepoRoot(import.meta.dirname);
const options = resolveOpenChamberIntegrationOptions(process.argv.slice(2), process.env, repoRoot);
await assertOpenChamberCheckout(options.checkoutRoot, true);
await mkdir(options.dataDirectory, { recursive: true, mode: 0o700 });
const descriptor = {
  upstreamCommit: OPENCHAMBER_PINNED_COMMIT,
  baseUrl: options.baseUrl,
  codeArtsUrl: options.codeArtsUrl,
  checkoutRoot: options.checkoutRoot,
  dataDirectory: options.dataDirectory,
};
if (options.dryRun) {
  process.stdout.write(`${JSON.stringify(descriptor, null, 2)}\n`);
  process.exit(0);
}
process.stdout.write(`${JSON.stringify(descriptor, null, 2)}\n`);
const child = spawn("node", [
  path.join(options.checkoutRoot, "packages", "web", "bin", "cli.js"),
  "serve", "--foreground", "--port", String(options.port),
], {
  cwd: options.checkoutRoot,
  stdio: "inherit",
  shell: false,
  windowsHide: true,
  env: {
    ...process.env,
    OPENCHAMBER_DATA_DIR: options.dataDirectory,
    OPENCODE_HOST: options.codeArtsUrl,
    OPENCODE_SKIP_START: "true",
  },
});
bindChildLifecycle(child);
