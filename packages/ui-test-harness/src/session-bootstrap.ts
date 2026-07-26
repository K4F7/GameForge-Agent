import { mkdir } from "node:fs/promises";
import { FileEvidenceSink } from "./adapters/file-evidence.js";
import type { HarnessSession } from "./contracts.js";

/**
 * Creates the Evidence session before any fallible work runs, so that failures
 * reaching the harness before a scenario starts still leave a finalized record
 * on disk instead of nothing at all.
 */
export async function prepareHarnessSession<T>(options: {
  sessionRoot: string;
  session: HarnessSession;
  scenario: string;
  correlate: () => Promise<T>;
}): Promise<{ evidence: FileEvidenceSink; correlated: T }> {
  await mkdir(options.sessionRoot, { recursive: true });
  const evidence = new FileEvidenceSink(options.sessionRoot);
  await evidence.recordSession(options.session);
  try {
    return { evidence, correlated: await options.correlate() };
  } catch (error) {
    await evidence.finalize({
      status: "failed",
      scenario: options.scenario,
      startedAt: options.session.startedAt,
      finishedAt: new Date().toISOString(),
      failure: errorMessage(error),
    });
    throw error;
  }
}

function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error); }
