#!/usr/bin/env node

import {
  assertMiniGameHandoffSnapshot,
  createMiniGameLocalHandoffManifest,
  validateDouyinMiniGameProject,
  validateWechatMiniGameProject,
} from "./index.js";

const args = [...process.argv.slice(2)];
const target = takeOption(args, "--target") ?? "douyin-mini-game";
const projectId = takeOption(args, "--project-id");
const projectRoot = args.shift();

if (projectRoot === undefined || projectId === undefined || args.length > 0) {
  fail("Usage: gameforge-minigame-handoff --project-id <id> [--target douyin-mini-game|wechat-mini-game] <absolute-project-root>");
} else if (target !== "douyin-mini-game" && target !== "wechat-mini-game") {
  fail("Mini-game handoff target must be douyin-mini-game or wechat-mini-game.");
} else {
  const run = async () => {
    const before = await createMiniGameLocalHandoffManifest({ projectRoot, projectId, target });
    const validation = target === "douyin-mini-game"
      ? await validateDouyinMiniGameProject(projectRoot, { expectedProjectId: projectId })
      : await validateWechatMiniGameProject(projectRoot, { expectedProjectId: projectId });
    const handoff = await createMiniGameLocalHandoffManifest({ projectRoot, projectId, target });
    assertMiniGameHandoffSnapshot(before, handoff);
    process.stdout.write(`${JSON.stringify({ validation, handoff }, null, 2)}\n`);
  };
  run().catch((error: unknown) => fail(error instanceof Error ? error.message : "Unknown mini-game handoff error"));
}

function takeOption(values: string[], name: string): string | undefined {
  const index = values.indexOf(name);
  if (index < 0) return undefined;
  const value = values[index + 1];
  values.splice(index, 2);
  return value;
}

function fail(message: string): void {
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}
