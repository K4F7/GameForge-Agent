import { describe, expect, it } from "vitest";
import {
  modelRoutingPolicySchema,
  modelTargetSchema,
  resolveAgentModelRoute,
  resolveExecutableModelTargets,
} from "./model-routing.js";

const model = (provider: "bailian" | "moonshot" = "bailian") => ({
  provider,
  mode: "model" as const,
  model: provider === "moonshot" ? "kimi-k3" : "qwen3.6-flash",
  capabilities: ["tool-use" as const],
});

const route = (owner: "codearts" | "mcp", provider: "bailian" | "moonshot" = "bailian") => ({
  owner,
  primary: model(provider),
  fallbacks: [],
  reasoning: "low" as const,
});

const policy = () => ({
  schemaVersion: 2 as const,
  domesticModelsOnly: true as const,
  officialApiRequired: true as const,
  resolutionOrder: ["explicit-user-override", "task-route-primary", "task-route-fallbacks", "host-default"] as const,
  agent: {
    orchestration: route("codearts", "moonshot"), coding: route("codearts"),
    story: { ...route("codearts"), primary: { ...model(), capabilities: ["narrative" as const] } },
    review: route("codearts"),
    quick: route("codearts"), vision: route("codearts", "moonshot"),
  },
  tools: {
    spec: { owner: "mcp" as const, primary: { provider: "bailian" as const, mode: "model" as const, model: "qwen3.6-flash", capabilities: ["json-schema" as const] }, fallbacks: [], reasoning: "low" as const },
    image: { owner: "mcp" as const, primary: { provider: "volcengine-ark" as const, mode: "model" as const, model: "doubao-seedream-4-0-250828", capabilities: ["image-generation" as const] }, fallbacks: [], reasoning: "high" as const },
    tts: { owner: "mcp" as const, primary: { provider: "volcengine-speech" as const, mode: "model" as const, model: "doubao-tts-async", capabilities: ["text-to-speech" as const] }, fallbacks: [], reasoning: "none" as const },
    sound: {
      owner: "mcp" as const,
      primary: { provider: "freesound" as const, mode: "retrieval" as const, capabilities: ["sound-search" as const] },
      fallbacks: [], reasoning: "none" as const,
    },
    music: {
      owner: "mcp" as const,
      primary: { provider: "minimax" as const, mode: "model" as const, model: "music-2.6", capabilities: ["music-generation" as const] },
      fallbacks: [], reasoning: "none" as const, availability: "planned" as const,
    },
  },
});

describe("model routing policy", () => {
  it("validates a complete domestic-model routing policy", () => {
    expect(modelRoutingPolicySchema.parse(policy()).agent.orchestration.primary)
      .toMatchObject({ provider: "moonshot", model: "kimi-k3" });
  });

  it("rejects Agent ownership inside deterministic MCP routes", () => {
    const input = policy();
    (input.tools.image as { owner: string }).owner = "codearts";
    expect(() => modelRoutingPolicySchema.parse(input)).toThrow("deterministic MCP");
  });

  it("rejects a generated-sound model disguised as the verified default", () => {
    const input: Record<string, unknown> = policy();
    const tools = (input.tools as Record<string, unknown>);
    tools.sound = { owner: "mcp", primary: model(), fallbacks: [], reasoning: "none" };
    expect(() => modelRoutingPolicySchema.parse(input)).toThrow("Freesound retrieval");
  });

  it("rejects a foreign model ID hidden behind a domestic provider", () => {
    const input = policy();
    input.agent.coding.primary.model = "gpt-5";
    expect(() => modelRoutingPolicySchema.parse(input)).toThrow("supported domestic provider");
  });

  it("rejects a provider that does not implement the deterministic tool", () => {
    const input = policy();
    (input.tools.image as { primary: unknown }).primary = model();
    expect(() => modelRoutingPolicySchema.parse(input)).toThrow("volcengine-ark");
  });

  it("rejects generated sound hidden in a fallback", () => {
    const input = policy();
    (input.tools.sound.fallbacks as unknown[]).push(model());
    expect(() => modelRoutingPolicySchema.parse(input)).toThrow("Freesound retrieval");
  });

  it("returns the verified music adapter as an executable route", () => {
    const input = policy();
    (input.tools.music as { availability: string }).availability = "enabled";
    const parsed = modelRoutingPolicySchema.parse(input);
    expect(resolveExecutableModelTargets(parsed.tools.music)).toMatchObject([
      { provider: "minimax", model: "music-2.6" },
    ]);
  });

  it("never returns executable targets for a planned route", () => {
    const parsed = modelRoutingPolicySchema.parse(policy());
    expect(resolveExecutableModelTargets(parsed.tools.music)).toEqual([]);
    expect(resolveExecutableModelTargets(parsed.agent.coding)).toHaveLength(1);
  });

  it("requires a narrative-capable primary story model", () => {
    const input = policy();
    (input.agent.story.primary as { capabilities: string[] }).capabilities = ["tool-use"];
    expect(() => modelRoutingPolicySchema.parse(input)).toThrow("narrative capability");
  });

  it("selects the first host-available fallback and records its source", () => {
    const input = policy();
    (input.agent.coding.fallbacks as unknown[]).push(model("moonshot"));
    const parsed = modelRoutingPolicySchema.parse(input);
    expect(resolveAgentModelRoute(parsed.agent.coding, [model("moonshot")])).toMatchObject({
      status: "selected",
      source: "task-route-fallback",
      target: { provider: "moonshot", model: "kimi-k3" },
    });
  });

  it("selects an exact Tencent Hy3 cross-host fallback without alias guessing", () => {
    const input = policy();
    const hy3 = {
      provider: "tencent" as const,
      mode: "model" as const,
      model: "opencode/hy3-free",
      capabilities: ["code" as const, "tool-use" as const, "long-context" as const],
    };
    (input.agent.coding.fallbacks as unknown[]).push(hy3);
    const parsed = modelRoutingPolicySchema.parse(input);
    expect(resolveAgentModelRoute(parsed.agent.coding, [hy3])).toMatchObject({
      status: "selected",
      source: "task-route-fallback",
      target: hy3,
    });
    expect(resolveAgentModelRoute(parsed.agent.coding, [{ ...hy3, model: "opencode/Hy3-free" }]))
      .toMatchObject({ status: "unavailable" });
    expect(() => modelTargetSchema.parse({ ...hy3, model: "opencode/Hy3-free" }))
      .toThrow("supported domestic provider");
  });

  it("accepts the official Tencent Hy3 model ID as a domestic target", () => {
    expect(modelTargetSchema.parse({
      provider: "tencent",
      mode: "model",
      model: "tencent/Hy3",
      capabilities: ["code", "tool-use", "long-context"],
    })).toMatchObject({ provider: "tencent", model: "tencent/Hy3" });
  });

  it("treats host model IDs as case-sensitive opaque identifiers", () => {
    const parsed = modelRoutingPolicySchema.parse(policy());
    const primary = parsed.agent.coding.primary;
    expect(resolveAgentModelRoute(parsed.agent.coding, [primary])).toMatchObject({
      status: "selected",
      source: "task-route-primary",
    });
    expect(resolveAgentModelRoute(parsed.agent.coding, [{
      ...primary,
      model: primary.model?.toUpperCase(),
    }])).toMatchObject({ status: "unavailable" });
  });

  it("does not silently ignore an unavailable explicit override", () => {
    const parsed = modelRoutingPolicySchema.parse(policy());
    expect(resolveAgentModelRoute(parsed.agent.coding, [model()], model("moonshot"))).toMatchObject({
      status: "unavailable",
      considered: [{ provider: "moonshot", model: "kimi-k3" }],
    });
  });
});
