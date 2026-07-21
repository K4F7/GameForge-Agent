import { describe, expect, it } from "vitest";
import {
  appendSpecialistMention,
  extractRequestedSpecialists,
  specialistMentionLabels,
} from "./specialist-agents.js";

describe("specialist agent mentions", () => {
  it("extracts a canonical role list from a shared task prompt", () => {
    expect(extractRequestedSpecialists("@美术 调整角色图，@程序员 修复碰撞。@美术 保留候选版本。"))
      .toEqual(["programmer", "artist"]);
    expect(extractRequestedSpecialists("不要把 @程序员助手 当成角色提及。"))
      .toEqual([]);
  });

  it("appends one mention without duplicating an existing role", () => {
    expect(appendSpecialistMention("修复游戏", "programmer")).toBe("修复游戏 @程序员 ");
    expect(appendSpecialistMention("@程序员 修复游戏", "programmer")).toBe("@程序员 修复游戏");
    expect(appendSpecialistMention("", "artist")).toBe("@美术 ");
  });

  it("formats persisted specialist metadata for the Task navigator", () => {
    expect(specialistMentionLabels(["tester", "planner"])).toEqual(["@策划", "@测试"]);
  });
});
