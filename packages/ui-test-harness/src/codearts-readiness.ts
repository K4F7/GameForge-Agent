import type { CodeArtsTuiDriver, EvidenceSink, HarnessSession } from "./contracts.js";

/**
 * Proves the real CodeArts TUI can reach its authorized ready screen before
 * any Authority mutation. The probe owns only this short-lived client process;
 * it never changes CodeArts authentication or private state.
 */
export async function correlateAfterCodeArtsReady<T>(options: {
  tui: CodeArtsTuiDriver;
  evidence: EvidenceSink;
  session: HarnessSession;
  terminal: { columns: number; rows: number };
  correlate: () => Promise<T>;
}): Promise<T> {
  let outputQueue = Promise.resolve();
  let outputFailure: unknown;
  const unsubscribe = options.tui.subscribeOutput((frame) => {
    outputQueue = outputQueue.then(() => options.evidence.recordTuiOutput(frame)).catch((error: unknown) => { outputFailure ??= error; });
  });
  let started = false;
  let result: T | undefined;
  let failure: unknown;
  try {
    const snapshot = await options.tui.start({ session: options.session, ...options.terminal });
    started = true;
    await options.evidence.recordTuiSnapshot(snapshot);
    await outputQueue;
    if (outputFailure !== undefined) { const error = outputFailure; outputFailure = undefined; throw error; }
    result = await options.correlate();
  } catch (error) {
    failure = error;
  } finally {
    unsubscribe();
    await outputQueue;
    if (outputFailure !== undefined) failure = combineFailure(failure, "TUI output evidence failed", outputFailure);
    if (started) {
      try { await options.tui.stop(failure === undefined ? "completed" : "failed"); }
      catch (error) { failure = combineFailure(failure, "TUI cleanup failed", error); }
    }
  }
  if (failure !== undefined) throw failure;
  return result as T;
}

function combineFailure(primary: unknown, label: string, secondary: unknown): Error {
  const secondaryMessage = secondary instanceof Error ? secondary.message : String(secondary);
  if (primary === undefined) return new Error(`${label}: ${secondaryMessage}`);
  const primaryMessage = primary instanceof Error ? primary.message : String(primary);
  return new Error(`${primaryMessage}; ${label}: ${secondaryMessage}`, { cause: primary });
}
