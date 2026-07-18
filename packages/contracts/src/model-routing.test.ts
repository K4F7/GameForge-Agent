import { describe, expect, it } from "vitest";
import { modelRoutingPolicySchema } from "./model-routing.js";

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
  schemaVersion: 1 as const,
  domesticModelsOnly: true as const,
  officialApiRequired: true as const,
  resolutionOrder: ["explicit-user-override", "task-route-primary", "task-route-fallbacks", "host-default"] as const,
  agent: {
    orchestration: route("codearts", "moonshot"), coding: route("codearts"), review: route("codearts"),
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
});
