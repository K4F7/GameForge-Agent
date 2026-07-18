import {
  assetManifestSchema,
  gameSpecSchema,
  providerConfigSchema,
} from "@gameforge/contracts";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type {
  FreesoundSearchRequest,
  FreesoundSearchResult,
  FreesoundPreviewRequest,
  FreesoundPreviewResult,
  SeedreamImageRequest,
  SeedreamImageResult,
  DraftGameSpecRequest,
  DraftGameSpecResult,
  SubmitAsyncTtsRequest,
  AsyncTtsJobRequest,
  AsyncTtsJobResult,
  AsyncTtsAudioResult,
} from "@gameforge/providers";
import type { ImageGenerationProvider, SoundSearchProvider } from "@gameforge/contracts";
import type { StoreAssetRequest, StoreAssetResult } from "@gameforge/asset-store";
import type {
  GamePreviewRequest,
  GamePreviewResult,
  StopGamePreviewResult,
  VerifyGameRequest,
  VerificationReport,
} from "@gameforge/game-verifier";
import type {
  ProjectGenerationRequest,
  ProjectGenerationResult,
  ClaimGameTaskRequest,
  GameTask,
  ListGameTasksRequest,
  RunEventBatch,
  ReplayRunEventsRequest,
  WireRunEvent,
  GameforgeCapabilitySnapshot,
  RunEvent,
} from "@gameforge/contracts";
import type { ZodType } from "zod";
import type { DouyinMiniGameBuildResult } from "@gameforge/minigame-validator";

function validationResult(
  schema: ZodType,
  input: unknown,
  resultKey: "spec" | "config" | "manifest",
): CallToolResult {
  const result = schema.safeParse(input);

  if (!result.success) {
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: JSON.stringify(
            { valid: false, issues: result.error.issues },
            null,
            2,
          ),
        },
      ],
    };
  }

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(
          { valid: true, [resultKey]: result.data },
          null,
          2,
        ),
      },
    ],
  };
}

export function validateGameSpecTool(spec: unknown): CallToolResult {
  return validationResult(gameSpecSchema, spec, "spec");
}

export function validateProviderConfigTool(config: unknown): CallToolResult {
  return validationResult(providerConfigSchema, config, "config");
}

export function validateAssetManifestTool(manifest: unknown): CallToolResult {
  return validationResult(assetManifestSchema, manifest, "manifest");
}

export function getGameforgeCapabilitiesTool(snapshot: GameforgeCapabilitySnapshot): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(snapshot, null, 2) }] };
}

export type DouyinProjectBuilder = {
  build(projectId: string): Promise<DouyinMiniGameBuildResult>;
};

export async function buildDouyinMiniGameTool(
  builder: DouyinProjectBuilder,
  projectId: string,
): Promise<CallToolResult> {
  try {
    const result = await builder.build(projectId);
    const buildEvent: Omit<Extract<RunEvent, { type: "build.ready" }>, "runId" | "sequence" | "emittedAt"> = {
      type: "build.ready",
      projectId: result.projectId,
      target: "douyin-mini-game",
      cliVersion: result.cliVersion,
      passed: true,
      fileCount: result.validation.fileCount,
      totalBytes: result.validation.totalBytes,
      mainPackageBytes: result.validation.mainPackageBytes,
      subpackages: [...result.validation.subpackages],
      deviceOrientation: result.validation.deviceOrientation,
      capabilities: result.validation.capabilities,
      allowedNetworkHosts: [...result.validation.allowedNetworkHosts],
      assetManifestRevision: result.validation.assetManifestRevision,
      assetCount: result.validation.assetCount,
      stdoutTruncated: result.stdoutTruncated,
      stderrTruncated: result.stderrTruncated,
    };
    const { outputPath: _outputPath, ...safeResult } = result;
    return { content: [{ type: "text", text: JSON.stringify({ ...safeResult, buildEvent }, null, 2) }] };
  } catch {
    return {
      isError: true,
      content: [{ type: "text", text: JSON.stringify({ code: "douyin_build_failed", message: "Douyin mini-game build failed." }) }],
    };
  }
}

export async function searchSoundAssetTool(
  provider: SoundSearchProvider<FreesoundSearchRequest, FreesoundSearchResult>,
  request: FreesoundSearchRequest,
): Promise<CallToolResult> {
  try {
    const result = await provider.execute(request);
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  } catch (error) {
    return {
      isError: true,
      content: [{
        type: "text",
        text: JSON.stringify({
          error: "sound_search_failed",
          message: error instanceof Error ? error.message : "Sound search failed.",
        }),
      }],
    };
  }
}


export type GameSpecDraftProvider = {
  execute(request: DraftGameSpecRequest): Promise<DraftGameSpecResult>;
};

export async function draftGameSpecTool(
  provider: GameSpecDraftProvider,
  request: DraftGameSpecRequest,
): Promise<CallToolResult> {
  try {
    return {
      content: [{ type: "text", text: JSON.stringify(await provider.execute(request), null, 2) }],
    };
  } catch (error) {
    return {
      isError: true,
      content: [{
        type: "text",
        text: JSON.stringify({
          error: "game_spec_draft_failed",
          message: error instanceof Error ? error.message : "Game specification drafting failed.",
        }),
      }],
    };
  }
}

export type AssetStore = {
  store(request: StoreAssetRequest): Promise<StoreAssetResult>;
  read?(projectId: string): Promise<import("@gameforge/contracts").RuntimeAssetManifest>;
  recover?(projectId: string): Promise<import("@gameforge/contracts").RuntimeAssetManifest>;
};

export type AssetManifestReader = Required<Pick<AssetStore, "read">>;
export type AssetTransactionRecovery = Required<Pick<AssetStore, "recover">>;
type AssetWriteControl = {
  mode?: "create" | "replace" | undefined;
  expectedRevision?: number | undefined;
};

export async function getProjectAssetsTool(
  reader: AssetManifestReader,
  projectId: string,
): Promise<CallToolResult> {
  try {
    return { content: [{ type: "text", text: JSON.stringify(await reader.read(projectId), null, 2) }] };
  } catch (error) {
    return {
      isError: true,
      content: [{ type: "text", text: JSON.stringify({
        error: "project_assets_read_failed",
        message: error instanceof Error ? error.message : "Project assets could not be read.",
      }) }],
    };
  }
}

export async function recoverProjectAssetsTool(
  recovery: AssetTransactionRecovery,
  projectId: string,
): Promise<CallToolResult> {
  try {
    return { content: [{ type: "text", text: JSON.stringify(await recovery.recover(projectId), null, 2) }] };
  } catch (error) {
    return {
      isError: true,
      content: [{ type: "text", text: JSON.stringify({
        error: "project_assets_recovery_failed",
        message: error instanceof Error ? error.message : "Project asset recovery failed.",
      }) }],
    };
  }
}

export async function requestImageAssetTool(
  provider: ImageGenerationProvider<SeedreamImageRequest, SeedreamImageResult>,
  store: AssetStore,
  request: SeedreamImageRequest & {
    projectId: string;
    role?: "player" | "collectible" | "hazard" | "background" | undefined;
  } & AssetWriteControl,
): Promise<CallToolResult> {
  try {
    const { projectId, role, mode, expectedRevision, ...generationRequest } = request;
    await assertAssetWritePrecondition(store, projectId, generationRequest.assetId, mode, expectedRevision);
    const generated = await provider.execute(generationRequest);
    const stored = await store.store({
      projectId,
      bytes: generated.bytes,
      mimeType: generated.mimeType,
      provenance: generated.provenance,
      ...(role === undefined ? {} : { role }),
      ...(mode === undefined ? {} : { mode }),
      ...(expectedRevision === undefined ? {} : { expectedRevision }),
    });
    return {
      content: [{ type: "text", text: JSON.stringify(stored, null, 2) }],
    };
  } catch (error) {
    return {
      isError: true,
      content: [{
        type: "text",
        text: JSON.stringify({
          error: "image_asset_request_failed",
          message: error instanceof Error ? error.message : "Image asset request failed.",
        }),
      }],
    };
  }
}

export type FreesoundPreviewToolProvider = {
  execute(request: FreesoundPreviewRequest, classification?: "sound" | "music"): Promise<FreesoundPreviewResult>;
};

export async function importSoundAssetTool(
  provider: FreesoundPreviewToolProvider,
  store: AssetStore,
  request: FreesoundPreviewRequest & {
    projectId: string;
    role?: "collect-sound" | "hit-sound" | "bgm" | undefined;
  } & AssetWriteControl,
): Promise<CallToolResult> {
  try {
    const { projectId, role, mode, expectedRevision, ...previewRequest } = request;
    await assertAssetWritePrecondition(store, projectId, previewRequest.assetId, mode, expectedRevision);
    const preview = await provider.execute(previewRequest, role === "bgm" ? "music" : "sound");
    const stored = await store.store({
      projectId,
      bytes: preview.bytes,
      mimeType: preview.mimeType,
      provenance: preview.provenance,
      ...(role === undefined ? {} : { role }),
      ...(mode === undefined ? {} : { mode }),
      ...(expectedRevision === undefined ? {} : { expectedRevision }),
    });
    return { content: [{ type: "text", text: JSON.stringify(stored, null, 2) }] };
  } catch (error) {
    return {
      isError: true,
      content: [{
        type: "text",
        text: JSON.stringify({
          error: "sound_asset_import_failed",
          message: error instanceof Error ? error.message : "Sound asset import failed.",
        }),
      }],
    };
  }
}

export type AsyncTtsToolProvider = {
  submit(request: SubmitAsyncTtsRequest): Promise<AsyncTtsJobResult>;
  query(request: AsyncTtsJobRequest): Promise<AsyncTtsJobResult>;
  materialize(request: AsyncTtsJobRequest): Promise<AsyncTtsAudioResult>;
  inspect?(request: AsyncTtsJobRequest): Promise<{ assetId: string; taskId: string }>;
};

export async function submitVoiceJobTool(
  provider: AsyncTtsToolProvider,
  request: SubmitAsyncTtsRequest,
): Promise<CallToolResult> {
  return ttsResult(() => provider.submit(request));
}

export async function queryVoiceJobTool(
  provider: AsyncTtsToolProvider,
  request: AsyncTtsJobRequest,
): Promise<CallToolResult> {
  return ttsResult(() => provider.query(request));
}

export async function materializeVoiceJobTool(
  provider: AsyncTtsToolProvider,
  store: AssetStore,
  request: AsyncTtsJobRequest & AssetWriteControl,
): Promise<CallToolResult> {
  return ttsResult(async () => {
    const { mode, expectedRevision, ...jobRequest } = request;
    if ((mode ?? "create") === "replace") {
      if (provider.inspect === undefined) throw new Error("Voice replacement requires signed job inspection support.");
      const identity = await provider.inspect(jobRequest);
      await assertAssetWritePrecondition(
        store,
        request.projectId,
        identity.assetId,
        mode,
        expectedRevision,
      );
    } else if (expectedRevision !== undefined) {
      throw new Error("expectedRevision is only valid for asset replacement.");
    }
    const audio = await provider.materialize(jobRequest);
    return store.store({
      projectId: request.projectId,
      bytes: audio.bytes,
      mimeType: audio.mimeType,
      provenance: audio.provenance,
      role: "voice",
      ...(mode === undefined ? {} : { mode }),
      ...(expectedRevision === undefined ? {} : { expectedRevision }),
    });
  });
}

async function assertAssetWritePrecondition(
  store: AssetStore,
  projectId: string,
  assetId: string,
  mode: "create" | "replace" | undefined,
  expectedRevision: number | undefined,
): Promise<void> {
  if ((mode ?? "create") !== "replace") {
    if (expectedRevision !== undefined) throw new Error("expectedRevision is only valid for asset replacement.");
    return;
  }
  if (expectedRevision === undefined) throw new Error("Asset replacement requires expectedRevision.");
  if (store.read === undefined) throw new Error("Asset replacement requires a readable asset store.");
  const manifest = await store.read(projectId);
  if (manifest.revision !== expectedRevision) {
    throw new Error(`Asset manifest revision conflict: expected ${expectedRevision}, found ${manifest.revision}.`);
  }
  if (!manifest.assets.some((asset) => asset.assetId === assetId)) {
    throw new Error(`Runtime asset does not exist for replacement: ${assetId}`);
  }
}

async function ttsResult(operation: () => Promise<unknown>): Promise<CallToolResult> {
  try {
    return { content: [{ type: "text", text: JSON.stringify(await operation(), null, 2) }] };
  } catch (error) {
    return {
      isError: true,
      content: [{
        type: "text",
        text: JSON.stringify({
          error: "tts_job_failed",
          message: error instanceof Error ? error.message : "TTS job operation failed.",
        }),
      }],
    };
  }
}

export type ProjectVerifier = {
  verify(request: VerifyGameRequest): Promise<VerificationReport>;
};

export async function verifyGameProjectTool(
  verifier: ProjectVerifier,
  request: VerifyGameRequest,
): Promise<CallToolResult> {
  try {
    const result = await verifier.verify(request);
    return {
      ...(result.passed ? {} : { isError: true }),
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  } catch (error) {
    return {
      isError: true,
      content: [{
        type: "text",
        text: JSON.stringify({
          error: "game_verification_failed",
          message: error instanceof Error ? error.message : "Game verification failed.",
        }),
      }],
    };
  }
}

export type ProjectPreviewManager = {
  start(request: GamePreviewRequest): Promise<GamePreviewResult>;
  stop(request: GamePreviewRequest): Promise<StopGamePreviewResult>;
};

export async function startGamePreviewTool(
  manager: ProjectPreviewManager,
  request: GamePreviewRequest,
): Promise<CallToolResult> {
  return gamePreviewResult(() => manager.start(request));
}

export async function stopGamePreviewTool(
  manager: ProjectPreviewManager,
  request: GamePreviewRequest,
): Promise<CallToolResult> {
  return gamePreviewResult(() => manager.stop(request));
}

async function gamePreviewResult(operation: () => Promise<unknown>): Promise<CallToolResult> {
  try {
    return { content: [{ type: "text", text: JSON.stringify(await operation(), null, 2) }] };
  } catch (error) {
    return {
      isError: true,
      content: [{
        type: "text",
        text: JSON.stringify({
          error: "game_preview_failed",
          message: error instanceof Error ? error.message : "Game preview operation failed.",
        }),
      }],
    };
  }
}

export type ProjectGenerator = {
  execute(request: ProjectGenerationRequest): Promise<ProjectGenerationResult>;
  recover?(projectId: string): Promise<{ projectId: string; status: "clean" | "rolled-back" | "committed"; planSha256: string }>;
};

export async function generateGameProjectTool(
  generator: ProjectGenerator,
  request: ProjectGenerationRequest,
): Promise<CallToolResult> {
  try {
    const result = await generator.execute(request);
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  } catch (error) {
    return {
      isError: true,
      content: [{
        type: "text",
        text: JSON.stringify({
          error: "project_generation_failed",
          message: error instanceof Error ? error.message : "Project generation failed.",
        }),
      }],
    };
  }
}

export async function recoverGameProjectUpdateTool(
  generator: Required<Pick<ProjectGenerator, "recover">>,
  projectId: string,
): Promise<CallToolResult> {
  try {
    return { content: [{ type: "text", text: JSON.stringify(await generator.recover(projectId), null, 2) }] };
  } catch (error) {
    return {
      isError: true,
      content: [{ type: "text", text: JSON.stringify({
        error: "project_update_recovery_failed",
        message: error instanceof Error ? error.message : "Project update recovery failed.",
      }) }],
    };
  }
}

export type RunRelayToolClient = {
  createRun(runId: string): Promise<WireRunEvent>;
  replayEvents(input: ReplayRunEventsRequest): Promise<RunEventBatch>;
  publishEvents(batch: RunEventBatch): Promise<{ accepted: number; lastSequence?: number }>;
  completeRun(runId: string): Promise<WireRunEvent>;
  stopRun(runId: string): Promise<WireRunEvent>;
};

export type TaskRelayToolClient = {
  listTasks(input: ListGameTasksRequest): Promise<ReadonlyArray<GameTask>>;
  getTask(taskId: string): Promise<GameTask>;
  claimTask(taskId: string, input: ClaimGameTaskRequest): Promise<GameTask>;
};

export async function listGameTasksTool(
  client: TaskRelayToolClient,
  input: ListGameTasksRequest,
): Promise<CallToolResult> {
  return relayResult(async () => ({ tasks: await client.listTasks(input) }));
}

export async function getGameTaskTool(client: TaskRelayToolClient, taskId: string): Promise<CallToolResult> {
  return relayResult(async () => ({ task: await client.getTask(taskId) }));
}

export async function claimGameTaskTool(
  client: TaskRelayToolClient,
  taskId: string,
  input: ClaimGameTaskRequest,
): Promise<CallToolResult> {
  return relayResult(async () => ({ task: await client.claimTask(taskId, input) }));
}

export async function createGameRunTool(client: RunRelayToolClient, runId: string): Promise<CallToolResult> {
  return relayResult(() => client.createRun(runId));
}

export async function replayGameRunTool(
  client: RunRelayToolClient,
  input: ReplayRunEventsRequest,
): Promise<CallToolResult> {
  return relayResult(() => client.replayEvents(input));
}

export async function publishRunEventsTool(
  client: RunRelayToolClient,
  batch: RunEventBatch,
): Promise<CallToolResult> {
  return relayResult(() => client.publishEvents(batch));
}

export async function completeGameRunTool(client: RunRelayToolClient, runId: string): Promise<CallToolResult> {
  return relayResult(() => client.completeRun(runId));
}

export async function stopGameRunTool(client: RunRelayToolClient, runId: string): Promise<CallToolResult> {
  return relayResult(() => client.stopRun(runId));
}

async function relayResult(operation: () => Promise<unknown>): Promise<CallToolResult> {
  try {
    return {
      content: [{ type: "text", text: JSON.stringify(await operation(), null, 2) }],
    };
  } catch (error) {
    const relayCode = typeof error === "object" && error !== null && "relayCode" in error
      && typeof error.relayCode === "string"
      ? error.relayCode
      : undefined;
    return {
      isError: true,
      content: [{
        type: "text",
        text: JSON.stringify({
          error: "run_relay_failed",
          ...(relayCode === undefined ? {} : { relayCode }),
          message: "Run relay operation failed.",
        }),
      }],
    };
  }
}
