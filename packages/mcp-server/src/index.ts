#!/usr/bin/env node

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  BailianGameSpecProvider,
  FreesoundPreviewProvider,
  FreesoundProvider,
  SeedreamProvider,
  VolcengineAsyncTtsProvider,
} from "@gameforge/providers";
import { ProjectAssetStore } from "@gameforge/asset-store";
import { GamePreviewManager, GameVerifier } from "@gameforge/game-verifier";
import { GameProjectGenerator } from "@gameforge/generator";
import { DouyinMiniGameBuilder } from "@gameforge/minigame-validator";
import { RunRelayClient } from "@gameforge/run-relay/client";
import { createServer } from "./server.js";
import { McpToolAuditRecorder } from "./tool-audit.js";

const bailianApiKey = process.env.DASHSCOPE_API_KEY?.trim();
const bailianSpecModel = process.env.GAMEFORGE_SPEC_MODEL?.trim();
const freesoundApiKey = process.env.FREESOUND_API_KEY?.trim();
const freesoundApiUsage = process.env.FREESOUND_API_USAGE?.trim();
const projectOutputRoot = process.env.GAMEFORGE_PROJECT_OUTPUT_ROOT?.trim();
const layaAirCliPath = process.env.GAMEFORGE_LAYAIR_CLI?.trim();
const runRelayUrl = process.env.GAMEFORGE_RUN_RELAY_URL?.trim();
const runRelayToken = process.env.GAMEFORGE_RUN_RELAY_TOKEN;
const toolAuditFile = process.env.GAMEFORGE_MCP_AUDIT_FILE?.trim();
const toolAuditDirectory = process.env.GAMEFORGE_MCP_AUDIT_DIR?.trim();
const seedreamApiKey = process.env.VOLCENGINE_ARK_API_KEY?.trim();
const seedreamModel = process.env.GAMEFORGE_IMAGE_MODEL?.trim();
const seedreamLicense = process.env.GAMEFORGE_IMAGE_LICENSE?.trim();
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
const server = createServer({
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
        ...(layaAirCliPath === undefined || layaAirCliPath.length === 0
          ? {}
          : { douyinProjectBuilder: new DouyinMiniGameBuilder({ projectsRoot: projectOutputRoot, cliPath: layaAirCliPath }) }),
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
});
const transport = new StdioServerTransport();
await server.connect(transport);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void previewManager?.closeAll().finally(() => process.exit(signal === "SIGINT" ? 130 : 143));
  });
}
