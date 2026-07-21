import type { CreateGameTaskRequest } from "@gameforge/contracts";
import { describe, expect, it } from "vitest";
import { RunStore } from "./store.js";
import { TaskInbox } from "./tasks.js";

describe("TaskInbox", () => {
  it("atomically creates a queued task and its run", () => {
    const runs = new RunStore();
    const inbox = new TaskInbox(runs);
    const created = inbox.create({
      runId: "run-1",
      prompt: "制作一个可以收集装备并避开危险的小游戏。",
      language: "zh-CN",
      requestedSpecialists: ["programmer", "artist"],
    });
    expect(created.task).toMatchObject({
      runId: "run-1",
      status: "queued",
      requestedSpecialists: ["programmer", "artist"],
    });
    expect(created.event).toMatchObject({
      type: "run.started",
      runId: "run-1",
      sequence: 1,
      language: "zh-CN",
    });
    expect(runs.replay("run-1", 0).events).toHaveLength(1);
  });

  it("returns the authoritative task for an identical create retry and rejects changed content", () => {
    const inbox = new TaskInbox(new RunStore());
    const input: CreateGameTaskRequest = {
      runId: "run-retry",
      prompt: "Create a browser game with an idempotent task handoff.",
      language: "en-US",
      projectId: "managed-game",
      requestedSpecialists: ["artist", "programmer"],
    };
    const first = inbox.create(input);
    const retried = inbox.create(input);
    expect(retried).toEqual(first);
    expect(retried.task.projectId).toBe("managed-game");
    expect(retried.task.requestedSpecialists).toEqual(["programmer", "artist"]);
    expect(inbox.create({ ...input, requestedSpecialists: ["programmer", "artist"] })).toEqual(first);
    expect(() => inbox.create({ ...input, projectId: "another-game" }))
      .toThrow("different task request");
    expect(() => inbox.create({ ...input, prompt: "Create a different browser game." }))
      .toThrow("different task request");
    expect(() => inbox.create({ ...input, requestedSpecialists: ["tester"] }))
      .toThrow("different task request");
  });

  it("lists newest tasks and claims once per agent", () => {
    const inbox = new TaskInbox(new RunStore());
    const first = inbox.create({ runId: "run-1", prompt: "Create a complete browser arcade game.", language: "en-US" });
    const second = inbox.create({ runId: "run-2", prompt: "Create another complete browser game.", language: "en-US" });
    expect(inbox.list({ status: "queued", limit: 1 }).map((task) => task.taskId)).toEqual([second.task.taskId]);
    expect(inbox.claim(first.task.taskId, { agentId: "codearts" })).toMatchObject({
      status: "claimed",
      claimedBy: "codearts",
    });
    expect(inbox.claim(first.task.taskId, { agentId: "codearts" })).toMatchObject({ status: "claimed" });
    expect(() => inbox.claim(first.task.taskId, { agentId: "other-agent" })).toThrow("another agent");
  });

  it("tracks run completion and prevents terminal claims", () => {
    const inbox = new TaskInbox(new RunStore());
    const created = inbox.create({ runId: "run-1", prompt: "Create a complete browser arcade game.", language: "en-US" });
    inbox.claim(created.task.taskId, { agentId: "codearts" });
    inbox.finishRun("run-1", "run.completed");
    expect(inbox.get(created.task.taskId)).toMatchObject({ status: "completed" });
    expect(() => inbox.claim(created.task.taskId, { agentId: "codearts" })).toThrow("Terminal");
  });

  it("rejects completion before claim without terminating the run", () => {
    const runs = new RunStore();
    const inbox = new TaskInbox(runs);
    const created = inbox.create({
      runId: "run-1",
      prompt: "Create a complete browser arcade game.",
      language: "en-US",
    });
    expect(() => inbox.finishRun("run-1", "run.completed")).toThrow("claimed before completion");
    expect(inbox.get(created.task.taskId)).toMatchObject({ status: "queued" });
    expect(() => inbox.appendRun("run-1", {
      runId: "run-1",
      after: 1,
      events: [],
    })).toThrow("claimed before events");
    expect(inbox.finishRun("run-1", "run.stopped")).toMatchObject({ type: "run.stopped" });
  });

  it("synchronizes an unrecoverable phase failure to the task", () => {
    const inbox = new TaskInbox(new RunStore());
    const created = inbox.create({
      runId: "run-1",
      prompt: "Create a complete browser arcade game.",
      language: "en-US",
    });
    inbox.claim(created.task.taskId, { agentId: "codearts" });
    inbox.appendRun("run-1", {
      runId: "run-1",
      after: 1,
      events: [{
        type: "phase.failed",
        runId: "run-1",
        sequence: 2,
        emittedAt: "2026-07-16T08:00:00Z",
        phase: "build",
        message: "Build cannot continue.",
        repairable: false,
      }],
    });
    expect(inbox.get(created.task.taskId)).toMatchObject({ status: "failed" });
  });
});
