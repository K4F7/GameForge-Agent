#!/usr/bin/env node

import { DouyinMiniGameCliProbe, douyinMiniGameCliPolicy } from "./douyin-cli.js";

const configuredInput = process.env.GAMEFORGE_DOUYIN_MINIGAME_CLI;
const configuredPath = configuredInput?.trim();
const issues: Array<{ code: string; message: string }> = [];
let report: Awaited<ReturnType<DouyinMiniGameCliProbe["probe"]>> | null = null;

if (configuredInput !== undefined && configuredPath?.length === 0) {
  issues.push({
    code: "douyin_cli_path_empty",
    message: "GAMEFORGE_DOUYIN_MINIGAME_CLI must be unset or contain an absolute regular file path.",
  });
} else if (configuredPath !== undefined && configuredPath.length > 0) {
  try {
    report = await new DouyinMiniGameCliProbe({ cliPath: configuredPath }).probe();
  } catch {
    issues.push({
      code: "douyin_cli_probe_failed",
      message: "Configured Douyin mini-game CLI failed the bounded version-only probe.",
    });
  }
}

console.log(JSON.stringify({
  ok: issues.length === 0,
  target: "douyin-mini-game",
  localFlow: {
    generator: "GameForge managed Laya project",
    builder: "LayaAir CLI 3.4.0",
    gameplayVerification: "bounded no-render host",
    artifactValidation: "GameForge deterministic validator",
  },
  platformCli: {
    configured: configuredPath !== undefined && configuredPath.length > 0,
    report,
    policy: douyinMiniGameCliPolicy,
  },
  issues,
}, null, 2));

if (issues.length > 0) process.exitCode = 1;
