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
  const pendingWrites: Promise<void>[] = [];
  const unsubscribe = options.tui.subscribeOutput((frame) => { pendingWrites.push(options.evidence.recordTuiOutput(frame)); });
  let started = false;
  try {
    const snapshot = await options.tui.start({ session: options.session, ...options.terminal });
    started = true;
    await options.evidence.recordTuiSnapshot(snapshot);
    await Promise.all(pendingWrites);
    return await options.correlate();
  } finally {
    unsubscribe();
    await Promise.allSettled(pendingWrites);
    if (started) await options.tui.stop("completed");
  }
}
