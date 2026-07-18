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
      provider: "deepseek",
      model: "huaweicloud-maas/deepseek-v3.2",
    });
    expect(policy.tools.image.primary.provider).toBe("volcengine-ark");
    expect(policy.agent.story.primary).toMatchObject({
      provider: "zhipu",
      model: "huaweicloud-maas/Glm-5-internal",
    });
    expect(resolveAgentModelRoute(policy.agent.story, [policy.agent.story.primary])).toMatchObject({
      status: "selected",
      source: "task-route-primary",
      target: { model: "huaweicloud-maas/Glm-5-internal" },
    });
    expect(resolveAgentModelRoute(policy.agent.story, [{
      ...policy.agent.story.primary,
      model: "huaweicloud-maas/GLM-5-INTERNAL",
    }])).toMatchObject({ status: "unavailable" });
    expect(policy.tools.sound.primary).toMatchObject({ provider: "freesound", mode: "retrieval" });
    expect(policy.tools.music).toMatchObject({
      availability: "enabled",
      primary: { provider: "minimax", model: "music-2.6" },
    });
    expect(text).not.toMatch(/api[_-]?key|access[_-]?key|secret|token/i);
  });
});
