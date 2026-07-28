import { ProjectAssetStore } from "../../packages/asset-store/src/index.js";
import { GameProjectGenerator } from "../../packages/generator/src/index.js";
import { createHash, randomUUID } from "node:crypto";
import { rename } from "node:fs/promises";
import { deflateSync } from "node:zlib";
import path from "node:path";

const outputRoot = path.resolve(".gameforge-validation/runtime-image-sizing-v050");
const projectId = "sized-images";
const id = randomUUID();
const generated = await new GameProjectGenerator({ outputRoot }).execute({
  projectId,
  mode: "apply",
  attemptId: `attempt-${id}`,
  revisionId: `revision-${id}`,
  spec: {
    title: "Sized Images",
    genre: "arcade",
    objective: "Verify large source images retain playable display and collision sizes.",
    controls: ["Arrow keys"],
    winCondition: "Collect every item.",
    loseCondition: "The timer expires.",
    targetDurationSeconds: 60,
  },
});
await rename(generated.outputPath!, path.join(outputRoot, projectId));

const store = new ProjectAssetStore({ projectsRoot: outputRoot });
const inputs = [
  { assetId: "images/player", role: "player" as const, rgba: [34, 211, 238, 255] as const },
  { assetId: "images/collectible", role: "collectible" as const, rgba: [251, 191, 36, 255] as const },
  { assetId: "images/hazard", role: "hazard" as const, rgba: [239, 68, 68, 255] as const },
];
for (const input of inputs) {
  const bytes = png(256, 256, input.rgba);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  await store.store({
    projectId,
    bytes,
    mimeType: "image/png",
    role: input.role,
    provenance: {
      assetId: input.assetId,
      kind: "image",
      origin: "generated",
      provider: "local-test-fixture",
      model: "deterministic-png",
      prompt: `A solid ${input.role} validation image.`,
      license: "test-only",
      sha256,
    },
  });
}
console.log(JSON.stringify({ outputRoot, projectId, sourceDimensions: [256, 256], roles: inputs.map(({ role }) => role) }, null, 2));

function png(width: number, height: number, rgba: readonly [number, number, number, number]): Uint8Array {
  const scanlines = new Uint8Array((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const row = y * (width * 4 + 1);
    for (let x = 0; x < width; x += 1) scanlines.set(rgba, row + 1 + x * 4);
  }
  const header = new Uint8Array(13);
  const headerView = new DataView(header.buffer);
  headerView.setUint32(0, width);
  headerView.setUint32(4, height);
  header.set([8, 6, 0, 0, 0], 8);
  return concat(
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(scanlines)),
    chunk("IEND", new Uint8Array()),
  );
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = new TextEncoder().encode(type);
  const result = new Uint8Array(12 + data.length);
  new DataView(result.buffer).setUint32(0, data.length);
  result.set(typeBytes, 4);
  result.set(data, 8);
  new DataView(result.buffer).setUint32(8 + data.length, crc32(concat(typeBytes, data)));
  return result;
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function concat(...parts: ReadonlyArray<Uint8Array>): Uint8Array {
  const result = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}
