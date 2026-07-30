import {
  assetManifestSchema,
  gameSpecSchema,
  providerConfigSchema,
  verificationDiagnosticMessageLimit,
} from "@gameforge/contracts";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type {
  FreesoundSearchRequest,
  FreesoundSearchResult,
  FreesoundPreviewRequest,
  FreesoundPreviewResult,
  SeedreamImageRequest,
  SeedreamImageResult,
  MinimaxMusicRequest,
  MinimaxMusicResult,
  DraftGameSpecRequest,
  DraftGameSpecResult,
  SubmitAsyncTtsRequest,
  AsyncTtsJobRequest,
  AsyncTtsJobResult,
  AsyncTtsAudioResult,
} from "@gameforge/providers";
import type { AudioGenerationProvider, ImageGenerationProvider, SoundSearchProvider } from "@gameforge/contracts";
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
  CreateGameTaskRequest,
  CreateGameTaskResponse,
  ClaimGameTaskRequest,
  CompileTaskAcceptanceContractInput,
  GameTask,
  GameTaskTransitionRequest,
  GameTaskTransitionResult,
  GameTaskAcceptanceCompileResult,
  ListGameTasksRequest,
  RunEventBatch,
  ReplayRunEventsRequest,
  WireRunEvent,
  GameforgeCapabilitySnapshot,
  RunEvent,
  Attempt,
  EvidenceSealResult,
  EvidenceSubmission,
  Project,
  StartAttemptInput,
  TaskAcceptanceContract,
} from "@gameforge/contracts";
import type { ZodType } from "zod";

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

export async function generateMusicAssetTool(
  provider: AudioGenerationProvider<MinimaxMusicRequest, MinimaxMusicResult>,
  store: AssetStore,
  request: MinimaxMusicRequest & { projectId: string } & AssetWriteControl,
): Promise<CallToolResult> {
  try {
    const { projectId, mode, expectedRevision, ...generationRequest } = request;
    await assertAssetWritePrecondition(store, projectId, generationRequest.assetId, mode, expectedRevision);
    const generated = await provider.execute(generationRequest);
    const stored = await store.store({
      projectId,
      bytes: generated.bytes,
      mimeType: generated.mimeType,
      provenance: generated.provenance,
      role: "bgm",
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
          error: "music_asset_generation_failed",
          message: error instanceof Error ? error.message : "Music asset generation failed.",
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

export type VerificationCriterionAuthority = {
  getAttempt(attemptId: string): Promise<Attempt>;
  getTask(taskId: string): Promise<GameTask>;
};

export async function verifyGameProjectTool(
  verifier: ProjectVerifier,
  request: VerifyGameRequest,
  criterionAuthority?: VerificationCriterionAuthority,
): Promise<CallToolResult> {
  try {
    const result = await verifier.verify(request);
    const criteria = await authoritativeCriterionResults(criterionAuthority, request, result);
    const diagnosticMessages = [...result.consoleErrors, ...result.pageErrors, ...result.failedRequests]
      .slice(0, verificationDiagnosticMessageLimit);
    const verificationEvent: Omit<Extract<RunEvent, { type: "verification.ready" }>, "runId" | "sequence" | "emittedAt"> = {
      type: "verification.ready",
      ...(request.attemptId === undefined ? {} : { attemptId: request.attemptId }),
      ...(request.revisionId === undefined ? {} : { revisionId: request.revisionId }),
      projectId: result.projectId,
      passed: result.passed,
      outcome: result.state.status,
      score: result.state.score,
      lives: result.state.lives,
      remainingSeconds: result.state.remainingSeconds,
      evidencePath: result.evidencePath,
      evidenceSha256: result.evidenceSha256,
      canvas: result.canvas,
      diagnostics: {
        consoleErrors: result.consoleErrors.length,
        pageErrors: result.pageErrors.length,
        failedRequests: result.failedRequests.length,
      },
      actionsExecuted: result.actionsExecuted,
      durationMs: result.durationMs,
      ...(result.actions === undefined ? {} : { actions: [...result.actions] }),
      ...(criteria === undefined ? {} : { criteria: [...criteria] }),
      ...(result.build === undefined ? {} : { build: result.build }),
      ...(result.versions === undefined ? {} : { versions: result.versions }),
      diagnosticMessages,
      evidencePaths: [result.evidencePath],
    };
    return {
      ...(result.passed ? {} : { isError: true }),
      content: [{ type: "text", text: JSON.stringify({ ...result, verificationEvent }, null, 2) }],
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

async function authoritativeCriterionResults(
  authority: VerificationCriterionAuthority | undefined,
  request: VerifyGameRequest,
  result: VerificationReport,
): Promise<ReadonlyArray<{ criterionId: string; passed: boolean }> | undefined> {
  if (request.attemptId === undefined) return result.criteria;
  if (authority === undefined) {
    if (result.criteria === undefined) return undefined;
    throw new Error("Attempt-bound criterion evaluation requires Authority.");
  }
  if (request.revisionId === undefined || request.contractVersion === undefined) {
    throw new Error("Authoritative criterion evaluation requires Attempt, Revision, and contract version.");
  }
  const attempt = await authority.getAttempt(request.attemptId);
  const task = await authority.getTask(attempt.taskId);
  const contract = task.acceptanceContract;
  if (contract === undefined ||
      attempt.attemptId !== request.attemptId || task.taskId !== attempt.taskId ||
      attempt.projectId !== request.projectId || attempt.projectId !== result.projectId ||
      attempt.revisionId !== request.revisionId ||
      attempt.acceptanceContractFingerprint !== contract.fingerprint ||
      contract.contractVersion !== request.contractVersion ||
      task.projectId !== attempt.projectId) {
    throw new Error("Verification request does not match the authoritative Attempt contract.");
  }
  return evaluateCriteria(contract, result);
}

function evaluateCriteria(
  contract: TaskAcceptanceContract,
  report: VerificationReport,
): ReadonlyArray<{ criterionId: string; passed: boolean }> {
  return contract.criteria.map((criterion) => {
    const verification = criterion.verification;
    if (verification.kind !== "public-telemetry" || verification.assertion === undefined) {
      return { criterionId: criterion.criterionId, passed: false };
    }
    const actual = readVerificationValue(report.state, verification.path);
    const assertion = verification.assertion;
    const passed = assertion.comparator === "includes"
      ? typeof actual === "string" && typeof assertion.value === "string" && actual.includes(assertion.value)
      : Object.is(actual, assertion.value);
    return { criterionId: criterion.criterionId, passed };
  });
}

function readVerificationValue(state: VerificationReport["state"], pathInput: string): unknown {
  const normalized = pathInput.trim() === "game.status" ? "status" : pathInput.trim().replace(/^\$\.?/, "");
  const segments = normalized.split(".").filter(Boolean);
  let value: unknown = state;
  for (const segment of segments) {
    if (typeof value !== "object" || value === null || !Object.prototype.hasOwnProperty.call(value, segment)) {
      return undefined;
    }
    value = (value as Record<string, unknown>)[segment];
  }
  return value;
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
    const generationEvent: Omit<Extract<RunEvent, { type: "project.generated" }>, "runId" | "sequence" | "emittedAt"> = {
      type: "project.generated",
      attemptId: request.attemptId,
      revisionId: request.revisionId,
      mode: result.mode,
      operation: result.operation,
      plan: result.plan,
      ...(result.update === undefined ? {} : { update: result.update }),
      ...(result.candidate === undefined ? {} : { candidate: result.candidate }),
    };
    const { outputPath: _outputPath, ...safeResult } = result;
    return {
      content: [{ type: "text", text: JSON.stringify({ ...safeResult, generationEvent }, null, 2) }],
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
  createTask(input: CreateGameTaskRequest): Promise<CreateGameTaskResponse>;
  listTasks(input: ListGameTasksRequest): Promise<ReadonlyArray<GameTask>>;
  getTask(taskId: string): Promise<GameTask>;
  claimTask(taskId: string, input: ClaimGameTaskRequest): Promise<GameTask>;
  compileTaskAcceptanceContract(taskId: string, input: CompileTaskAcceptanceContractInput): Promise<GameTaskAcceptanceCompileResult>;
  transitionTask(taskId: string, input: GameTaskTransitionRequest): Promise<GameTaskTransitionResult>;
};

export type ProjectRelayToolClient = {
  createProject(): Promise<Project>;
  getProject(projectId: string): Promise<Project>;
  startAttempt(input: StartAttemptInput): Promise<Attempt>;
  getAttempt(attemptId: string): Promise<Attempt>;
  retryAttempt(attemptId: string): Promise<Attempt>;
  submitAttemptEvidence(attemptId: string, input: EvidenceSubmission): Promise<EvidenceSealResult>;
};

export async function createGameProjectRecordTool(client: ProjectRelayToolClient): Promise<CallToolResult> {
  return relayResult(async () => ({ project: await client.createProject() }));
}

export async function getGameProjectRecordTool(
  client: ProjectRelayToolClient,
  projectId: string,
): Promise<CallToolResult> {
  return relayResult(async () => ({ project: await client.getProject(projectId) }));
}

export async function startGameAttemptTool(
  client: ProjectRelayToolClient,
  input: StartAttemptInput,
): Promise<CallToolResult> {
  return relayResult(async () => ({ attempt: await client.startAttempt(input) }));
}

export async function getGameAttemptTool(
  client: ProjectRelayToolClient,
  attemptId: string,
): Promise<CallToolResult> {
  return relayResult(async () => ({ attempt: await client.getAttempt(attemptId) }));
}

export async function retryGameAttemptTool(
  client: ProjectRelayToolClient,
  attemptId: string,
): Promise<CallToolResult> {
  return relayResult(async () => ({ attempt: await client.retryAttempt(attemptId) }));
}

export async function submitGameAttemptEvidenceTool(
  client: ProjectRelayToolClient,
  input: EvidenceSubmission,
): Promise<CallToolResult> {
  return relayResult(() => client.submitAttemptEvidence(input.attemptId, input));
}

export async function createGameTaskTool(
  client: TaskRelayToolClient,
  input: CreateGameTaskRequest,
): Promise<CallToolResult> {
  return relayResult(() => client.createTask(input));
}

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

export async function transitionGameTaskTool(
  client: TaskRelayToolClient,
  taskId: string,
  input: GameTaskTransitionRequest,
): Promise<CallToolResult> {
  return relayResult(() => client.transitionTask(taskId, input));
}

export async function freezeTaskAcceptanceContractTool(
  client: TaskRelayToolClient,
  taskId: string,
  input: CompileTaskAcceptanceContractInput,
): Promise<CallToolResult> {
  return relayResult(() => client.compileTaskAcceptanceContract(taskId, input));
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
