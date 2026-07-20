import type { RunRelayToolClient } from "./tools.js";
import type { DouyinBridgeController, DouyinRuntimeAction } from "./douyin-bridge-controller.js";

export interface DouyinRuntimeActionRunContext { runId: string; after: number }

export class DouyinRuntimeActionCoordinator {
  private readonly actions = new Map<string, { fingerprint: string; result: Promise<Record<string, unknown>> }>();
  private readonly publications = new Map<string, { fingerprint: string; result: Promise<{ accepted: number; lastSequence?: number }> }>();

  constructor(
    private readonly controller: Pick<DouyinBridgeController, "runRuntimeAction">,
    private readonly relay?: Pick<RunRelayToolClient, "publishEvents" | "replayEvents">,
  ) {}

  async execute(actionId: string, action: DouyinRuntimeAction, run?: DouyinRuntimeActionRunContext): Promise<{
    result: Record<string, unknown>;
    relay?: { accepted: number; lastSequence?: number };
    replayed: boolean;
  }> {
    if (run !== undefined && this.relay === undefined) throw new Error("A configured Run Relay is required when runId and after are supplied.");
    const fingerprint = JSON.stringify(action);
    const existing = this.actions.get(actionId);
    if (existing !== undefined && existing.fingerprint !== fingerprint) {
      throw new Error("actionId is already bound to a different Douyin Runtime action.");
    }
    const replayed = existing !== undefined;
    let resultPromise = existing?.result;
    if (resultPromise === undefined) {
      if (this.actions.size >= 256) this.actions.delete(this.actions.keys().next().value as string);
      resultPromise = this.controller.runRuntimeAction(action);
      this.actions.set(actionId, { fingerprint, result: resultPromise });
      void resultPromise.catch(() => {
        if (this.actions.get(actionId)?.result === resultPromise) this.actions.delete(actionId);
      });
    }
    const result = await resultPromise;
    if (run === undefined) return { result, replayed };
    const publicationFingerprint = `${run.runId}:${run.after}`;
    const existingPublication = this.publications.get(actionId);
    if (existingPublication !== undefined && existingPublication.fingerprint !== publicationFingerprint) {
      throw new Error("actionId is already bound to a different Run Relay cursor.");
    }
    let publicationPromise = existingPublication?.result;
    if (publicationPromise === undefined) {
      const event = {
        type: "log.appended",
        runId: run.runId,
        sequence: run.after + 1,
        emittedAt: new Date().toISOString(),
        source: "test",
        level: result.ok === false ? "error" : "info",
        message: `Douyin Runtime action ${action.action} (${actionId}) ${result.ok === false ? "failed" : "completed"}.`,
      } as const;
      publicationPromise = this.relay!.publishEvents({ runId: run.runId, after: run.after, events: [event] })
        .catch(async (error) => {
          const replay = await this.relay!.replayEvents({ runId: run.runId, after: run.after });
          const committed = replay.events.some((candidate) =>
            candidate.sequence === event.sequence && candidate.type === "log.appended" && candidate.message === event.message);
          if (committed) return { accepted: 1, lastSequence: event.sequence };
          throw error;
        });
      this.publications.set(actionId, { fingerprint: publicationFingerprint, result: publicationPromise });
      void publicationPromise.catch(() => {
        if (this.publications.get(actionId)?.result === publicationPromise) this.publications.delete(actionId);
      });
    }
    const relay = await publicationPromise;
    return { result, relay, replayed };
  }
}
