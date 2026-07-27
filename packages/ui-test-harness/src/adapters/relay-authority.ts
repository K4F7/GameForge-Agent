import { RunRelayClient } from "@gameforge/run-relay/client";
import type { AuthoritySnapshot, GameForgeAuthorityDriver } from "../contracts.js";

export type RelayAuthorityOptions = {
  baseUrl: string;
  taskId: string;
  runId: string;
  projectId?: string;
  authToken?: string;
};

export class RelayAuthorityDriver implements GameForgeAuthorityDriver {
  readonly kind = "gameforge-authority" as const;
  readonly #client: RunRelayClient;
  #lastEvent: Awaited<ReturnType<RunRelayClient["replayEvents"]>>["events"][number] | undefined;

  constructor(private readonly options: RelayAuthorityOptions) {
    this.#client = new RunRelayClient({
      baseUrl: options.baseUrl,
      timeoutMilliseconds: 10_000,
      ...(options.authToken === undefined ? {} : { authToken: options.authToken }),
    });
  }

  async snapshot(): Promise<AuthoritySnapshot> {
    const [task, events] = await Promise.all([
      this.#client.getTask(this.options.taskId),
      this.#replayNew(),
    ]);
    if (task.runId !== this.options.runId) {
      throw new Error(`Authority Run mismatch: expected ${this.options.runId}, received ${task.runId}`);
    }
    if (this.options.projectId !== undefined && task.projectId !== this.options.projectId) {
      throw new Error(`Authority Project mismatch: expected ${this.options.projectId}, received ${task.projectId ?? "<none>"}`);
    }
    const candidate = events.at(-1);
    const last = candidate !== undefined && candidate.sequence > (this.#lastEvent?.sequence ?? 0)
      ? candidate
      : this.#lastEvent;
    this.#lastEvent = last;
    return {
      taskId: task.taskId,
      runId: task.runId,
      ...(task.projectId === undefined ? {} : { projectId: task.projectId }),
      taskStatus: task.status,
      ...(task.claimedBy === undefined ? {} : { claimedBy: task.claimedBy }),
      runStatus: runStatus(last),
      eventSequence: last?.sequence ?? 0,
      ...(last === undefined ? {} : { lastEventType: last.type }),
      capturedAt: new Date().toISOString(),
    };
  }

  async #replayNew() {
    const events = [] as Awaited<ReturnType<RunRelayClient["replayEvents"]>>["events"];
    let after = this.#lastEvent?.sequence ?? 0;
    while (true) {
      const page = await this.#client.replayEvents({ runId: this.options.runId, after });
      events.push(...page.events);
      if (page.events.length < 1_000) return events;
      after = page.events.at(-1)!.sequence;
    }
  }
}

function runStatus(event: { type: string; repairable?: boolean } | undefined): string {
  if (event?.type === "run.completed") return "completed";
  if (event?.type === "run.stopped") return "stopped";
  if (event?.type === "phase.failed") return event.repairable === true ? "repair" : "failed";
  return "running";
}
