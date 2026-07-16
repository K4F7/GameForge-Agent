import { GameVerifier } from "../../packages/game-verifier/dist/index.js";
import path from "node:path";

const outputRoot = path.resolve(".gameforge-validation/gameplay-tuning-20260717-v030");
const report = await new GameVerifier({ projectsRoot: outputRoot }).verify({
  projectId: "tuned-runtime",
  actions: [{ type: "hold", key: "ArrowRight", durationMs: 500 }],
  expectedOutcome: "running",
});
console.log(JSON.stringify(report, null, 2));
