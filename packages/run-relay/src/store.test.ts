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
});
