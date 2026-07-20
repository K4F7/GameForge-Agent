#!/usr/bin/env node

import { PlaywrightVerificationRuntime } from "./verifier.js";
import { classifyBrowserDoctorError } from "./browser-doctor-core.js";

const executablePath = process.env.GAMEFORGE_CHROME_EXECUTABLE?.trim();
const startedAt = Date.now();
const report: Record<string, unknown> = {
  runtime: { node: process.version, bun: process.versions.bun ?? null },
  mode: executablePath === undefined || executablePath.length === 0 ? "channel:chrome" : "configured-executable",
};
try {
  const runtime = new PlaywrightVerificationRuntime(
    executablePath === undefined || executablePath.length === 0 ? undefined : executablePath,
  );
  const session = await runtime.startSession("http://127.0.0.1:1");
  await session.close();
  report.ok = true;
} catch (error) {
  report.ok = false;
  report.issue = classifyBrowserDoctorError(error);
  process.exitCode = 1;
} finally {
  report.elapsedMs = Date.now() - startedAt;
  console.log(JSON.stringify(report, null, 2));
}
