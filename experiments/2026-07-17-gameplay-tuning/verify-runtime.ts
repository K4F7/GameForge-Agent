import { GameProjectGenerator } from "../../packages/generator/src/index.js";
import { randomUUID } from "node:crypto";
import { rename } from "node:fs/promises";
import path from "node:path";

const outputRoot = path.resolve(".gameforge-validation/gameplay-tuning-20260717-v030");
const projectId = "tuned-runtime";
const spec = {
  title: "Tuned Sprint",
  genre: "arcade" as const,
  objective: "Collect two energy cores and verify the zero-hazard configuration.",
  controls: ["Arrow keys"],
  winCondition: "Collect both energy cores.",
  loseCondition: "The timer expires.",
  targetDurationSeconds: 60,
  gameplay: { collectibleCount: 2, hazardCount: 0, startingLives: 1, movementSpeed: 300 },
};

const generator = new GameProjectGenerator({ outputRoot });
const id = randomUUID();
const result = await generator.execute({
  projectId, spec, mode: "apply", attemptId: `attempt-${id}`, revisionId: `revision-${id}`,
});
await rename(result.outputPath!, path.join(outputRoot, projectId));
console.log(JSON.stringify({ outputRoot, projectId, spec }, null, 2));
