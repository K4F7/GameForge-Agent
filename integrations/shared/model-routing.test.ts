import { readFile } from "node:fs/promises";
import path from "node:path";
import { modelRoutingPolicySchema, resolveAgentModelRoute } from "@gameforge/contracts";
import { describe, expect, it } from "vitest";

describe("committed model routing example", () => {
  it("is accepted by the shared contract without containing secrets", async () => {
    const file = path.resolve(import.meta.dirname, "../../config/model-routing.example.json");
    const text = await readFile(file, "utf8");
    const policy = modelRoutingPolicySchema.parse(JSON.parse(text) as unknown);
    expect(policy.agent.orchestration.primary).toMatchObject({
      provider: "zhipu",
      model: "huaweicloud-maas/GLM-5.1",
    });
    expect(policy.tools.image.primary.provider).toBe("volcengine-ark");
    expect(policy.agent.story.primary).toMatchObject({
      provider: "deepseek",
      model: "huaweicloud-maas/deepseek-v3.2",
    });
    expect(resolveAgentModelRoute(policy.agent.story, [policy.agent.story.primary])).toMatchObject({
      status: "selected",
      source: "task-route-primary",
      target: { model: "huaweicloud-maas/deepseek-v3.2" },
    });
    expect(resolveAgentModelRoute(policy.agent.story, [{
      ...policy.agent.story.primary,
      model: "huaweicloud-maas/DEEPSEEK-V3.2",
    }])).toMatchObject({ status: "unavailable" });
    const codingFallback = policy.agent.coding.fallbacks.at(-1);
    if (codingFallback === undefined) throw new Error("Expected a committed CodeArts coding fallback.");
    expect(codingFallback).toMatchObject({
      provider: "deepseek",
      model: "huaweicloud-maas/deepseek-v3.2",
    });
    expect(resolveAgentModelRoute(policy.agent.coding, [codingFallback])).toMatchObject({
      status: "selected",
      source: "task-route-fallback",
      target: { provider: "deepseek", model: "huaweicloud-maas/deepseek-v3.2" },
    });
    const agentTargets = Object.values(policy.agent).flatMap((route) =>
      route === undefined ? [] : [route.primary, ...route.fallbacks]
    );
    expect(new Set(agentTargets.map(({ provider }) => provider))).toEqual(new Set(["deepseek", "zhipu"]));
    expect(policy.tools.sound.primary).toMatchObject({ provider: "freesound", mode: "retrieval" });
    expect(policy.tools.music).toMatchObject({
      availability: "planned",
      primary: { provider: "minimax", model: "music-2.6" },
    });
    expect(Object.values(policy.tools).every(({ availability }) => availability === "planned")).toBe(true);
    expect(text).not.toMatch(/api[_-]?key|access[_-]?key|secret|token/i);
  });
});
