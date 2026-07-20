import { z } from "zod";

const providerCapabilitySchema = z.strictObject({
  provider: z.enum(["bailian-qwen", "volcengine-ark", "volcengine-speech", "freesound", "minimax"]),
  ready: z.boolean(),
});

export const gameforgeCapabilitySnapshotSchema = z.strictObject({
  providers: z.strictObject({
    spec: providerCapabilitySchema,
    image: providerCapabilitySchema,
    tts: providerCapabilitySchema,
    sound: providerCapabilitySchema,
    music: providerCapabilitySchema.default({ provider: "minimax", ready: false }),
  }),
  engineering: z.strictObject({
    assetStore: z.boolean(),
    generator: z.boolean(),
    douyinBuild: z.boolean().default(false),
    douyinCliProbe: z.boolean().default(false),
    wechatBuild: z.boolean().default(false),
    gameplayVerifier: z.boolean().default(false),
    verifier: z.boolean(),
    preview: z.boolean(),
    runRelay: z.boolean(),
    taskInbox: z.boolean(),
  }),
});

export type GameforgeCapabilitySnapshot = z.infer<typeof gameforgeCapabilitySnapshotSchema>;
