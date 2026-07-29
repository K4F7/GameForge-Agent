import { describe, expect, it } from "vitest";
import type { GameTask } from "@gameforge/contracts";
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
    });
    expect(created.task).toMatchObject({ runId: "run-1", status: "queued" });
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
    const input = {
      runId: "run-retry",
      prompt: "Create a browser game with an idempotent task handoff.",
      language: "en-US" as const,
      projectId: "managed-game",
    };
    const first = inbox.create(input);
    const retried = inbox.create(input);
    expect(retried).toEqual(first);
    expect(retried.task.projectId).toBe("managed-game");
    expect(() => inbox.create({ ...input, projectId: "another-game" }))
      .toThrow("different task request");
    expect(() => inbox.create({ ...input, prompt: "Create a different browser game." }))
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

  it("freezes the initial acceptance contract after claim but before implementation starts", () => {
    const inbox = new TaskInbox(new RunStore());
    const taskId = inbox.create({
      runId: "run-claimed-acceptance",
      prompt: "Create a browser game with acceptance frozen before implementation.",
      language: "en-US",
    }).task.taskId;
    inbox.claim(taskId, { agentId: "codearts" });

    expect(inbox.compileAcceptanceContract(taskId, taskAcceptanceInput()))
      .toMatchObject({
        outcome: "frozen",
        task: { status: "claimed", claimedBy: "codearts" },
        contract: { contractVersion: 1 },
      });
  });

  it("rejects implementation start until the acceptance contract is frozen", () => {
    const inbox = new TaskInbox(new RunStore());
    const taskId = inbox.create({
      runId: "run-missing-acceptance",
      prompt: "Create a browser game only after acceptance is frozen.",
      language: "en-US",
    }).task.taskId;
    inbox.claim(taskId, { agentId: "codearts" });

    const result = inbox.transition(taskId, { status: "in-progress", agentId: "codearts" });
    expect(result).toMatchObject({
      outcome: "rejected",
      code: "missing-acceptance-contract",
      task: { status: "claimed" },
    });
    expect(result.task).not.toHaveProperty("acceptanceContract");
  });

  it("releases a claimed task when ambiguous acceptance moves it to needs-info", () => {
    const inbox = new TaskInbox(new RunStore());
    const taskId = inbox.create({
      runId: "run-claimed-ambiguous",
      prompt: "Create a browser game after ambiguous requirements are clarified.",
      language: "en-US",
    }).task.taskId;
    inbox.claim(taskId, { agentId: "codearts" });

    expect(inbox.compileAcceptanceContract(taskId, {
      contractVersion: 1,
      criteria: [],
      requirementIssues: [{ code: "assumption-dependent", detail: "The win condition is unclear." }],
    })).toMatchObject({
      outcome: "needs-info",
      task: {
        status: "needs-info",
        reasonCode: { code: "requirements-ambiguous" },
      },
    });
    expect(inbox.get(taskId)).toMatchObject({ claimedBy: undefined, claimedAt: undefined });
  });

  it("does not infer Task completion from transport Run completion", () => {
    const inbox = new TaskInbox(new RunStore());
    const created = inbox.create({ runId: "run-1", prompt: "Create a complete browser arcade game.", language: "en-US" });
    inbox.claim(created.task.taskId, { agentId: "codearts" });
    inbox.finishRun("run-1", "run.completed");
    expect(inbox.get(created.task.taskId)).toMatchObject({ status: "claimed" });
    expect(inbox.claim(created.task.taskId, { agentId: "codearts" })).toMatchObject({ status: "claimed" });
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

  it("does not classify Task retryability from a Run message or repairable flag", () => {
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
    expect(inbox.get(created.task.taskId)).toMatchObject({ status: "claimed" });
    expect(inbox.get(created.task.taskId)).not.toHaveProperty("reasonCode");
  });

  it("resumes needs-info and retryable Tasks only through the explicit queue and claim path", () => {
    const inbox = new TaskInbox(new RunStore());
    const created = inbox.create({
      runId: "run-lifecycle",
      prompt: "Create a browser game through an explicit lifecycle.",
      language: "en-US",
    });

    expect(inbox.transition(created.task.taskId, {
      status: "needs-info",
      reasonCode: { schemaVersion: "1.0", code: "requirements-ambiguous" },
    })).toMatchObject({ outcome: "accepted", task: { status: "needs-info" } });
    expect(inbox.transition(created.task.taskId, { status: "queued" }))
      .toMatchObject({ outcome: "accepted", task: { status: "queued", reasonCode: undefined } });
    inbox.claim(created.task.taskId, { agentId: "codearts" });
    inbox.compileAcceptanceContract(created.task.taskId, taskAcceptanceInput());
    expect(inbox.transition(created.task.taskId, { status: "in-progress", agentId: "codearts" }))
      .toMatchObject({ outcome: "accepted", task: { status: "in-progress" } });
    expect(inbox.transition(created.task.taskId, {
      status: "retryable",
      agentId: "codearts",
      reasonCode: { schemaVersion: "1.0", code: "bounded-timeout" },
    })).toMatchObject({ outcome: "accepted", task: { status: "retryable" } });

    expect(inbox.transition(created.task.taskId, { status: "queued", agentId: "codearts" }))
      .toMatchObject({ outcome: "accepted", task: { status: "queued", claimedBy: undefined } });
    expect(inbox.claim(created.task.taskId, { agentId: "new-attempt-agent" }))
      .toMatchObject({ status: "claimed", claimedBy: "new-attempt-agent" });
  });

  it("allows only the claimant to transition owned work", () => {
    const inbox = new TaskInbox(new RunStore());
    const taskId = inbox.create({
      runId: "run-claimant-transition",
      prompt: "Create a browser game with claimant-bound lifecycle transitions.",
      language: "en-US",
    }).task.taskId;
    inbox.claim(taskId, { agentId: "codearts" });
    inbox.compileAcceptanceContract(taskId, taskAcceptanceInput());

    expect(inbox.transition(taskId, { status: "in-progress", agentId: "other-agent" }))
      .toMatchObject({ outcome: "rejected", code: "claimant-mismatch", task: { status: "claimed" } });
    expect(inbox.transition(taskId, { status: "in-progress", agentId: "codearts" }))
      .toMatchObject({ outcome: "accepted", task: { status: "in-progress" } });
  });

  it.each(["completed", "failed", "canceled", "conflicted"] as const)(
    "requires the transport Run to finish before accepting a %s Task transition",
    (status) => {
      const runs = new RunStore();
      const inbox = new TaskInbox(runs);
      const taskId = inbox.create({
        runId: `run-terminal-order-${status}`,
        prompt: "Create a browser game with consistent terminal authority.",
        language: "en-US",
      }).task.taskId;
      inbox.claim(taskId, { agentId: "codearts" });
      inbox.compileAcceptanceContract(taskId, taskAcceptanceInput());
      inbox.transition(taskId, { status: "in-progress", agentId: "codearts" });
      const transition = transitionTo(status, "codearts");

      expect(inbox.transition(taskId, transition))
        .toMatchObject({ outcome: "rejected", code: "run-state-mismatch", task: { status: "in-progress" } });
      prepareRunForTransition(inbox, taskId, status);
      expect(inbox.transition(taskId, transition))
        .toMatchObject({ outcome: "accepted", task: { status } });
    },
  );

  it("accepts only the conservative public Task transition matrix", () => {
    const statuses = [
      "queued",
      "needs-info",
      "claimed",
      "in-progress",
      "retryable",
      "completed",
      "failed",
      "canceled",
      "conflicted",
    ] as const satisfies ReadonlyArray<GameTask["status"]>;
    const accepted = new Set([
      "queued>needs-info",
      "queued>claimed",
      "queued>canceled",
      "needs-info>queued",
      "needs-info>canceled",
      "claimed>in-progress",
      "claimed>canceled",
      "in-progress>retryable",
      "in-progress>completed",
      "in-progress>failed",
      "in-progress>canceled",
      "in-progress>conflicted",
      "retryable>queued",
      "retryable>canceled",
    ]);

    let sequence = 0;
    for (const from of statuses) {
      for (const to of statuses) {
        sequence += 1;
        const { inbox, taskId } = taskAt(from, sequence);
        if (accepted.has(`${from}>${to}`)) prepareRunForTransition(inbox, taskId, to);
        const outcome = from === "queued" && to === "claimed"
          ? (inbox.claim(taskId, { agentId: "matrix-agent" }), "accepted")
          : inbox.transition(taskId, transitionTo(to, "source-agent")).outcome;
        expect(outcome, `${from}>${to}`).toBe(accepted.has(`${from}>${to}`) ? "accepted" : "rejected");
      }
    }
  });

  it("rejects illegal and mismatched transitions without changing Task bytes", () => {
    const inbox = new TaskInbox(new RunStore());
    const taskId = inbox.create({
      runId: "run-rejected-transition",
      prompt: "Create a browser game whose rejected Task remains unchanged.",
      language: "en-US",
    }).task.taskId;
    const before = JSON.stringify(inbox.get(taskId));

    expect(inbox.transition(taskId, { status: "completed" }))
      .toMatchObject({ outcome: "rejected", code: "illegal-transition" });
    expect(JSON.stringify(inbox.get(taskId))).toBe(before);
    expect(inbox.transition(taskId, {
      status: "needs-info",
      reasonCode: { schemaVersion: "1.0", code: "bounded-timeout" },
    })).toMatchObject({ outcome: "rejected", code: "reason-code-mismatch" });
    expect(JSON.stringify(inbox.get(taskId))).toBe(before);
  });
});

function taskAt(status: GameTask["status"], sequence: number): { inbox: TaskInbox; taskId: string } {
  const inbox = new TaskInbox(new RunStore());
  const taskId = inbox.create({
    runId: `run-matrix-${sequence}`,
    prompt: "Create a browser game for lifecycle matrix verification.",
    language: "en-US",
  }).task.taskId;
  if (status === "queued") return { inbox, taskId };
  if (status === "needs-info") {
    inbox.transition(taskId, transitionTo("needs-info"));
    return { inbox, taskId };
  }
  if (status === "canceled") {
    inbox.finishRun(`run-matrix-${sequence}`, "run.stopped");
    inbox.transition(taskId, transitionTo("canceled"));
    return { inbox, taskId };
  }
  inbox.claim(taskId, { agentId: "source-agent" });
  inbox.compileAcceptanceContract(taskId, taskAcceptanceInput());
  if (status === "claimed") return { inbox, taskId };
  inbox.transition(taskId, transitionTo("in-progress", "source-agent"));
  if (status === "in-progress") return { inbox, taskId };
  prepareRunForTransition(inbox, taskId, status);
  inbox.transition(taskId, transitionTo(status, "source-agent"));
  return { inbox, taskId };
}

function prepareRunForTransition(inbox: TaskInbox, taskId: string, status: GameTask["status"]): void {
  const runId = inbox.get(taskId).runId;
  if (status === "completed") {
    inbox.finishRun(runId, "run.completed");
  } else if (status === "canceled" || status === "conflicted") {
    inbox.finishRun(runId, "run.stopped");
  } else if (status === "failed") {
    inbox.appendRun(runId, {
      runId,
      after: 1,
      events: [{
        type: "phase.failed",
        runId,
        sequence: 2,
        emittedAt: "2026-07-16T08:00:00Z",
        phase: "build",
        message: "Build failed terminally.",
        repairable: false,
      }],
    });
  }
}

function transitionTo(status: GameTask["status"], agentId?: string): Record<string, unknown> {
  const reasonCode = status === "needs-info" ? "requirements-ambiguous"
    : status === "retryable" ? "bounded-timeout"
    : status === "failed" ? "schema-violation"
    : status === "canceled" ? "cancellation"
    : status === "conflicted" ? "stale-base-conflict"
    : undefined;
  return {
    status,
    ...(agentId === undefined ? {} : { agentId }),
    ...(reasonCode === undefined ? {} : { reasonCode: { schemaVersion: "1.0", code: reasonCode } }),
  };
}

function taskAcceptanceInput() {
  return {
    contractVersion: 1,
    criteria: [{
      criterionId: "goal",
      sourceRequirement: "Reach the goal.",
      expected: "Reach the goal.",
      verification: { kind: "public-telemetry" as const, path: "$.goalReached", assertion: { schemaVersion: 1 as const, comparator: "equals" as const, value: true } },
    }],
  };
}
