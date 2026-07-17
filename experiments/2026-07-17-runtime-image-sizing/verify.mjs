import { GameVerifier } from "../../packages/game-verifier/dist/index.js";
import path from "node:path";

const report = await new GameVerifier({
  projectsRoot: path.resolve(".gameforge-validation/runtime-image-sizing-v050"),
}).verify({
  projectId: "sized-images",
  actions: [{ type: "hold", key: "ArrowRight", durationMs: 300 }],
  expectedOutcome: "running",
});
console.log(JSON.stringify(report, null, 2));
