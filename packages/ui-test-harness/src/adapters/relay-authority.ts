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
      this.#client.replayEvents({ runId: this.options.runId, after: 0 }),
    ]);
    const last = events.events.at(-1);
    return {
      taskId: task.taskId,
      runId: task.runId,
      ...(task.projectId === undefined ? {} : { projectId: task.projectId }),
      taskStatus: task.status,
      runStatus: runStatus(last),
      eventSequence: last?.sequence ?? 0,
      ...(last === undefined ? {} : { lastEventType: last.type }),
      capturedAt: new Date().toISOString(),
    };
  }
}

function runStatus(event: { type: string; repairable?: boolean } | undefined): string {
  if (event?.type === "run.completed") return "completed";
  if (event?.type === "run.stopped") return "stopped";
  if (event?.type === "phase.failed") return event.repairable === true ? "repair" : "failed";
  return "running";
}
