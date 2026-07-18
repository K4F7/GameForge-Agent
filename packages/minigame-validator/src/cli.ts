#!/usr/bin/env node

import { validateDouyinMiniGameProject } from "./index.js";

const projectRoot = process.argv[2];
if (projectRoot === undefined) {
  process.stderr.write("Usage: gameforge-minigame-validate <absolute-project-root>\n");
  process.exitCode = 1;
} else {
  validateDouyinMiniGameProject(projectRoot).then(
    (report) => process.stdout.write(`${JSON.stringify(report, null, 2)}\n`),
    (error: unknown) => {
      process.stderr.write(`${error instanceof Error ? error.message : "Unknown mini-game validation error"}\n`);
      process.exitCode = 1;
    },
  );
}
