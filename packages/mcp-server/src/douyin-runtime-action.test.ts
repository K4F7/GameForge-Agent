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

  test("rejects reuse of one actionId for a different payload", async () => {
    let actions = 0;
    const coordinator = new DouyinRuntimeActionCoordinator({
      async runRuntimeAction(action) {
        actions += 1;
        return { action: action.action, ok: true };
      },
    });
    await coordinator.execute("action-0002", { action: "tap", x: 10, y: 20 });
    await expect(coordinator.execute("action-0002", { action: "tap", x: 11, y: 20 }))
      .rejects.toThrow("different Douyin Runtime action");
    expect(actions).toBe(1);
  });

  test("shares one in-flight simulator action across concurrent duplicate calls", async () => {
    let actions = 0;
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolveGate) => { release = resolveGate; });
    const coordinator = new DouyinRuntimeActionCoordinator({
      async runRuntimeAction() {
        actions += 1;
        await gate;
        return { action: "reload", ok: true };
      },
    });
    const first = coordinator.execute("action-0003", { action: "reload" });
    const second = coordinator.execute("action-0003", { action: "reload" });
    release?.();
    const results = await Promise.all([first, second]);
    expect(actions).toBe(1);
    expect(results.map((result) => result.replayed)).toEqual([false, true]);
  });
});
