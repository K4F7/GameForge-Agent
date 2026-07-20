import { GameVerifier } from "../../packages/game-verifier/dist/index.js";
import path from "node:path";

const outputRoot = path.resolve(".gameforge-validation/runtime-media-binding-v040");
const report = await new GameVerifier({ projectsRoot: outputRoot }).verify({
  projectId: "media-runtime",
  actions: [{ type: "press", key: "Space" }],
  expectedOutcome: "running",
});
console.log(JSON.stringify(report, null, 2));
