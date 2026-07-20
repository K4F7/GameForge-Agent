import { describe, expect, test } from "vitest";
import { DouyinRuntimeActionCoordinator } from "./douyin-runtime-action.js";

describe("DouyinRuntimeActionCoordinator", () => {
  test("retries Relay publication without repeating a mutating simulator action", async () => {
    let actions = 0;
    let publications = 0;
    const coordinator = new DouyinRuntimeActionCoordinator({
      async runRuntimeAction() {
        actions += 1;
        return { action: "reload", ok: true, remoteOperations: "forbidden" };
      },
    }, {
      async publishEvents(batch) {
        publications += 1;
        if (publications === 1) throw new Error("relay unavailable");
        return { accepted: batch.events.length, lastSequence: batch.after + 1 };
      },
    });
    const run = { runId: "run-douyin-action", after: 3 };
    await expect(coordinator.execute("action-0001", { action: "reload" }, run)).rejects.toThrow("relay unavailable");
    await expect(coordinator.execute("action-0001", { action: "reload" }, run)).resolves.toMatchObject({
      replayed: true,
      relay: { accepted: 1, lastSequence: 4 },
    });
    expect(actions).toBe(1);
    expect(publications).toBe(2);
  });
});
