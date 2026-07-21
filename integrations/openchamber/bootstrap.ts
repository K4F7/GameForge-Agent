import { findRepoRoot } from "../shared/runtime.js";
import { bootstrapOpenChamberCheckout } from "./checkout.js";
import { OPENCHAMBER_PINNED_COMMIT, OPENCHAMBER_UPSTREAM_URL, resolveOpenChamberIntegrationOptions } from "./config.js";

const repoRoot = await findRepoRoot(import.meta.dirname);
const options = resolveOpenChamberIntegrationOptions(process.argv.slice(2), process.env, repoRoot);
if (options.dryRun) {
  process.stdout.write(`${JSON.stringify({ upstream: OPENCHAMBER_UPSTREAM_URL, commit: OPENCHAMBER_PINNED_COMMIT, checkoutRoot: options.checkoutRoot }, null, 2)}\n`);
} else {
  await bootstrapOpenChamberCheckout(options.checkoutRoot);
  process.stdout.write(`OpenChamber ${OPENCHAMBER_PINNED_COMMIT} is built at ${options.checkoutRoot}\n`);
}
