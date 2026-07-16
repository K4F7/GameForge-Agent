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
import { RunRelayClient } from "@gameforge/run-relay/client";
import { createServer } from "./server.js";

const bailianApiKey = process.env.DASHSCOPE_API_KEY?.trim();
const bailianSpecModel = process.env.GAMEFORGE_SPEC_MODEL?.trim();
const freesoundApiKey = process.env.FREESOUND_API_KEY?.trim();
const freesoundApiUsage = process.env.FREESOUND_API_USAGE?.trim();
const projectOutputRoot = process.env.GAMEFORGE_PROJECT_OUTPUT_ROOT?.trim();
const runRelayUrl = process.env.GAMEFORGE_RUN_RELAY_URL?.trim();
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
const runRelayClient = runRelayUrl === undefined || runRelayUrl.length === 0
  ? undefined
  : new RunRelayClient({ baseUrl: runRelayUrl });
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
        projectPreviewManager: previewManager as GamePreviewManager,
        projectVerifier: new GameVerifier({
          projectsRoot: projectOutputRoot,
          ...(chromeExecutablePath === undefined || chromeExecutablePath.length === 0
            ? {}
            : { chromeExecutablePath }),
        }),
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
        assetStore: new ProjectAssetStore({ projectsRoot: projectOutputRoot as string }),
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
        assetStore: new ProjectAssetStore({ projectsRoot: projectOutputRoot }),
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
        assetStore: new ProjectAssetStore({ projectsRoot: projectOutputRoot as string }),
      }),
});
const transport = new StdioServerTransport();
await server.connect(transport);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void previewManager?.closeAll().finally(() => process.exit(signal === "SIGINT" ? 130 : 143));
  });
}
