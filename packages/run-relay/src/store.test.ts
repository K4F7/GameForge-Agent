import { describe, expect, it } from "vitest";
import { RunStore } from "./store.js";

const emittedAt = "2026-07-16T06:00:00+08:00";

describe("RunStore", () => {
  it("creates, appends, replays, and completes a run", () => {
    const store = new RunStore();
    expect(store.create("run-1")).toMatchObject({ type: "run.started", sequence: 1 });
    store.append("run-1", {
      runId: "run-1",
      after: 1,
      events: [{
        type: "phase.started",
        runId: "run-1",
        sequence: 2,
        emittedAt,
        phase: "spec",
        detail: "Validating",
      }],
    });
    expect(store.replay("run-1", 1).events).toHaveLength(1);
    expect(store.finish("run-1", "run.completed")).toMatchObject({ sequence: 3 });
    expect(() => store.append("run-1", { runId: "run-1", after: 3, events: [] })).toThrow("terminal");
  });

  it("retains a task language on the start event while preserving generic runs", () => {
    const store = new RunStore();
    expect(store.create("run-english", "en-US")).toMatchObject({ language: "en-US" });
    expect(store.replay("run-english", 0).events[0]).toMatchObject({ language: "en-US" });
    expect(store.create("run-generic")).not.toHaveProperty("language");
  });

  it("rejects stale append cursors and client-created start events", () => {
    const store = new RunStore();
    store.create("run-1");
    expect(() => store.append("run-1", { runId: "run-1", after: 0, events: [] })).toThrow("Expected append cursor 1");
    expect(() => store.append("run-1", {
      runId: "run-1",
      after: 1,
      events: [{ type: "run.started", runId: "run-1", sequence: 2, emittedAt }],
    })).toThrow("only be created by the relay");
  });

  it("rejects a batch containing events after completion without partial writes", () => {
    const store = new RunStore();
    store.create("run-1");
    expect(() => store.append("run-1", {
      runId: "run-1",
      after: 1,
      events: [
        { type: "run.completed", runId: "run-1", sequence: 2, emittedAt },
        {
          type: "log.appended",
          runId: "run-1",
          sequence: 3,
          emittedAt,
          source: "agent",
          level: "info",
          message: "Too late",
        },
      ],
    })).toThrow("after a terminal event");
    expect(store.replay("run-1", 0).events).toHaveLength(1);
  });

  it("notifies subscribers after events are committed", () => {
    const store = new RunStore();
    store.create("run-1");
    const received: number[] = [];
    const unsubscribe = store.subscribe("run-1", (event) => received.push(event.sequence));
    store.finish("run-1", "run.stopped");
    unsubscribe();
    expect(received).toEqual([2]);
  });

  it("keeps stored history immutable from returned and subscribed event mutations", () => {
    const store = new RunStore();
    const started = store.create("run-immutable");
    try { (started as { runId: string }).runId = "mutated-start"; } catch {}

    store.subscribe("run-immutable", (event) => {
      if (event.type === "verification.ready") {
        try { event.criteria![0]!.criterionId = "mutated-subscriber"; } catch {}
      }
      if (event.type === "run.completed") {
        try { (event as { runId: string }).runId = "mutated-subscriber"; } catch {}
      }
    });
    const appended = store.append("run-immutable", {
      runId: "run-immutable",
      after: 1,
      events: [{
        type: "verification.ready",
        runId: "run-immutable",
        sequence: 2,
        emittedAt,
        projectId: "safety-sprint",
        passed: true,
        outcome: "won",
        score: 5,
        lives: 2,
        remainingSeconds: 31.5,
        evidencePath: ".gameforge/verification/proof.png",
        evidenceSha256: "e".repeat(64),
        canvas: { width: 960, height: 540 },
        diagnostics: { consoleErrors: 0, pageErrors: 0, failedRequests: 0 },
        actionsExecuted: 12,
        durationMs: 2_500,
        criteria: [{ criterionId: "goal", passed: true }],
      }],
    });
    const appendedEvent = appended[0];
    if (appendedEvent?.type !== "verification.ready") throw new Error("expected verification event");
    try { appendedEvent.criteria![0]!.passed = false; } catch {}

    const completed = store.finish("run-immutable", "run.completed");
    try { (completed as { runId: string }).runId = "mutated-finish"; } catch {}

    expect(store.authoritativeEvents("run-immutable")).toMatchObject([
      { type: "run.started", runId: "run-immutable", sequence: 1 },
      { type: "verification.ready", runId: "run-immutable", sequence: 2, criteria: [{ criterionId: "goal", passed: true }] },
      { type: "run.completed", runId: "run-immutable", sequence: 3 },
    ]);
    expect(store.replay("run-immutable", 0).events).toHaveLength(3);
  });

  it("stores and replays a validated preview artifact event", () => {
    const store = new RunStore();
    store.create("run-1");
    store.append("run-1", {
      runId: "run-1",
      after: 1,
      events: [{
        type: "preview.ready",
        runId: "run-1",
        sequence: 2,
        emittedAt,
        projectId: "safety-sprint",
        url: "http://127.0.0.1:5173/",
      }],
    });
    expect(store.replay("run-1", 1).events).toEqual([expect.objectContaining({
      type: "preview.ready",
      projectId: "safety-sprint",
      url: "http://127.0.0.1:5173/",
    })]);
  });

  it("rejects restored runs whose event sequence or terminal status is inconsistent", () => {
    const started = { type: "run.started" as const, runId: "run-1", sequence: 1, emittedAt };
    expect(() => new RunStore().restore({ schemaVersion: 2, runs: [{
      runId: "run-1", status: "running", started,
      events: [started, { type: "run.completed", runId: "run-1", sequence: 2, emittedAt }],
    }] })).toThrow("status");
    expect(() => new RunStore().restore({ schemaVersion: 2, runs: [{
      runId: "run-1", status: "running", started,
      events: [started, { type: "phase.started", runId: "run-1", sequence: 3, emittedAt, phase: "spec", detail: "invalid gap" }],
    }] })).toThrow("contiguous");
    expect(() => new RunStore().restore({ schemaVersion: 2, runs: [{
      runId: "run-1", status: "repair", started, events: [started],
    }] })).toThrow("status");
  });

  it("rejects legacy snapshots that cannot prove retained events are complete authoritative history", () => {
    const started = { type: "run.started" as const, runId: "run-legacy", sequence: 1, emittedAt };
    const retainedEvents = [
      ...Array.from({ length: 9 }, (_, index) => ({
        type: "log.appended" as const,
        runId: "run-legacy",
        sequence: index + 3,
        emittedAt,
        source: "agent" as const,
        level: "info" as const,
        message: `Retained event ${index + 3}`,
      })),
      { type: "run.completed" as const, runId: "run-legacy", sequence: 12, emittedAt },
    ];

    expect(() => new RunStore({ maxEventsPerRun: 10 }).restore({
      runs: [{ runId: "run-legacy", status: "succeeded", started, events: retainedEvents }],
    })).toThrow("legacy");
  });

  it("preserves complete authoritative history after replay retention expires and across restore", () => {
    const store = new RunStore({ maxEventsPerRun: 10 });
    store.create("run-1");
    for (let sequence = 2; sequence <= 11; sequence += 1) {
      store.append("run-1", {
        runId: "run-1",
        after: sequence - 1,
        events: [{
          type: "log.appended",
          runId: "run-1",
          sequence,
          emittedAt,
          source: "agent",
          level: "info",
          message: `Event ${sequence}`,
        }],
      });
    }
    store.finish("run-1", "run.completed");

    expect(() => store.replay("run-1", 0)).toThrow("no longer retained");
    expect(store.authoritativeEvents("run-1").map((event) => event.sequence))
      .toEqual(Array.from({ length: 12 }, (_, index) => index + 1));

    const snapshot = store.snapshot();
    expect(snapshot.runs[0]?.events).toHaveLength(12);
    expect(snapshot.runs[0]).not.toHaveProperty("authoritativeEvents");

    const restored = new RunStore({ maxEventsPerRun: 10 });
    restored.restore(snapshot);
    expect(restored.authoritativeEvents("run-1")).toEqual(store.authoritativeEvents("run-1"));
    expect(() => restored.replay("run-1", 0)).toThrow("no longer retained");
  });

  it("rejects authoritative history before it exceeds its bounded capacity", () => {
    const store = new RunStore({ maxEventsPerRun: 10 });
    store.create("run-capacity");
    for (let batchNumber = 0; batchNumber < 99; batchNumber += 1) {
      const events = Array.from({ length: 1_000 }, (_, index) => {
        const sequence = batchNumber * 1_000 + index + 2;
        return {
          type: "log.appended" as const,
          runId: "run-capacity",
          sequence,
          emittedAt,
          source: "agent" as const,
          level: "info" as const,
          message: `Event ${sequence}`,
        };
      });
      store.append("run-capacity", {
        runId: "run-capacity",
        after: batchNumber * 1_000 + 1,
        events,
      });
    }
    const finalEvents = Array.from({ length: 998 }, (_, index) => {
      const sequence = 99_001 + index + 1;
      return {
        type: "log.appended" as const,
        runId: "run-capacity",
        sequence,
        emittedAt,
        source: "agent" as const,
        level: "info" as const,
        message: `Event ${sequence}`,
      };
    });
    store.append("run-capacity", { runId: "run-capacity", after: 99_001, events: finalEvents });

    expect(() => store.append("run-capacity", {
      runId: "run-capacity",
      after: 99_999,
      events: [{
        type: "log.appended",
        runId: "run-capacity",
        sequence: 100_000,
        emittedAt,
        source: "agent",
        level: "info",
        message: "Over capacity",
      }],
    })).toThrow("capacity");
    expect(store.finish("run-capacity", "run.completed")).toMatchObject({ sequence: 100_000 });
  });
});
