import { GameProjectGenerator } from "../../packages/generator/src/index.js";
import { randomUUID } from "node:crypto";
import path from "node:path";

const outputRoot = path.resolve(".gameforge-validation/runtime-localization-20260718-v2");
const projectId = "english-runtime";
const spec = {
  title: "Safety Sprint",
  locale: "en-US" as const,
  genre: "arcade" as const,
  objective: "Collect two safety kits and avoid the moving hazard.",
  controls: ["Arrow keys to move"],
  winCondition: "Collect both safety kits.",
  loseCondition: "Lose all lives or run out of time.",
  targetDurationSeconds: 60,
  gameplay: { collectibleCount: 2, hazardCount: 1, startingLives: 3, movementSpeed: 220 },
};

const generator = new GameProjectGenerator({ outputRoot });
const id = randomUUID();
const result = await generator.execute({
  projectId, spec, mode: "apply", attemptId: `attempt-${id}`, revisionId: `revision-${id}`,
});
console.log(JSON.stringify({ outputRoot, projectId, result }, null, 2));
