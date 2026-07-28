import { describe, expect, it } from "vitest";
import {
  createGameTaskRequestSchema,
  gameTaskReasonCodeSchema,
  gameTaskSchema,
  gameTaskStatusSchema,
  gameTaskTransitionRequestSchema,
  gameTaskTransitionResultSchema,
  listGameTasksRequestSchema,
} from "./game-tasks.js";

describe("game task contracts", () => {
  it("normalizes a bounded Chinese task request", () => {
    expect(createGameTaskRequestSchema.parse({
      runId: "run-1",
      prompt: "  制作一个可以收集装备并避开危险的小游戏。  ",
      projectId: " safety-game ",
    })).toEqual({
      runId: "run-1",
      prompt: "制作一个可以收集装备并避开危险的小游戏。",
      language: "zh-CN",
      projectId: "safety-game",
    });
    expect(listGameTasksRequestSchema.parse({})).toEqual({ limit: 20 });
  });

  it("rejects short prompts, secrets in unknown fields, and malformed claim state", () => {
    expect(createGameTaskRequestSchema.safeParse({ runId: "run-1", prompt: "too short" }).success).toBe(false);
    expect(createGameTaskRequestSchema.safeParse({
      runId: "run-1",
      prompt: "Create a complete browser game.",
      apiKey: "must-not-pass",
    }).success).toBe(false);
    expect(gameTaskSchema.safeParse({
      taskId: "task-00000000-0000-0000-0000-000000000000",
      runId: "run-1",
      prompt: "Create a complete browser game.",
      language: "en-US",
      status: "claimed",
      createdAt: "2026-07-16T08:00:00Z",
    }).success).toBe(false);
  });

  it("exposes the accepted Task states and versioned reason-code literals", () => {
    expect(gameTaskStatusSchema.options).toEqual([
      "queued",
      "needs-info",
      "claimed",
      "in-progress",
      "retryable",
      "completed",
      "failed",
      "canceled",
      "conflicted",
    ]);
    const codes = [
      "requirements-ambiguous",
      "infrastructure-unavailable",
      "rate-limited",
      "unexpected-process-exit",
      "bounded-timeout",
      "browser-startup-failed",
      "evidence-write-interrupted",
      "build-failed",
      "gameplay-failed",
      "browser-diagnostic-failed",
      "task-criterion-failed",
      "schema-violation",
      "security-violation",
      "stale-base-conflict",
      "unchanged-human-rejection",
      "cancellation",
      "capability-removed",
    ] as const;
    for (const code of codes) {
      expect(gameTaskReasonCodeSchema.parse({ schemaVersion: "1.0", code })).toEqual({
        schemaVersion: "1.0",
        code,
      });
    }
    expect(gameTaskReasonCodeSchema.safeParse({ schemaVersion: "2.0", code: "bounded-timeout" }).success)
      .toBe(false);
    expect(gameTaskReasonCodeSchema.safeParse({ schemaVersion: "1.0", code: "unknown-failure" }).success)
      .toBe(false);
  });

  it("keeps Task transitions and results strict and publicly readable", () => {
    const reasonCode = { schemaVersion: "1.0" as const, code: "bounded-timeout" as const };
    expect(gameTaskTransitionRequestSchema.parse({ status: "retryable", reasonCode })).toEqual({
      status: "retryable",
      reasonCode,
    });
    expect(gameTaskTransitionRequestSchema.safeParse({
      status: "retryable",
      reasonCode,
      message: "classify me from prose",
    }).success).toBe(false);

    const task = gameTaskSchema.parse({
      taskId: "task-00000000-0000-0000-0000-000000000000",
      runId: "run-1",
      prompt: "Create a complete browser game.",
      language: "en-US",
      status: "retryable",
      reasonCode,
      createdAt: "2026-07-16T08:00:00Z",
      claimedAt: "2026-07-16T08:01:00Z",
      claimedBy: "codearts",
    });
    expect(task.reasonCode).toEqual(reasonCode);
    expect(gameTaskSchema.safeParse({ ...task, reasonCode: undefined }).success).toBe(false);
    expect(gameTaskTransitionResultSchema.parse({
      schemaVersion: "1.0",
      outcome: "rejected",
      code: "illegal-transition",
      task,
    })).toMatchObject({ outcome: "rejected", task: { status: "retryable" } });
  });
});
