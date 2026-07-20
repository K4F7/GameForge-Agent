import { z } from "zod";

export const providerCapabilitySchema = z.enum([
  "llm",
  "image",
  "tts",
  "sound-search",
  "audio-generation",
]);

export type ProviderCapability = z.infer<typeof providerCapabilitySchema>;

export const providerIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9][a-z0-9._-]*$/, "Provider ID must use lowercase letters, numbers, dots, underscores, or hyphens.");

export const modelIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/, "Model ID contains unsupported characters.");

export const signedJobHandleSchema = z
  .string()
  .min(80)
  .max(12_000)
  .regex(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/, "Signed job handle is invalid.");

export const modelRouteSchema = z.strictObject({
  provider: providerIdSchema,
  model: modelIdSchema,
});

export const serviceRouteSchema = z.strictObject({
  provider: providerIdSchema,
});

export const providerDefinitionSchema = z.strictObject({
  id: providerIdSchema,
  capabilities: z
    .array(providerCapabilitySchema)
    .min(1)
    .max(providerCapabilitySchema.options.length)
    .refine(
      (capabilities) => new Set(capabilities).size === capabilities.length,
      "Provider capabilities must be unique.",
    ),
});

export const providerConfigSchema = z
  .strictObject({
    schemaVersion: z.literal("1.0"),
    providers: z.array(providerDefinitionSchema).min(1).max(30),
    llm: z.strictObject({
      planner: modelRouteSchema,
      spec: modelRouteSchema,
      coder: modelRouteSchema,
      reviewer: modelRouteSchema,
    }),
    image: modelRouteSchema,
    tts: serviceRouteSchema,
    soundSearch: serviceRouteSchema,
    audioGeneration: modelRouteSchema.optional(),
  })
  .superRefine((config, context) => {
    const capabilitiesByProvider = new Map<string, Set<ProviderCapability>>();

    config.providers.forEach((provider, index) => {
      if (capabilitiesByProvider.has(provider.id)) {
        context.addIssue({
          code: "custom",
          path: ["providers", index, "id"],
          message: `Duplicate provider ID: ${provider.id}`,
        });
      }

      capabilitiesByProvider.set(provider.id, new Set(provider.capabilities));
    });

    const routes: Array<{
      capability: ProviderCapability;
      path: ReadonlyArray<string>;
      provider: string;
    }> = [
      { capability: "llm", path: ["llm", "planner", "provider"], provider: config.llm.planner.provider },
      { capability: "llm", path: ["llm", "spec", "provider"], provider: config.llm.spec.provider },
      { capability: "llm", path: ["llm", "coder", "provider"], provider: config.llm.coder.provider },
      { capability: "llm", path: ["llm", "reviewer", "provider"], provider: config.llm.reviewer.provider },
      { capability: "image", path: ["image", "provider"], provider: config.image.provider },
      { capability: "tts", path: ["tts", "provider"], provider: config.tts.provider },
      {
        capability: "sound-search",
        path: ["soundSearch", "provider"],
        provider: config.soundSearch.provider,
      },
    ];

    if (config.audioGeneration !== undefined) {
      routes.push({
        capability: "audio-generation",
        path: ["audioGeneration", "provider"],
        provider: config.audioGeneration.provider,
      });
    }

    for (const route of routes) {
      const capabilities = capabilitiesByProvider.get(route.provider);
      if (capabilities === undefined) {
        context.addIssue({
          code: "custom",
          path: [...route.path],
          message: `Provider is not declared: ${route.provider}`,
        });
      } else if (!capabilities.has(route.capability)) {
        context.addIssue({
          code: "custom",
          path: [...route.path],
          message: `Provider ${route.provider} does not declare the ${route.capability} capability.`,
        });
      }
    }
  });

export type ProviderConfig = z.infer<typeof providerConfigSchema>;

export const defaultProviderConfig = providerConfigSchema.parse({
  schemaVersion: "1.0",
  providers: [
    { id: "codearts", capabilities: ["llm"] },
    { id: "volcengine-ark", capabilities: ["image"] },
    { id: "volcengine-speech", capabilities: ["tts"] },
    { id: "freesound", capabilities: ["sound-search"] },
    { id: "minimax", capabilities: ["audio-generation"] },
  ],
  llm: {
    planner: { provider: "codearts", model: "huaweicloud-maas/deepseek-v3.2" },
    spec: { provider: "codearts", model: "huaweicloud-maas/Glm-5-internal" },
    coder: { provider: "codearts", model: "huaweicloud-maas/deepseek-v3.2" },
    reviewer: { provider: "codearts", model: "huaweicloud-maas/GLM-5.1" },
  },
  image: {
    provider: "volcengine-ark",
    model: "doubao-seedream-4-0-250828",
  },
  tts: { provider: "volcengine-speech" },
  soundSearch: { provider: "freesound" },
  audioGeneration: { provider: "minimax", model: "music-2.6" },
});

export interface ProviderAdapter<
  Capability extends ProviderCapability,
  Request,
  Result,
> {
  readonly id: string;
  readonly capability: Capability;
  execute(request: Request): Promise<Result>;
}

export type LlmProvider<Request = unknown, Result = unknown> = ProviderAdapter<
  "llm",
  Request,
  Result
>;

export type ImageGenerationProvider<Request = unknown, Result = unknown> = ProviderAdapter<
  "image",
  Request,
  Result
>;

export type TextToSpeechProvider<Request = unknown, Result = unknown> = ProviderAdapter<
  "tts",
  Request,
  Result
>;

export type SoundSearchProvider<Request = unknown, Result = unknown> = ProviderAdapter<
  "sound-search",
  Request,
  Result
>;

export type AudioGenerationProvider<Request = unknown, Result = unknown> = ProviderAdapter<
  "audio-generation",
  Request,
  Result
>;

export function validateProviderConfig(input: unknown): ProviderConfig {
  return providerConfigSchema.parse(input);
}
