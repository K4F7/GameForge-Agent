#!/usr/bin/env node

import { validateDouyinMiniGameProject, validateWechatMiniGameProject } from "./index.js";

const args = process.argv.slice(2);
const targetIndex = args.indexOf("--target");
const target = targetIndex < 0 ? "douyin-mini-game" : args[targetIndex + 1];
if (targetIndex >= 0) args.splice(targetIndex, 2);
const projectRoot = args[0];
if (projectRoot === undefined) {
  process.stderr.write("Usage: gameforge-minigame-validate [--target douyin-mini-game|wechat-mini-game] <absolute-project-root>\n");
  process.exitCode = 1;
} else if (target !== "douyin-mini-game" && target !== "wechat-mini-game") {
  process.stderr.write("Mini-game validation target must be douyin-mini-game or wechat-mini-game.\n");
  process.exitCode = 1;
} else {
  const validation = target === "wechat-mini-game"
    ? validateWechatMiniGameProject(projectRoot)
    : validateDouyinMiniGameProject(projectRoot);
  validation.then(
    (report) => process.stdout.write(`${JSON.stringify(report, null, 2)}\n`),
    (error: unknown) => {
      process.stderr.write(`${error instanceof Error ? error.message : "Unknown mini-game validation error"}\n`);
      process.exitCode = 1;
    },
  );
}
