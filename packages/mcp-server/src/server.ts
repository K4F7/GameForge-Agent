import {
  McpServer,
  type RegisteredTool,
  type ToolCallback,
} from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult, ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import {
  projectGenerationRequestSchema,
  projectIdSchema,
  createGameTaskRequestSchema,
  claimGameTaskRequestSchema,
  gameTaskIdSchema,
  listGameTasksRequestSchema,
  runEventBatchSchema,
  replayRunEventsRequestSchema,
  runIdSchema,
  imageRuntimeAssetRoleSchema,
  type ImageGenerationProvider,
  type AudioGenerationProvider,
  type SoundSearchProvider,
  gameforgeCapabilitySnapshotSchema,
  type GameforgeCapabilitySnapshot,
  agentModelRoleSchema,
  modelTargetSchema,
  resolveAgentModelRoute,
  type ModelRoutingPolicy,
  type RunEvent,
} from "@gameforge/contracts";
import {
  draftGameSpecRequestSchema,
  freesoundSearchRequestSchema,
  freesoundPreviewRequestSchema,
  seedreamImageRequestSchema,
  minimaxMusicRequestSchema,
  submitAsyncTtsRequestSchema,
  asyncTtsJobRequestSchema,
  type FreesoundSearchRequest,
  type FreesoundSearchResult,
  type SeedreamImageRequest,
  type SeedreamImageResult,
  type MinimaxMusicRequest,
  type MinimaxMusicResult,
} from "@gameforge/providers";
import { z } from "zod";
import { gamePreviewRequestSchema, verifyGameRequestSchema } from "@gameforge/game-verifier";
import {
  validateAssetManifestTool,
  validateGameSpecTool,
  validateProviderConfigTool,
  searchSoundAssetTool,
  draftGameSpecTool,
  generateGameProjectTool,
  recoverGameProjectUpdateTool,
  importSoundAssetTool,
  materializeVoiceJobTool,
  queryVoiceJobTool,
  submitVoiceJobTool,
  completeGameRunTool,
  claimGameTaskTool,
  createGameTaskTool,
  createGameRunTool,
  getGameTaskTool,
  listGameTasksTool,
  publishRunEventsTool,
  replayGameRunTool,
  requestImageAssetTool,
  generateMusicAssetTool,
  stopGameRunTool,
  startGamePreviewTool,
  stopGamePreviewTool,
  verifyGameProjectTool,
  getGameforgeCapabilitiesTool,
  getProjectAssetsTool,
  recoverProjectAssetsTool,
  type GameSpecDraftProvider,
  type ProjectGenerator,
  type AssetStore,
  type FreesoundPreviewToolProvider,
  type AsyncTtsToolProvider,
  type RunRelayToolClient,
  type TaskRelayToolClient,
  type ProjectVerifier,
  type ProjectPreviewManager,
  type DouyinProjectBuilder,
  type DouyinMiniGameCliStatusProvider,
  type WechatProjectBuilder,
  type LayaGameplayVerifier,
} from "./tools.js";
import type { ToolAuditContextBinder, ToolAuditRecorder, ToolAuditSummaryProvider } from "./tool-audit.js";
import type { DouyinBridgePort } from "./douyin-bridge-controller.js";

export type CreateServerOptions = {
  gameSpecDraftProvider?: GameSpecDraftProvider;
  assetStore?: AssetStore;
  imageProvider?: ImageGenerationProvider<SeedreamImageRequest, SeedreamImageResult>;
  musicProvider?: AudioGenerationProvider<MinimaxMusicRequest, MinimaxMusicResult>;
  soundPreviewProvider?: FreesoundPreviewToolProvider;
  asyncTtsProvider?: AsyncTtsToolProvider;
  projectVerifier?: ProjectVerifier;
  projectPreviewManager?: ProjectPreviewManager;
  projectGenerator?: ProjectGenerator;
  douyinProjectBuilder?: DouyinProjectBuilder;
  douyinMiniGameCliProbe?: DouyinMiniGameCliStatusProvider;
  wechatProjectBuilder?: WechatProjectBuilder;
  layaGameplayVerifier?: LayaGameplayVerifier;
  runRelayClient?: RunRelayToolClient;
  taskRelayClient?: TaskRelayToolClient;
  soundSearchProvider?: SoundSearchProvider<FreesoundSearchRequest, FreesoundSearchResult>;
  toolAudit?: ToolAuditRecorder & Partial<ToolAuditContextBinder & ToolAuditSummaryProvider>;
  modelRoutingPolicy?: ModelRoutingPolicy;
  douyinBridgeController?: DouyinBridgePort;
};

export function createServer(options: CreateServerOptions = {}): McpServer {
  const server = new McpServer({
    name: "gameforge",
    version: "0.1.0",
  });
  const registerTool = <InputArgs extends Record<string, z.ZodType>>(
    name: string,
    config: { title?: string; description?: string; inputSchema: InputArgs; annotations?: ToolAnnotations },
    callback: (args: z.infer<z.ZodObject<InputArgs>>) => CallToolResult | Promise<CallToolResult>,
  ): RegisteredTool => {
    const auditedCallback = (async (args: unknown) => {
      const token = options.toolAudit?.begin(name);
      try {
        const result = await callback(args as z.infer<z.ZodObject<InputArgs>>);
        if (token !== undefined) await options.toolAudit?.finish(token, result.isError === true ? "error" : "success");
        return result;
      } catch (error) {
        if (token !== undefined) await options.toolAudit?.finish(token, "error");
        throw error;
      }
    }) as unknown as ToolCallback<InputArgs>;
    return server.registerTool(name, config, auditedCallback);
  };

  const capabilitySnapshot: GameforgeCapabilitySnapshot = gameforgeCapabilitySnapshotSchema.parse({
    providers: {
      spec: { provider: "bailian-qwen", ready: options.gameSpecDraftProvider !== undefined },
      image: { provider: "volcengine-ark", ready: options.imageProvider !== undefined && options.assetStore !== undefined },
      tts: { provider: "volcengine-speech", ready: options.asyncTtsProvider !== undefined && options.assetStore !== undefined },
      sound: { provider: "freesound", ready: options.soundSearchProvider !== undefined && options.soundPreviewProvider !== undefined && options.assetStore !== undefined },
      music: { provider: "minimax", ready: options.musicProvider !== undefined && options.assetStore !== undefined },
    },
    engineering: {
      assetStore: options.assetStore?.read !== undefined && options.assetStore.recover !== undefined,
      generator: options.projectGenerator?.recover !== undefined,
      verifier: options.projectVerifier !== undefined,
      preview: options.projectPreviewManager !== undefined,
      runRelay: options.runRelayClient !== undefined,
      taskInbox: options.taskRelayClient !== undefined,
    },
  });

  registerTool(
    "get_gameforge_capabilities",
    {
      title: "Inspect configured GameForge capabilities",
      description: "Return a secret-free snapshot of the adapters actually registered in this MCP process.",
      inputSchema: {},
    },
    async () => getGameforgeCapabilitiesTool(capabilitySnapshot),
  );

  if (options.modelRoutingPolicy !== undefined) {
    registerTool(
      "get_agent_model_route",
      {
        title: "Resolve one CodeArts Agent model route",
        description:
          "Resolve a secret-free domestic-model route against exact targets reported by the host. This does not call a model or run an Agent loop.",
        inputSchema: {
          role: agentModelRoleSchema,
          availableTargets: z.array(modelTargetSchema).max(100),
          explicitOverride: modelTargetSchema.optional(),
        },
      },
      async ({ role, availableTargets, explicitOverride }) => {
        const route = options.modelRoutingPolicy!.agent[role];
        if (route === undefined) {
          return { isError: true, content: [{ type: "text", text: `No ${role} route is configured.` }] };
        }
        const resolution = resolveAgentModelRoute(route, availableTargets, explicitOverride);
        return {
          content: [{ type: "text", text: JSON.stringify({ role, reasoning: route.reasoning, ...resolution }, null, 2) }],
        };
      },
    );
  }

  if (options.toolAudit?.bindContext !== undefined) {
    registerTool(
      "bind_mcp_audit_context",
      {
        title: "Bind this MCP audit session to one Task and Run",
        description: "Persist one immutable Task/Run association in the active secret-free MCP audit session.",
        inputSchema: { taskId: gameTaskIdSchema, runId: runIdSchema },
      },
      async ({ taskId, runId }) => {
        try {
          const context = await options.toolAudit!.bindContext!(taskId, runId);
          return { content: [{ type: "text", text: JSON.stringify(context, null, 2) }] };
        } catch {
          return {
            isError: true,
            content: [{ type: "text", text: "MCP audit context binding failed." }],
          };
        }
      },
    );
  }

  if (options.toolAudit?.getSummary !== undefined) {
    registerTool(
      "get_mcp_audit_summary",
      {
        title: "Read the redacted MCP audit summary",
        description: "Return a bounded Task/Run-bound audit projection containing only tool order, name, outcome, and duration. Arguments, results, paths, timestamps, session IDs, prompts, URLs, and credentials are excluded.",
        inputSchema: {},
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      },
      async () => {
        try {
          const summary = await options.toolAudit!.getSummary!();
          const auditEvent: Omit<Extract<RunEvent, { type: "mcp.audit.ready" }>, "runId" | "sequence" | "emittedAt"> = {
            type: "mcp.audit.ready",
            truncated: summary.truncated,
            totalCalls: summary.totalCalls,
            calls: [...summary.calls],
          };
          return { content: [{ type: "text", text: JSON.stringify({ auditEvent }, null, 2) }] };
        } catch {
          return { isError: true, content: [{ type: "text", text: "MCP audit summary is unavailable until the audit is bound to a Task and Run." }] };
        }
      },
    );
  }

  if (options.assetStore?.read !== undefined) {
    const reader = { read: options.assetStore.read.bind(options.assetStore) };
    registerTool(
      "get_project_assets",
      {
        title: "Read one managed project's asset manifest",
        description: "Read and validate the authoritative runtime asset manifest without downloading or modifying assets.",
        inputSchema: { projectId: projectIdSchema },
      },
      async ({ projectId }) => getProjectAssetsTool(reader, projectId),
    );
  }

  if (options.assetStore?.recover !== undefined) {
    const recovery = { recover: options.assetStore.recover.bind(options.assetStore) };
    registerTool(
      "recover_project_assets",
      {
        title: "Recover an interrupted asset transaction",
        description:
          "Under the project asset write lock, validate a persisted transaction log and either roll it back or finish cleanup according to the authoritative manifest. No Provider is called.",
        inputSchema: { projectId: projectIdSchema },
      },
      async ({ projectId }) => recoverProjectAssetsTool(recovery, projectId),
    );
  }

  registerTool(
    "validate_game_spec",
    {
      title: "Validate game specification",
      description:
        "Validate a structured game requirement before implementation starts. Pass spec as a JSON object, never as a JSON-encoded string.",
      inputSchema: {
        spec: z.object({}).passthrough().describe(
          "A candidate GameForge game specification passed directly as a JSON object, not a JSON-encoded string. Malformed objects return structured validation issues.",
        ),
      },
    },
    async ({ spec }) => validateGameSpecTool(spec),
  );

  registerTool(
    "validate_provider_config",
    {
      title: "Validate provider configuration",
      description:
        "Validate model and media provider routing without accepting credentials or secret values.",
      inputSchema: {
        config: z.unknown().describe("A candidate GameForge provider configuration"),
      },
    },
    async ({ config }) => validateProviderConfigTool(config),
  );

  registerTool(
    "validate_asset_manifest",
    {
      title: "Validate asset provenance manifest",
      description:
        "Validate generated, retrieved, and procedural game asset provenance before packaging.",
      inputSchema: {
        manifest: z.unknown().describe("A candidate GameForge asset provenance manifest"),
      },
    },
    async ({ manifest }) => validateAssetManifestTool(manifest),
  );

  if (options.projectGenerator !== undefined) {
    const projectGenerator = options.projectGenerator;
    registerTool(
      "generate_game_project",
      {
        title: "Generate a deterministic managed game project",
        description:
          "Create or safely update a fixed, versioned Web Phaser source project from a validated GameSpec. Defaults to create dry-run. Update apply requires the current plan hash returned by update dry-run and refuses modified managed files or target changes.",
        inputSchema: projectGenerationRequestSchema.shape,
      },
      async (request) => generateGameProjectTool(projectGenerator, request),
    );
  }

  if (options.projectGenerator?.recover !== undefined) {
    const recovery = { recover: options.projectGenerator.recover.bind(options.projectGenerator) };
    registerTool(
      "recover_game_project_update",
      {
        title: "Recover an interrupted managed project update",
        description:
          "Under the managed project update lock, validate the persisted transaction and either roll it back or finish cleanup according to the managed manifest. No model or Provider is called.",
        inputSchema: { projectId: projectIdSchema },
      },
      async ({ projectId }) => recoverGameProjectUpdateTool(recovery, projectId),
    );
  }

  if (options.runRelayClient !== undefined) {
    const runRelayClient = options.runRelayClient;
    registerTool(
      "create_game_run",
      {
        title: "Create a game production run",
        description: "Create one Run Relay record and receive the authoritative run.started event.",
        inputSchema: { runId: runIdSchema },
      },
      async ({ runId }) => createGameRunTool(runRelayClient, runId),
    );
    registerTool(
      "replay_game_run",
      {
        title: "Replay game production events",
        description:
          "Read one bounded RunEvent page after an explicit cursor. CodeArts uses this to inspect current state; the tool never polls or retries.",
        inputSchema: replayRunEventsRequestSchema.shape,
      },
      async (request) => replayGameRunTool(runRelayClient, request),
    );
    registerTool(
      "publish_run_events",
      {
        title: "Publish game production events",
        description: "Append one strictly contiguous RunEvent batch. CodeArts owns planning and cursor reconciliation.",
        inputSchema: runEventBatchSchema.shape,
      },
      async (batch) => publishRunEventsTool(runRelayClient, batch),
    );
    registerTool(
      "complete_game_run",
      {
        title: "Complete a game production run",
        description: "Mark one Run Relay record completed. The operation is idempotent for the same terminal state.",
        inputSchema: { runId: runIdSchema },
      },
      async ({ runId }) => completeGameRunTool(runRelayClient, runId),
    );
    registerTool(
      "stop_game_run",
      {
        title: "Stop a game production run",
        description: "Mark one Run Relay record stopped. The operation is idempotent for the same terminal state.",
        inputSchema: { runId: runIdSchema },
      },
      async ({ runId }) => stopGameRunTool(runRelayClient, runId),
    );
  }

  if (options.taskRelayClient !== undefined) {
    const taskRelayClient = options.taskRelayClient;
    registerTool(
      "create_game_task",
      {
        title: "Create one game build task",
        description:
          "Atomically create one queued Task and its authoritative Run. The same runId and identical request are idempotent; conflicting reuse is rejected.",
        inputSchema: createGameTaskRequestSchema.shape,
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      async (request) => createGameTaskTool(taskRelayClient, request),
    );
    registerTool(
      "list_game_tasks",
      {
        title: "List game build tasks",
        description: "List one bounded snapshot of queued, claimed, or terminal GameForge tasks. CodeArts can resume its own claimed tasks; this never polls or executes them.",
        inputSchema: listGameTasksRequestSchema.shape,
      },
      async (request) => listGameTasksTool(taskRelayClient, request),
    );
    registerTool(
      "get_game_task",
      {
        title: "Read one game build task",
        description: "Read one validated task prompt and its authoritative Run ID.",
        inputSchema: { taskId: gameTaskIdSchema },
      },
      async ({ taskId }) => getGameTaskTool(taskRelayClient, taskId),
    );
    registerTool(
      "claim_game_task",
      {
        title: "Claim one game build task",
        description: "Atomically claim one queued task for CodeArts. Repeating the same agent claim is idempotent.",
        inputSchema: { taskId: gameTaskIdSchema, ...claimGameTaskRequestSchema.shape },
      },
      async ({ taskId, agentId }) => claimGameTaskTool(taskRelayClient, taskId, { agentId }),
    );
  }


  if (options.gameSpecDraftProvider !== undefined) {
    const gameSpecDraftProvider = options.gameSpecDraftProvider;
    registerTool(
      "draft_game_spec",
      {
        title: "Draft a validated game specification",
        description:
          "Perform one official Bailian Qwen request using strict JSON Schema, then validate the result as GameSpec. Credentials remain in the server environment.",
        inputSchema: draftGameSpecRequestSchema.shape,
      },
      async (request) => draftGameSpecTool(gameSpecDraftProvider, request),
    );
  }

  if (options.soundSearchProvider !== undefined) {
    const soundSearchProvider = options.soundSearchProvider;
    registerTool(
      "search_sound_asset",
      {
        title: "Search licensed sound assets",
        description:
          "Perform one deterministic Freesound search, restricted to CC0 and/or Attribution results. Credentials are supplied only by the server environment.",
        inputSchema: freesoundSearchRequestSchema.shape,
      },
      async (request) => searchSoundAssetTool(soundSearchProvider, request),
    );
  }

  if (options.imageProvider !== undefined && options.assetStore !== undefined) {
    const imageProvider = options.imageProvider;
    const assetStore = options.assetStore;
    registerTool(
      "request_image_asset",
      {
        title: "Generate and store a game image asset",
        description:
          "Perform one official Seedream request and store the verified result in an existing generated project. Set mode=replace with the current expectedRevision to overwrite the same assetId. Credentials stay in the server environment.",
        inputSchema: {
          projectId: projectIdSchema,
          ...seedreamImageRequestSchema.shape,
          role: imageRuntimeAssetRoleSchema.optional(),
          mode: z.enum(["create", "replace"]).optional(),
          expectedRevision: z.number().int().nonnegative().optional(),
        },
      },
      async (request) => requestImageAssetTool(imageProvider, assetStore, request),
    );
  }

  if (options.soundPreviewProvider !== undefined && options.assetStore !== undefined) {
    const soundPreviewProvider = options.soundPreviewProvider;
    const assetStore = options.assetStore;
    registerTool(
      "import_sound_asset",
      {
        title: "Import a licensed Freesound preview",
        description:
          "Fetch one selected official Freesound preview, verify its bytes, and store it with source, license, attribution, and hash metadata. Replacement requires mode=replace and the current expectedRevision.",
        inputSchema: {
          projectId: projectIdSchema,
          ...freesoundPreviewRequestSchema.shape,
          role: z.enum(["collect-sound", "hit-sound", "bgm"]).optional(),
          mode: z.enum(["create", "replace"]).optional(),
          expectedRevision: z.number().int().nonnegative().optional(),
        },
      },
      async (request) => importSoundAssetTool(soundPreviewProvider, assetStore, request),
    );
  }

  if (options.musicProvider !== undefined && options.assetStore !== undefined) {
    const musicProvider = options.musicProvider;
    const assetStore = options.assetStore;
    registerTool(
      "generate_music_asset",
      {
        title: "Generate and store instrumental game music",
        description:
          "Perform one official MiniMax Music 2.6 request for instrumental MP3 and store it as the project's BGM. No automatic generation retry is performed. Replacement requires mode=replace and the current expectedRevision.",
        inputSchema: {
          projectId: projectIdSchema,
          ...minimaxMusicRequestSchema.shape,
          mode: z.enum(["create", "replace"]).optional(),
          expectedRevision: z.number().int().nonnegative().optional(),
        },
      },
      async (request) => generateMusicAssetTool(musicProvider, assetStore, request),
    );
  }

  if (options.asyncTtsProvider !== undefined && options.assetStore !== undefined) {
    const asyncTtsProvider = options.asyncTtsProvider;
    const assetStore = options.assetStore;
    registerTool(
      "submit_voice_job",
      {
        title: "Submit an asynchronous voice generation job",
        description:
          "Submit one official Volcengine long-text TTS job. The tool returns immediately and never polls internally.",
        inputSchema: submitAsyncTtsRequestSchema.shape,
      },
      async (request) => submitVoiceJobTool(asyncTtsProvider, request),
    );
    registerTool(
      "query_voice_job",
      {
        title: "Query one voice generation job",
        description:
          "Query one signed, project-bound Volcengine TTS job exactly once. CodeArts decides when another query is appropriate.",
        inputSchema: asyncTtsJobRequestSchema.shape,
      },
      async (request) => queryVoiceJobTool(asyncTtsProvider, request),
    );
    registerTool(
      "materialize_voice_job",
      {
        title: "Materialize one completed voice job",
        description:
          "Query one completed TTS job, download its audio once from an allowed host, verify it, and store it as the project's voice asset. Replacement requires mode=replace and the current expectedRevision.",
        inputSchema: {
          ...asyncTtsJobRequestSchema.shape,
          mode: z.enum(["create", "replace"]).optional(),
          expectedRevision: z.number().int().nonnegative().optional(),
        },
      },
      async (request) => materializeVoiceJobTool(asyncTtsProvider, assetStore, request),
    );
  }

  if (options.projectVerifier !== undefined) {
    const projectVerifier = options.projectVerifier;
    registerTool(
      "verify_game_project",
      {
        title: "Verify a generated game in a browser",
        description:
          "Start one managed generated project locally and execute a bounded deterministic input script in system Chrome. Pass inline actions for small probes, or scenario=won|lost to load that named script from .gameforge/verification-scenarios.json without embedding a long tool argument. Captures browser diagnostics and a screenshot, then returns the explicit game outcome. No repair or Agent loop runs inside this tool.",
        inputSchema: verifyGameRequestSchema.shape,
      },
      async (request) => verifyGameProjectTool(projectVerifier, request),
    );
  }

  if (options.projectPreviewManager !== undefined) {
    const projectPreviewManager = options.projectPreviewManager;
    registerTool(
      "start_game_preview",
      {
        title: "Start a managed game preview",
        description:
          "Start or reuse one loopback Vite preview for a generator-managed project without executing the project's Vite config. Returns a URL; CodeArts may publish it as a preview.ready RunEvent.",
        inputSchema: gamePreviewRequestSchema.shape,
      },
      async (request) => startGamePreviewTool(projectPreviewManager, request),
    );
    registerTool(
      "stop_game_preview",
      {
        title: "Stop a managed game preview",
        description: "Stop one active managed preview. The operation is idempotent when no session exists.",
        inputSchema: gamePreviewRequestSchema.shape,
      },
      async (request) => stopGamePreviewTool(projectPreviewManager, request),
    );
  }

  return server;
}
