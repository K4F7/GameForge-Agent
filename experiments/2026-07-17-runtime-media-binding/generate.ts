import { ProjectAssetStore } from "../../packages/asset-store/src/index.js";
import { GameProjectGenerator } from "../../packages/generator/src/index.js";
import { createHash, randomUUID } from "node:crypto";
import { rename } from "node:fs/promises";
import path from "node:path";

const outputRoot = path.resolve(".gameforge-validation/runtime-media-binding-v040");
const projectId = "media-runtime";
const id = randomUUID();
const generated = await new GameProjectGenerator({ outputRoot }).execute({
  projectId,
  mode: "apply",
  attemptId: `attempt-${id}`,
  revisionId: `revision-${id}`,
  spec: {
    title: "Media Runtime",
    genre: "arcade",
    objective: "Verify a generated game with manifest-backed background music.",
    controls: ["Arrow keys"],
    winCondition: "Collect every item.",
    loseCondition: "The timer expires.",
    targetDurationSeconds: 60,
  },
});
await rename(generated.outputPath!, path.join(outputRoot, projectId));

const sampleRate = 8_000;
const sampleCount = 800;
const bytes = new Uint8Array(44 + sampleCount * 2);
const view = new DataView(bytes.buffer);
const text = (offset: number, value: string): void => {
  for (let index = 0; index < value.length; index += 1) bytes[offset + index] = value.charCodeAt(index);
};
text(0, "RIFF");
view.setUint32(4, bytes.length - 8, true);
text(8, "WAVE");
text(12, "fmt ");
view.setUint32(16, 16, true);
view.setUint16(20, 1, true);
view.setUint16(22, 1, true);
view.setUint32(24, sampleRate, true);
view.setUint32(28, sampleRate * 2, true);
view.setUint16(32, 2, true);
view.setUint16(34, 16, true);
text(36, "data");
view.setUint32(40, sampleCount * 2, true);
for (let index = 0; index < sampleCount; index += 1) {
  view.setInt16(44 + index * 2, Math.round(Math.sin(index / 12) * 1_000), true);
}
const sha256 = createHash("sha256").update(bytes).digest("hex");
const stored = await new ProjectAssetStore({ projectsRoot: outputRoot }).store({
  projectId,
  bytes,
  mimeType: "audio/wav",
  role: "bgm",
  provenance: {
    assetId: "music/test-loop",
    kind: "music",
    origin: "generated",
    provider: "local-test-fixture",
    model: "deterministic-sine",
    prompt: "A short deterministic validation tone.",
    license: "test-only",
    sha256,
  },
});
console.log(JSON.stringify({ outputRoot, projectId, entry: stored.entry }, null, 2));
