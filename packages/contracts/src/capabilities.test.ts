import { describe, expect, it } from "vitest";
import { gameforgeCapabilitySnapshotSchema } from "./capabilities.js";

describe("gameforgeCapabilitySnapshotSchema", () => {
  it("accepts only the known secret-free capability shape", () => {
    const snapshot = {
      providers: {
        spec: { provider: "bailian-qwen", ready: true },
        image: { provider: "volcengine-ark", ready: false },
        tts: { provider: "volcengine-speech", ready: false },
        sound: { provider: "freesound", ready: true },
        music: { provider: "minimax", ready: false },
      },
      engineering: { assetStore: true, generator: true, douyinBuild: true, verifier: true, preview: true, runRelay: true, taskInbox: true },
    } as const;
    expect(gameforgeCapabilitySnapshotSchema.parse(snapshot)).toEqual(snapshot);
    const { douyinBuild: _douyinBuild, ...legacyEngineering } = snapshot.engineering;
    const legacy = { ...snapshot, engineering: legacyEngineering };
    expect(gameforgeCapabilitySnapshotSchema.parse(legacy).engineering.douyinBuild).toBe(false);
    expect(gameforgeCapabilitySnapshotSchema.safeParse({ ...snapshot, apiKey: "secret" }).success).toBe(false);
  });
});
