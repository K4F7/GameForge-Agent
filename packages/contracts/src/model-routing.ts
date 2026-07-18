import { z } from "zod";

export const modelProviderSchema = z.enum([
  "bailian",
  "deepseek",
  "freesound",
  "moonshot",
  "minimax",
  "tencent",
  "volcengine-ark",
  "volcengine-speech",
  "zhipu",
]);

export const modelCapabilitySchema = z.enum([
  "code",
  "image-generation",
  "json-schema",
  "long-context",
  "music-generation",
  "narrative",
  "sound-search",
  "text-to-speech",
  "tool-use",
  "vision",
]);

export const modelTargetSchema = z.strictObject({
  provider: modelProviderSchema,
  mode: z.enum(["model", "retrieval"]),
  model: z.string().trim().min(1).max(200).optional(),
  capabilities: z.array(modelCapabilitySchema).min(1).max(8),
}).superRefine((target, context) => {
  if (target.mode === "model" && target.model === undefined) {
    context.addIssue({ code: "custom", path: ["model"], message: "Model routes require a model ID." });
  }
  if (target.mode === "retrieval" && target.model !== undefined) {
    context.addIssue({ code: "custom", path: ["model"], message: "Retrieval routes must not pretend to use a model." });
  }
  const domesticModelPatterns: Partial<Record<z.infer<typeof modelProviderSchema>, RegExp>> = {
    bailian: /^(qwen|fun-music)/i,
    deepseek: /^(?:huaweicloud-maas\/)?deepseek/i,
    moonshot: /^kimi/i,
    minimax: /^music-/i,
    tencent: /^(?:opencode\/hy3-free|tencent\/Hy3)$/,
    "volcengine-ark": /^(?:doubao-|seed)/i,
    "volcengine-speech": /^doubao-/i,
    zhipu: /^(?:huaweicloud-maas\/)?glm/i,
  };
  if (target.mode === "model" && target.model !== undefined && !domesticModelPatterns[target.provider]?.test(target.model)) {
    context.addIssue({ code: "custom", path: ["model"], message: "Model ID must match the selected supported domestic provider." });
  }
});

const routeSchema = z.strictObject({
  owner: z.enum(["codearts", "mcp"]),
  primary: modelTargetSchema,
  fallbacks: z.array(modelTargetSchema).max(5),
  reasoning: z.enum(["none", "low", "high", "max"]),
  availability: z.enum(["enabled", "planned"]).default("enabled"),
}).superRefine((route, context) => {
  const targets = [route.primary, ...route.fallbacks];
  const keys = new Set<string>();
  targets.forEach((target, index) => {
    const key = `${target.provider}:${target.mode}:${target.model ?? "retrieval"}`;
    if (keys.has(key)) {
      context.addIssue({ code: "custom", path: [index === 0 ? "primary" : "fallbacks", Math.max(0, index - 1)], message: "Route targets must be unique." });
    }
    keys.add(key);
  });
});

export const modelRoutingPolicySchema = z.strictObject({
  schemaVersion: z.literal(2),
  domesticModelsOnly: z.literal(true),
  officialApiRequired: z.literal(true),
  resolutionOrder: z.tuple([
    z.literal("explicit-user-override"),
    z.literal("task-route-primary"),
    z.literal("task-route-fallbacks"),
    z.literal("host-default"),
  ]),
  agent: z.strictObject({
    orchestration: routeSchema,
    coding: routeSchema,
    story: routeSchema,
    review: routeSchema,
    quick: routeSchema,
    vision: routeSchema.optional(),
  }),
  tools: z.strictObject({
    spec: routeSchema,
    image: routeSchema,
    tts: routeSchema,
    sound: routeSchema,
    music: routeSchema,
  }),
}).superRefine((policy, context) => {
  for (const [name, route] of Object.entries(policy.agent)) {
    if (route === undefined) continue;
    if (route.owner !== "codearts") {
      context.addIssue({ code: "custom", path: ["agent", name, "owner"], message: "Agent routes must remain owned by CodeArts." });
    }
  }
  if (!policy.agent.story.primary.capabilities.includes("narrative")) {
    context.addIssue({
      code: "custom",
      path: ["agent", "story", "primary", "capabilities"],
      message: "The primary story route must declare narrative capability.",
    });
  }
  for (const [name, route] of Object.entries(policy.tools)) {
    if (route.owner !== "mcp") {
      context.addIssue({ code: "custom", path: ["tools", name, "owner"], message: "Media/spec tool routes must remain deterministic MCP operations." });
    }
  }
  if (policy.tools.sound.primary.mode !== "retrieval" || policy.tools.sound.primary.provider !== "freesound") {
    context.addIssue({ code: "custom", path: ["tools", "sound", "primary"], message: "Default sound route must remain explicit Freesound retrieval until a verified domestic generation API exists." });
  }
  const toolRequirements = {
    spec: ["bailian", "json-schema"], image: ["volcengine-ark", "image-generation"],
    tts: ["volcengine-speech", "text-to-speech"], sound: ["freesound", "sound-search"],
    music: ["minimax", "music-generation"],
  } as const;
  for (const [name, route] of Object.entries(policy.tools)) {
    const [provider, capability] = toolRequirements[name as keyof typeof toolRequirements];
    for (const [index, target] of [route.primary, ...route.fallbacks].entries()) {
      if (target.provider !== provider || !target.capabilities.includes(capability)) {
        context.addIssue({ code: "custom", path: ["tools", name, index === 0 ? "primary" : "fallbacks", Math.max(0, index - 1)], message: `Tool route requires ${provider} with ${capability}.` });
      }
      if (name === "sound" && (target.mode !== "retrieval" || target.provider !== "freesound")) {
        context.addIssue({ code: "custom", path: ["tools", "sound"], message: "Every sound fallback must remain explicit Freesound retrieval." });
      }
    }
  }
});

export type ModelRoutingPolicy = z.infer<typeof modelRoutingPolicySchema>;
export type ModelRoute = ModelRoutingPolicy["agent"]["coding"];
export type ModelTarget = ModelRoute["primary"];

export const agentModelRoleSchema = z.enum(["orchestration", "coding", "story", "review", "quick", "vision"]);
export type AgentModelRole = z.infer<typeof agentModelRoleSchema>;

export type AgentModelResolution =
  | { status: "selected"; source: "explicit-user-override" | "task-route-primary" | "task-route-fallback"; target: ModelTarget }
  | { status: "planned"; considered: ReadonlyArray<ModelTarget> }
  | { status: "unavailable"; considered: ReadonlyArray<ModelTarget> };

export function resolveExecutableModelTargets(route: ModelRoute): ReadonlyArray<ModelTarget> {
  return route.availability === "enabled" ? [route.primary, ...route.fallbacks] : [];
}

export function resolveAgentModelRoute(
  route: ModelRoute,
  availableTargets: ReadonlyArray<ModelTarget>,
  explicitOverride?: ModelTarget,
): AgentModelResolution {
  const candidates = explicitOverride === undefined
    ? [route.primary, ...route.fallbacks]
    : [explicitOverride];
  if (route.availability !== "enabled") return { status: "planned", considered: candidates };
  const available = new Set(availableTargets.map(modelTargetKey));
  const selectedIndex = candidates.findIndex((target) => available.has(modelTargetKey(target)));
  if (selectedIndex < 0) return { status: "unavailable", considered: candidates };
  const target = candidates[selectedIndex] as ModelTarget;
  return {
    status: "selected",
    source: explicitOverride !== undefined
      ? "explicit-user-override"
      : selectedIndex === 0 ? "task-route-primary" : "task-route-fallback",
    target,
  };
}

function modelTargetKey(target: ModelTarget): string {
  return `${target.provider}:${target.mode}:${target.model ?? "retrieval"}`;
}

export function validateModelRoutingPolicy(input: unknown): ModelRoutingPolicy {
  return modelRoutingPolicySchema.parse(input);
}
