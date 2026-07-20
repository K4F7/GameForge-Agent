import type { RunRelayToolClient } from "./tools.js";
import type { DouyinBridgeController, DouyinRuntimeAction } from "./douyin-bridge-controller.js";

export interface DouyinRuntimeActionRunContext { runId: string; after: number }

export class DouyinRuntimeActionCoordinator {
  private readonly actions = new Map<string, { fingerprint: string; result: Promise<Record<string, unknown>> }>();

  constructor(
    private readonly controller: Pick<DouyinBridgeController, "runRuntimeAction">,
    private readonly relay?: Pick<RunRelayToolClient, "publishEvents">,
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
    const relay = await this.relay!.publishEvents({
      runId: run.runId,
      after: run.after,
      events: [{
        type: "log.appended",
        runId: run.runId,
        sequence: run.after + 1,
        emittedAt: new Date().toISOString(),
        source: "test",
        level: result.ok === false ? "error" : "info",
        message: `Douyin Runtime action ${action.action} (${actionId}) ${result.ok === false ? "failed" : "completed"}.`,
      }],
    });
    return { result, relay, replayed };
  }
}
