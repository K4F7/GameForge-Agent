import { z } from "zod";

const providerCapabilitySchema = z.strictObject({
  provider: z.enum(["bailian-qwen", "volcengine-ark", "volcengine-speech", "freesound"]),
  ready: z.boolean(),
});

export const gameforgeCapabilitySnapshotSchema = z.strictObject({
  providers: z.strictObject({
    spec: providerCapabilitySchema,
    image: providerCapabilitySchema,
    tts: providerCapabilitySchema,
    sound: providerCapabilitySchema,
  }),
  engineering: z.strictObject({
    assetStore: z.boolean(),
    generator: z.boolean(),
    verifier: z.boolean(),
    preview: z.boolean(),
    runRelay: z.boolean(),
    taskInbox: z.boolean(),
  }),
});

export type GameforgeCapabilitySnapshot = z.infer<typeof gameforgeCapabilitySnapshotSchema>;
