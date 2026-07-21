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
      requestedSpecialists: [],
    });
    expect(listGameTasksRequestSchema.parse({})).toEqual({ limit: 20 });
  });

  it("normalizes requested specialist roles as a bounded canonical set", () => {
    expect(createGameTaskRequestSchema.parse({
      runId: "run-specialists",
      prompt: "@美术 修改角色图，@程序员 修复碰撞逻辑。",
      requestedSpecialists: ["artist", "programmer", "artist"],
    }).requestedSpecialists).toEqual(["programmer", "artist"]);
    expect(createGameTaskRequestSchema.safeParse({
      runId: "run-specialists",
      prompt: "Request an unsupported specialist role for this game task.",
      requestedSpecialists: ["publisher"],
    }).success).toBe(false);
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
      requestedSpecialists: [],
      status: "claimed",
      createdAt: "2026-07-16T08:00:00Z",
    }).success).toBe(false);
  });
});
