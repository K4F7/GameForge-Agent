import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  projectGenerationRequestSchema,
  projectIdSchema,
  claimGameTaskRequestSchema,
  gameTaskIdSchema,
  listGameTasksRequestSchema,
  runEventBatchSchema,
  replayRunEventsRequestSchema,
  runIdSchema,
  imageRuntimeAssetRoleSchema,
  type ImageGenerationProvider,
  type SoundSearchProvider,
  gameforgeCapabilitySnapshotSchema,
  type GameforgeCapabilitySnapshot,
} from "@gameforge/contracts";
import {
  draftGameSpecRequestSchema,
  freesoundSearchRequestSchema,
  freesoundPreviewRequestSchema,
  seedreamImageRequestSchema,
  submitAsyncTtsRequestSchema,
  asyncTtsJobRequestSchema,
  type FreesoundSearchRequest,
  type FreesoundSearchResult,
  type SeedreamImageRequest,
  type SeedreamImageResult,
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
  importSoundAssetTool,
  materializeVoiceJobTool,
  queryVoiceJobTool,
  submitVoiceJobTool,
  completeGameRunTool,
  claimGameTaskTool,
  createGameRunTool,
  getGameTaskTool,
  listGameTasksTool,
  publishRunEventsTool,
  replayGameRunTool,
  requestImageAssetTool,
  stopGameRunTool,
  startGamePreviewTool,
  stopGamePreviewTool,
  verifyGameProjectTool,
  getGameforgeCapabilitiesTool,
  getProjectAssetsTool,
  type GameSpecDraftProvider,
  type ProjectGenerator,
  type AssetStore,
  type FreesoundPreviewToolProvider,
  type AsyncTtsToolProvider,
  type RunRelayToolClient,
  type TaskRelayToolClient,
  type ProjectVerifier,
  type ProjectPreviewManager,
} from "./tools.js";

export type CreateServerOptions = {
  gameSpecDraftProvider?: GameSpecDraftProvider;
  assetStore?: AssetStore;
  imageProvider?: ImageGenerationProvider<SeedreamImageRequest, SeedreamImageResult>;
  soundPreviewProvider?: FreesoundPreviewToolProvider;
  asyncTtsProvider?: AsyncTtsToolProvider;
  projectVerifier?: ProjectVerifier;
  projectPreviewManager?: ProjectPreviewManager;
  projectGenerator?: ProjectGenerator;
  runRelayClient?: RunRelayToolClient;
  taskRelayClient?: TaskRelayToolClient;
  soundSearchProvider?: SoundSearchProvider<FreesoundSearchRequest, FreesoundSearchResult>;
};

export function createServer(options: CreateServerOptions = {}): McpServer {
  const server = new McpServer({
    name: "gameforge",
    version: "0.1.0",
  });

  const capabilitySnapshot: GameforgeCapabilitySnapshot = gameforgeCapabilitySnapshotSchema.parse({
    providers: {
      spec: { provider: "bailian-qwen", ready: options.gameSpecDraftProvider !== undefined },
      image: { provider: "volcengine-ark", ready: options.imageProvider !== undefined && options.assetStore !== undefined },
      tts: { provider: "volcengine-speech", ready: options.asyncTtsProvider !== undefined && options.assetStore !== undefined },
      sound: { provider: "freesound", ready: options.soundSearchProvider !== undefined && options.soundPreviewProvider !== undefined && options.assetStore !== undefined },
    },
    engineering: {
      assetStore: options.assetStore?.read !== undefined,
      generator: options.projectGenerator !== undefined,
      verifier: options.projectVerifier !== undefined,
      preview: options.projectPreviewManager !== undefined,
      runRelay: options.runRelayClient !== undefined,
      taskInbox: options.taskRelayClient !== undefined,
    },
  });

  server.registerTool(
    "get_gameforge_capabilities",
    {
      title: "Inspect configured GameForge capabilities",
      description: "Return a secret-free snapshot of the adapters actually registered in this MCP process.",
      inputSchema: {},
    },
    async () => getGameforgeCapabilitiesTool(capabilitySnapshot),
  );

  if (options.assetStore?.read !== undefined) {
    const reader = { read: options.assetStore.read.bind(options.assetStore) };
    server.registerTool(
      "get_project_assets",
      {
        title: "Read one managed project's asset manifest",
        description: "Read and validate the authoritative runtime asset manifest without downloading or modifying assets.",
        inputSchema: { projectId: projectIdSchema },
      },
      async ({ projectId }) => getProjectAssetsTool(reader, projectId),
    );
  }

  server.registerTool(
    "validate_game_spec",
    {
      title: "Validate game specification",
      description: "Validate a structured game requirement before implementation starts.",
      inputSchema: {
        spec: z.unknown().describe("A candidate GameForge game specification"),
      },
    },
    async ({ spec }) => validateGameSpecTool(spec),
  );

  server.registerTool(
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

  server.registerTool(
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
    server.registerTool(
      "generate_game_project",
      {
        title: "Generate a deterministic Phaser project",
        description:
          "Create a fixed, versioned Phaser template from a validated GameSpec. Defaults to dry-run; apply only creates a new project under the server-configured output root.",
        inputSchema: projectGenerationRequestSchema.shape,
      },
      async (request) => generateGameProjectTool(projectGenerator, request),
    );
  }

  if (options.runRelayClient !== undefined) {
    const runRelayClient = options.runRelayClient;
    server.registerTool(
      "create_game_run",
      {
        title: "Create a game production run",
        description: "Create one Run Relay record and receive the authoritative run.started event.",
        inputSchema: { runId: runIdSchema },
      },
      async ({ runId }) => createGameRunTool(runRelayClient, runId),
    );
    server.registerTool(
      "replay_game_run",
      {
        title: "Replay game production events",
        description:
          "Read one bounded RunEvent page after an explicit cursor. CodeArts uses this to inspect current state; the tool never polls or retries.",
        inputSchema: replayRunEventsRequestSchema.shape,
      },
      async (request) => replayGameRunTool(runRelayClient, request),
    );
    server.registerTool(
      "publish_run_events",
      {
        title: "Publish game production events",
        description: "Append one strictly contiguous RunEvent batch. CodeArts owns planning and cursor reconciliation.",
        inputSchema: runEventBatchSchema.shape,
      },
      async (batch) => publishRunEventsTool(runRelayClient, batch),
    );
    server.registerTool(
      "complete_game_run",
      {
        title: "Complete a game production run",
        description: "Mark one Run Relay record completed. The operation is idempotent for the same terminal state.",
        inputSchema: { runId: runIdSchema },
      },
      async ({ runId }) => completeGameRunTool(runRelayClient, runId),
    );
    server.registerTool(
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
    server.registerTool(
      "list_game_tasks",
      {
        title: "List game build tasks",
        description: "List one bounded snapshot of queued, claimed, or terminal Workbench tasks. CodeArts can resume its own claimed tasks; this never polls or executes them.",
        inputSchema: listGameTasksRequestSchema.shape,
      },
      async (request) => listGameTasksTool(taskRelayClient, request),
    );
    server.registerTool(
      "get_game_task",
      {
        title: "Read one game build task",
        description: "Read one validated task prompt and its authoritative Run ID.",
        inputSchema: { taskId: gameTaskIdSchema },
      },
      async ({ taskId }) => getGameTaskTool(taskRelayClient, taskId),
    );
    server.registerTool(
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
    server.registerTool(
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
    server.registerTool(
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
    server.registerTool(
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
    server.registerTool(
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

  if (options.asyncTtsProvider !== undefined && options.assetStore !== undefined) {
    const asyncTtsProvider = options.asyncTtsProvider;
    const assetStore = options.assetStore;
    server.registerTool(
      "submit_voice_job",
      {
        title: "Submit an asynchronous voice generation job",
        description:
          "Submit one official Volcengine long-text TTS job. The tool returns immediately and never polls internally.",
        inputSchema: submitAsyncTtsRequestSchema.shape,
      },
      async (request) => submitVoiceJobTool(asyncTtsProvider, request),
    );
    server.registerTool(
      "query_voice_job",
      {
        title: "Query one voice generation job",
        description:
          "Query one signed, project-bound Volcengine TTS job exactly once. CodeArts decides when another query is appropriate.",
        inputSchema: asyncTtsJobRequestSchema.shape,
      },
      async (request) => queryVoiceJobTool(asyncTtsProvider, request),
    );
    server.registerTool(
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
    server.registerTool(
      "verify_game_project",
      {
        title: "Verify a generated game in a browser",
        description:
          "Start one managed generated project locally, execute a bounded deterministic input script in system Chrome, capture browser diagnostics and a screenshot, then return the explicit game outcome. No repair or Agent loop runs inside this tool.",
        inputSchema: verifyGameRequestSchema.shape,
      },
      async (request) => verifyGameProjectTool(projectVerifier, request),
    );
  }

  if (options.projectPreviewManager !== undefined) {
    const projectPreviewManager = options.projectPreviewManager;
    server.registerTool(
      "start_game_preview",
      {
        title: "Start a managed game preview",
        description:
          "Start or reuse one loopback Vite preview for a generator-managed project without executing the project's Vite config. Returns a URL; CodeArts may publish it as a preview.ready RunEvent.",
        inputSchema: gamePreviewRequestSchema.shape,
      },
      async (request) => startGamePreviewTool(projectPreviewManager, request),
    );
    server.registerTool(
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
