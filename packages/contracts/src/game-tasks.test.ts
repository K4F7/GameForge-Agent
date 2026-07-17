import { describe, expect, it } from "vitest";
import {
  createGameTaskRequestSchema,
  gameTaskSchema,
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
});
