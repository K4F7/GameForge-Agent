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
        return { accepted: batch.events.length, lastSequence: batch.after + batch.events.length };
      },
      async replayEvents(input) { return { runId: input.runId, after: input.after, events: [] }; },
    });
    const run = { runId: "run-douyin-action", after: 3 };
    await expect(coordinator.execute("action-0001", { action: "reload" }, run)).rejects.toThrow("relay unavailable");
    await expect(coordinator.execute("action-0001", { action: "reload" }, run)).resolves.toMatchObject({
      replayed: true,
      relay: { accepted: 2, lastSequence: 5 },
    });
    expect(actions).toBe(1);
    expect(publications).toBe(2);
  });

  test("shares one publication and reconciles a committed event after a lost response", async () => {
    let actions = 0;
    let publications = 0;
    let replays = 0;
    const coordinator = new DouyinRuntimeActionCoordinator({
      async runRuntimeAction() { actions += 1; return { action: "reload", ok: true }; },
    }, {
      async publishEvents() { publications += 1; throw new Error("response lost"); },
      async replayEvents(input) {
        replays += 1;
        return {
          runId: input.runId,
          after: input.after,
          events: [{
            type: "log.appended" as const,
            runId: input.runId,
            sequence: input.after + 1,
            emittedAt: "2026-07-20T12:00:00Z",
            source: "test" as const,
            level: "info" as const,
            message: "Douyin Runtime action reload (action-0004) completed.",
          }, {
            type: "douyin.devtool.status" as const,
            runId: input.runId,
            sequence: input.after + 2,
            emittedAt: "2026-07-20T12:00:00Z",
            status: "connected" as const,
            detail: "Runtime action reload completed.",
          }],
        };
      },
    });
    const run = { runId: "run-douyin-action", after: 7 };
    const [first, second] = await Promise.all([
      coordinator.execute("action-0004", { action: "reload" }, run),
      coordinator.execute("action-0004", { action: "reload" }, run),
    ]);
    expect(first.relay).toEqual({ accepted: 2, lastSequence: 9 });
    expect(second.relay).toEqual({ accepted: 2, lastSequence: 9 });
    expect({ actions, publications, replays }).toEqual({ actions: 1, publications: 1, replays: 1 });
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
