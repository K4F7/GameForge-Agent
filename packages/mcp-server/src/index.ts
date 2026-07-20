#!/usr/bin/env node

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  BailianGameSpecProvider,
  FreesoundPreviewProvider,
  FreesoundProvider,
  MinimaxMusicProvider,
  SeedreamProvider,
  VolcengineAsyncTtsProvider,
} from "@gameforge/providers";
import { ProjectAssetStore } from "@gameforge/asset-store";
import { GamePreviewManager, GameVerifier } from "@gameforge/game-verifier";
import { GameProjectGenerator, ManagedLayaGameplayVerifier } from "@gameforge/generator";
import {
  DouyinMiniGameBuilder,
  DouyinMiniGameCliProbe,
  WechatMiniGameBuilder,
} from "@gameforge/minigame-validator";
import { RunRelayClient } from "@gameforge/run-relay/client";
import { createServer } from "./server.js";
import { McpToolAuditRecorder } from "./tool-audit.js";
import { loadModelRoutingPolicy } from "./model-routing.js";
import { DouyinBridgeController } from "./douyin-bridge-controller.js";
import path from "node:path";
import { fileURLToPath } from "node:url";

const bailianApiKey = process.env.DASHSCOPE_API_KEY?.trim();
const bailianSpecModel = process.env.GAMEFORGE_SPEC_MODEL?.trim();
const freesoundApiKey = process.env.FREESOUND_API_KEY?.trim();
const freesoundApiUsage = process.env.FREESOUND_API_USAGE?.trim();
const projectOutputRoot = process.env.GAMEFORGE_PROJECT_OUTPUT_ROOT?.trim();
const layaAirCliPath = process.env.GAMEFORGE_LAYAIR_CLI?.trim();
const douyinMiniGameCliInput = process.env.GAMEFORGE_DOUYIN_MINIGAME_CLI;
const douyinMiniGameCliPath = douyinMiniGameCliInput?.trim();
const runRelayUrl = process.env.GAMEFORGE_RUN_RELAY_URL?.trim();
const runRelayToken = process.env.GAMEFORGE_RUN_RELAY_TOKEN;
const toolAuditFile = process.env.GAMEFORGE_MCP_AUDIT_FILE?.trim();
const toolAuditDirectory = process.env.GAMEFORGE_MCP_AUDIT_DIR?.trim();
const configuredModelRoutingPolicy = process.env.GAMEFORGE_MODEL_ROUTING_POLICY?.trim();
const seedreamApiKey = process.env.VOLCENGINE_ARK_API_KEY?.trim();
const seedreamModel = process.env.GAMEFORGE_IMAGE_MODEL?.trim();
const seedreamLicense = process.env.GAMEFORGE_IMAGE_LICENSE?.trim();
const minimaxApiKey = process.env.MINIMAX_API_KEY?.trim();
const minimaxMusicModel = process.env.GAMEFORGE_MUSIC_MODEL?.trim();
const minimaxMusicLicense = process.env.GAMEFORGE_MUSIC_LICENSE?.trim();
const seedreamReferenceHosts = process.env.GAMEFORGE_IMAGE_REFERENCE_HOSTS
  ?.split(",")
  .map((host) => host.trim())
  .filter((host) => host.length > 0);
const speechApiToken = process.env.VOLCENGINE_SPEECH_API_TOKEN?.trim();
const speechAppId = process.env.VOLCENGINE_SPEECH_APP_ID?.trim();
const ttsLicense = process.env.GAMEFORGE_TTS_LICENSE?.trim();
const ttsAudioHosts = process.env.GAMEFORGE_TTS_AUDIO_HOSTS
  ?.split(",")
  .map((host) => host.trim())
  .filter((host) => host.length > 0);
const chromeExecutablePath = process.env.GAMEFORGE_CHROME_EXECUTABLE?.trim();
const defaultModelRoutingPolicy = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../config/model-routing.example.json",
);
const modelRoutingPolicy = await loadModelRoutingPolicy(
  configuredModelRoutingPolicy === undefined || configuredModelRoutingPolicy.length === 0
    ? defaultModelRoutingPolicy
    : configuredModelRoutingPolicy,
);
const douyinBridgeController = new DouyinBridgeController();
await douyinBridgeController.start();
if (douyinMiniGameCliInput !== undefined && douyinMiniGameCliPath?.length === 0) {
  throw new Error("GAMEFORGE_DOUYIN_MINIGAME_CLI must be unset or contain an absolute regular file path.");
}
const previewManager = projectOutputRoot === undefined || projectOutputRoot.length === 0
  ? undefined
  : new GamePreviewManager({ projectsRoot: projectOutputRoot });
const assetStore = projectOutputRoot === undefined || projectOutputRoot.length === 0
  ? undefined
  : new ProjectAssetStore({ projectsRoot: projectOutputRoot });
const runRelayClient = runRelayUrl === undefined || runRelayUrl.length === 0
  ? undefined
  : new RunRelayClient({
      baseUrl: runRelayUrl,
    ...(runRelayToken === undefined ? {} : { authToken: runRelayToken }),
    });
if (toolAuditFile !== undefined && toolAuditFile.length > 0 &&
    toolAuditDirectory !== undefined && toolAuditDirectory.length > 0) {
  throw new Error("Configure only one of GAMEFORGE_MCP_AUDIT_FILE or GAMEFORGE_MCP_AUDIT_DIR.");
}
const toolAudit = toolAuditFile !== undefined && toolAuditFile.length > 0
  ? await McpToolAuditRecorder.create(toolAuditFile)
  : toolAuditDirectory !== undefined && toolAuditDirectory.length > 0
    ? await McpToolAuditRecorder.createInDirectory(toolAuditDirectory)
    : undefined;
if (
  freesoundApiKey !== undefined &&
  freesoundApiKey.length > 0 &&
  freesoundApiUsage !== "non-commercial" &&
  freesoundApiUsage !== "commercial-agreement"
) {
  throw new Error(
    "FREESOUND_API_USAGE must be non-commercial or commercial-agreement when FREESOUND_API_KEY is set.",
  );
}
if (seedreamApiKey !== undefined && seedreamApiKey.length > 0) {
  if (projectOutputRoot === undefined || projectOutputRoot.length === 0) {
    throw new Error("GAMEFORGE_PROJECT_OUTPUT_ROOT is required when VOLCENGINE_ARK_API_KEY is set.");
  }
  if (seedreamModel === undefined || seedreamModel.length === 0) {
    throw new Error("GAMEFORGE_IMAGE_MODEL is required when VOLCENGINE_ARK_API_KEY is set.");
  }
  if (seedreamLicense === undefined || seedreamLicense.length === 0) {
    throw new Error("GAMEFORGE_IMAGE_LICENSE is required when VOLCENGINE_ARK_API_KEY is set.");
  }
}
if (speechApiToken !== undefined && speechApiToken.length > 0) {
  if (projectOutputRoot === undefined || projectOutputRoot.length === 0) {
    throw new Error("GAMEFORGE_PROJECT_OUTPUT_ROOT is required when VOLCENGINE_SPEECH_API_TOKEN is set.");
  }
  if (speechAppId === undefined || speechAppId.length === 0) {
    throw new Error("VOLCENGINE_SPEECH_APP_ID is required when VOLCENGINE_SPEECH_API_TOKEN is set.");
  }
  if (ttsLicense === undefined || ttsLicense.length === 0) {
    throw new Error("GAMEFORGE_TTS_LICENSE is required when VOLCENGINE_SPEECH_API_TOKEN is set.");
  }
  if (ttsAudioHosts === undefined || ttsAudioHosts.length === 0) {
    throw new Error("GAMEFORGE_TTS_AUDIO_HOSTS is required when VOLCENGINE_SPEECH_API_TOKEN is set.");
  }
}
if (minimaxApiKey !== undefined && minimaxApiKey.length > 0) {
  if (projectOutputRoot === undefined || projectOutputRoot.length === 0) {
    throw new Error("GAMEFORGE_PROJECT_OUTPUT_ROOT is required when MINIMAX_API_KEY is set.");
  }
  if (minimaxMusicLicense === undefined || minimaxMusicLicense.length === 0) {
    throw new Error("GAMEFORGE_MUSIC_LICENSE is required when MINIMAX_API_KEY is set.");
  }
  if (minimaxMusicModel !== undefined && minimaxMusicModel !== "music-2.6" && minimaxMusicModel !== "music-2.6-free") {
    throw new Error("GAMEFORGE_MUSIC_MODEL must be music-2.6 or music-2.6-free.");
  }
}
const server = createServer({
  modelRoutingPolicy,
  douyinBridgeController,
  ...(toolAudit === undefined ? {} : { toolAudit }),
  ...(bailianApiKey === undefined || bailianApiKey.length === 0
    ? {}
    : {
        gameSpecDraftProvider: new BailianGameSpecProvider({
          apiKey: bailianApiKey,
          ...(bailianSpecModel === undefined || bailianSpecModel.length === 0
            ? {}
            : { model: bailianSpecModel }),
        }),
      }),
  ...(projectOutputRoot === undefined || projectOutputRoot.length === 0
    ? {}
    : {
        projectGenerator: new GameProjectGenerator({ outputRoot: projectOutputRoot }),
        layaGameplayVerifier: new ManagedLayaGameplayVerifier({ projectsRoot: projectOutputRoot }),
        ...(layaAirCliPath === undefined || layaAirCliPath.length === 0
          ? {}
          : {
              douyinProjectBuilder: new DouyinMiniGameBuilder({ projectsRoot: projectOutputRoot, cliPath: layaAirCliPath }),
              wechatProjectBuilder: new WechatMiniGameBuilder({ projectsRoot: projectOutputRoot, cliPath: layaAirCliPath }),
            }),
        projectPreviewManager: previewManager as GamePreviewManager,
        projectVerifier: new GameVerifier({
          projectsRoot: projectOutputRoot,
          ...(chromeExecutablePath === undefined || chromeExecutablePath.length === 0
            ? {}
            : { chromeExecutablePath }),
        }),
        assetStore: assetStore as ProjectAssetStore,
      }),
  ...(runRelayClient === undefined
    ? {}
    : { runRelayClient, taskRelayClient: runRelayClient }),
  ...(douyinMiniGameCliPath === undefined || douyinMiniGameCliPath.length === 0
    ? {}
    : { douyinMiniGameCliProbe: new DouyinMiniGameCliProbe({ cliPath: douyinMiniGameCliPath }) }),
  ...(seedreamApiKey === undefined || seedreamApiKey.length === 0
    ? {}
    : {
        imageProvider: new SeedreamProvider({
          apiKey: seedreamApiKey,
          model: seedreamModel as string,
          license: seedreamLicense as string,
          ...(seedreamReferenceHosts === undefined
            ? {}
            : { allowedReferenceImageHosts: seedreamReferenceHosts }),
        }),
      }),
  ...(freesoundApiKey === undefined || freesoundApiKey.length === 0
    ? {}
    : {
        soundSearchProvider: new FreesoundProvider({
          apiKey: freesoundApiKey,
          apiUsage: freesoundApiUsage as "non-commercial" | "commercial-agreement",
        }),
      }),
  ...(freesoundApiKey === undefined || freesoundApiKey.length === 0 ||
      projectOutputRoot === undefined || projectOutputRoot.length === 0
    ? {}
    : {
        soundPreviewProvider: new FreesoundPreviewProvider(),
      }),
  ...(speechApiToken === undefined || speechApiToken.length === 0
    ? {}
    : {
        asyncTtsProvider: new VolcengineAsyncTtsProvider({
          apiToken: speechApiToken,
          appId: speechAppId as string,
          license: ttsLicense as string,
          allowedAudioHosts: ttsAudioHosts as string[],
      }),
    }),
  ...(minimaxApiKey === undefined || minimaxApiKey.length === 0
    ? {}
    : {
        musicProvider: new MinimaxMusicProvider({
          apiKey: minimaxApiKey,
          license: minimaxMusicLicense as string,
          ...(minimaxMusicModel === undefined || minimaxMusicModel.length === 0
            ? {}
            : { model: minimaxMusicModel as "music-2.6" | "music-2.6-free" }),
        }),
      }),
});
const transport = new StdioServerTransport();
await server.connect(transport);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void Promise.all([previewManager?.closeAll(), douyinBridgeController.stop()])
      .finally(() => process.exit(signal === "SIGINT" ? 130 : 143));
  });
}
