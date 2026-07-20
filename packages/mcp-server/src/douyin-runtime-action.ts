import type { RunRelayToolClient } from "./tools.js";
import type { DouyinBridgeController, DouyinRuntimeAction } from "./douyin-bridge-controller.js";

export interface DouyinRuntimeActionRunContext { runId: string; after: number }

export class DouyinRuntimeActionCoordinator {
  private readonly results = new Map<string, Record<string, unknown>>();

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
    const cached = this.results.get(actionId);
    const replayed = cached !== undefined;
    const result = cached ?? await this.controller.runRuntimeAction(action);
    if (!replayed) {
      if (this.results.size >= 256) this.results.delete(this.results.keys().next().value as string);
      this.results.set(actionId, result);
    }
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
