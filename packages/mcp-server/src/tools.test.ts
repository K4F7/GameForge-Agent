import { defaultProviderConfig } from "@gameforge/contracts";
import { describe, expect, it } from "vitest";
import type { SoundSearchProvider } from "@gameforge/contracts";
import type { FreesoundSearchRequest, FreesoundSearchResult } from "@gameforge/providers";
import type { ProjectGenerationResult } from "@gameforge/contracts";
import type { VerifyGameRequest } from "@gameforge/game-verifier";
import {
  draftGameSpecTool,
  getProjectAssetsTool,
  recoverProjectAssetsTool,
  generateGameProjectTool,
  generateMusicAssetTool,
  recoverGameProjectUpdateTool,
  importSoundAssetTool,
  completeGameRunTool,
  createGameTaskTool,
  createGameRunTool,
  publishRunEventsTool,
  replayGameRunTool,
  requestImageAssetTool,
  materializeVoiceJobTool,
  queryVoiceJobTool,
  submitVoiceJobTool,
  verifyGameProjectTool,
  stopGameRunTool,
  searchSoundAssetTool,
  buildDouyinMiniGameTool,
  buildWechatMiniGameTool,
  verifyMiniGameGameplayTool,
  validateAssetManifestTool,
  validateGameSpecTool,
  validateProviderConfigTool,
} from "./tools.js";

function readJsonResult(result: ReturnType<typeof validateGameSpecTool>): unknown {
  const firstContent = result.content[0];

  if (firstContent?.type !== "text") {
    throw new Error("Expected a text tool result.");
  }

  return JSON.parse(firstContent.text) as unknown;
}

describe("validation tool handlers", () => {
  it("returns a path-free build event payload beside the local Douyin output", async () => {
    const result = await buildDouyinMiniGameTool({
      async build(projectId) {
        return {
          projectId,
          cliVersion: "3.4.0",
          outputPath: "D:/private/generated/safe-game/release/bytedancegame",
          validation: {
            platform: "douyin-mini-game",
            passed: true,
            projectId,
            fileCount: 16,
            totalBytes: 1_108_438,
            mainPackageBytes: 1_108_438,
            subpackages: [],
            deviceOrientation: "portrait",
            capabilities: { network: false, login: false, share: false, ads: false, payments: false },
            allowedNetworkHosts: [],
            assetManifestRevision: 2,
            assetCount: 2,
          },
          stdoutTruncated: false,
          stderrTruncated: false,
        };
      },
    }, "safe-game");
    const parsed = readJsonResult(result) as { outputPath?: string; buildEvent?: Record<string, unknown> };
    expect(parsed).not.toHaveProperty("outputPath");
    expect(parsed.buildEvent).toMatchObject({ type: "build.ready", projectId: "safe-game", assetManifestRevision: 2 });
    expect(parsed.buildEvent).not.toHaveProperty("outputPath");
  });

  it("returns a path-free WeChat build event from the wxgame artifact", async () => {
    const result = await buildWechatMiniGameTool({
      async build(projectId) {
        return {
          projectId,
          cliVersion: "3.4.0",
          outputPath: "D:/private/generated/safe-game/release/wxgame",
          validation: {
            platform: "wechat-mini-game", passed: true, projectId,
            fileCount: 14, totalBytes: 1_113_109, mainPackageBytes: 1_113_109, subpackages: [],
            deviceOrientation: "portrait",
            capabilities: { network: false, login: false, share: false, ads: false, payments: false },
            allowedNetworkHosts: [], assetManifestRevision: 0, assetCount: 0,
          },
          stdoutTruncated: false,
          stderrTruncated: false,
        };
      },
    }, "safe-game");
    const parsed = readJsonResult(result) as { outputPath?: string; buildEvent?: Record<string, unknown> };
    expect(parsed).not.toHaveProperty("outputPath");
    expect(parsed.buildEvent).toMatchObject({ type: "build.ready", target: "wechat-mini-game" });
  });

  it("returns an explicitly non-visual mini-game gameplay event", async () => {
    const result = await verifyMiniGameGameplayTool({
      async verify(projectId) {
        return {
          projectId, target: "wechat-mini-game", genre: "arcade", passed: true,
          scenarios: [
            { name: "genre-win", outcome: "won", actions: 2 },
            { name: "timeout-loss", outcome: "lost", actions: 1 },
          ],
          durationMs: 45,
          templateSha256: "a".repeat(64),
        };
      },
    }, "safe-game");
    const parsed = readJsonResult(result) as { report?: Record<string, unknown>; gameplayEvent?: Record<string, unknown> };
    expect(parsed.gameplayEvent).toMatchObject({ type: "gameplay.verified", target: "wechat-mini-game" });
    expect(parsed.gameplayEvent).not.toHaveProperty("evidencePath");
    expect(parsed.gameplayEvent).not.toHaveProperty("canvas");
  });

  it("returns validated game specifications", () => {
    const result = validateGameSpecTool({
      title: "Safety Sprint",
      genre: "arcade",
      objective: "Collect all safety equipment before the timer expires.",
      controls: ["Arrow keys to move"],
      winCondition: "Collect all required equipment.",
      loseCondition: "The timer reaches zero.",
      targetDurationSeconds: 90,
    });

    expect(result.isError).not.toBe(true);
    expect(readJsonResult(result)).toMatchObject({
      valid: true,
      spec: { title: "Safety Sprint" },
    });
  });

  it("returns structured issues for malformed GameSpec objects", () => {
    const result = validateGameSpecTool({ title: "Broken" });
    expect(result.isError).toBe(true);
    expect(readJsonResult(result)).toMatchObject({
      valid: false,
      issues: expect.any(Array),
    });
  });

  it("rejects provider configuration containing secret fields", () => {
    const result = validateProviderConfigTool({
      ...defaultProviderConfig,
      apiKey: "must-not-be-accepted",
    });

    expect(result.isError).toBe(true);
    expect(readJsonResult(result)).toMatchObject({ valid: false });
  });

  it("rejects manifests with duplicate asset IDs", () => {
    const asset = {
      assetId: "sounds/jump.wav",
      kind: "sound",
      origin: "retrieved",
      provider: "freesound",
      sourceUrl: "https://freesound.org/people/example/sounds/123/",
      license: "CC0-1.0",
      sha256: "a".repeat(64),
    };
    const result = validateAssetManifestTool({
      schemaVersion: "1.0",
      projectId: "safety-sprint",
      generatedAt: "2026-07-16T05:30:00+08:00",
      assets: [asset, asset],
    });

    expect(result.isError).toBe(true);
    expect(readJsonResult(result)).toMatchObject({ valid: false });
  });


  it("drafts one validated GameSpec through an injected Qwen provider", async () => {
    const calls: string[] = [];
    const result = await draftGameSpecTool({
      async execute(request) {
        calls.push(request.prompt);
        return {
          model: "qwen3.6-flash",
          spec: {
            title: "Safety Sprint",
            genre: "arcade",
            objective: "Collect all safety equipment before time expires.",
            controls: ["Arrow keys"],
            winCondition: "Collect every equipment item.",
            loseCondition: "Time expires or all lives are lost.",
            targetDurationSeconds: 90,
          },
        };
      },
    }, { prompt: "Create a 90 second safety training arcade game." });
    expect(result.isError).not.toBe(true);
    expect(calls).toEqual(["Create a 90 second safety training arcade game."]);
    expect(readJsonResult(result)).toMatchObject({ model: "qwen3.6-flash", spec: { genre: "arcade" } });
  });

  it("executes one injected sound search without accepting credentials", async () => {
    const provider: SoundSearchProvider<FreesoundSearchRequest, FreesoundSearchResult> = {
      id: "freesound",
      capability: "sound-search",
      async execute(request) {
        return {
          total: 1,
          candidates: [{
            soundId: 42,
            name: request.query,
            username: "author",
            license: "Creative Commons 0",
            sourceUrl: "https://freesound.org/people/author/sounds/42/",
            previewUrl: "https://cdn.freesound.org/42.mp3",
            attribution: "Impact — author — Creative Commons 0",
            description: "Impact",
            tags: ["impact"],
            durationSeconds: 0.5,
            fileType: "wav",
          }],
        };
      },
    };

    const result = await searchSoundAssetTool(provider, { query: "impact" });

    expect(result.isError).not.toBe(true);
    expect(readJsonResult(result)).toMatchObject({
      total: 1,
      candidates: [{ soundId: 42, license: "Creative Commons 0" }],
    });
  });

  it("returns a deterministic project plan from an injected generator", async () => {
    const generated: ProjectGenerationResult = {
      mode: "dry-run",
      operation: "create",
      plan: {
        generatorVersion: "0.1.0",
        projectId: "safety-sprint",
        target: "web",
        specSha256: "a".repeat(64),
        planSha256: "b".repeat(64),
        files: [{ path: "src/main.ts", bytes: 100, sha256: "c".repeat(64) }],
      },
    };
    const result = await generateGameProjectTool(
      { execute: async () => generated },
      {
        projectId: "safety-sprint",
        spec: {
          title: "Safety Sprint",
          genre: "arcade",
          objective: "Collect all safety equipment before time expires.",
          controls: ["Arrow keys"],
          winCondition: "Collect every item.",
          loseCondition: "The timer reaches zero.",
          targetDurationSeconds: 90,
        },
      },
    );

    expect(result.isError).not.toBe(true);
    expect(readJsonResult(result)).toMatchObject({
      mode: "dry-run",
      plan: { projectId: "safety-sprint", files: [{ path: "src/main.ts" }] },
    });
  });

  it("recovers one managed project update without invoking a model or provider", async () => {
    const calls: string[] = [];
    const result = await recoverGameProjectUpdateTool({
      async recover(projectId) {
        calls.push(projectId);
        return { projectId, status: "rolled-back", planSha256: "a".repeat(64) };
      },
    }, "safety-sprint");
    expect(result.isError).not.toBe(true);
    expect(calls).toEqual(["safety-sprint"]);
    expect(readJsonResult(result)).toMatchObject({ status: "rolled-back" });
  });

  it("performs exactly one task creation operation", async () => {
    const calls: string[] = [];
    const result = await createGameTaskTool({
      async createTask(input) {
        calls.push(`create:${input.runId}`);
        return {
          task: {
            taskId: "task-00000000-0000-0000-0000-000000000000",
            runId: input.runId,
            prompt: input.prompt,
            language: input.language ?? "zh-CN",
            status: "queued",
            createdAt: "2026-07-18T12:00:00Z",
          },
          event: {
            type: "run.started",
            runId: input.runId,
            sequence: 1,
            emittedAt: "2026-07-18T12:00:00Z",
            language: input.language ?? "zh-CN",
          },
        };
      },
      async listTasks() { throw new Error("Unexpected list."); },
      async getTask() { throw new Error("Unexpected get."); },
      async claimTask() { throw new Error("Unexpected claim."); },
    }, {
      runId: "run-task-create",
      prompt: "Create one deterministic mini game task.",
      language: "en-US",
    });

    expect(result.isError).not.toBe(true);
    expect(calls).toEqual(["create:run-task-create"]);
    expect(readJsonResult(result)).toMatchObject({
      task: { runId: "run-task-create", status: "queued", language: "en-US" },
      event: { type: "run.started", runId: "run-task-create", sequence: 1 },
    });
  });

  it("performs exactly one relay operation per lifecycle tool call", async () => {
    const calls: string[] = [];
    const client = {
      async createRun(runId: string) {
        calls.push(`create:${runId}`);
        return { type: "run.started" as const, runId, sequence: 1, emittedAt: "2026-07-16T06:00:00+08:00" };
      },
      async replayEvents(input: { runId: string; after: number }) {
        calls.push(`replay:${input.runId}:${input.after}`);
        return { runId: input.runId, after: input.after, events: [] };
      },
      async publishEvents(batch: { events: unknown[] }) {
        calls.push("publish");
        return { accepted: batch.events.length, lastSequence: 2 };
      },
      async completeRun(runId: string) {
        calls.push(`complete:${runId}`);
        return { type: "run.completed" as const, runId, sequence: 3, emittedAt: "2026-07-16T06:00:02+08:00" };
      },
      async stopRun(runId: string) {
        calls.push(`stop:${runId}`);
        return { type: "run.stopped" as const, runId, sequence: 3, emittedAt: "2026-07-16T06:00:02+08:00" };
      },
    };
    const event = {
      type: "phase.started" as const,
      runId: "run-1",
      sequence: 2,
      emittedAt: "2026-07-16T06:00:01+08:00",
      phase: "spec" as const,
      detail: "Validating",
    };

    await createGameRunTool(client, "run-1");
    await replayGameRunTool(client, { runId: "run-1", after: 1 });
    await publishRunEventsTool(client, { runId: "run-1", after: 1, events: [event] });
    await completeGameRunTool(client, "run-1");
    await stopGameRunTool(client, "run-2");

    expect(calls).toEqual([
      "create:run-1",
      "replay:run-1:1",
      "publish",
      "complete:run-1",
      "stop:run-2",
    ]);
  });

  it("performs one image request and stores the verified result once", async () => {
    const calls: string[] = [];
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
    const result = await requestImageAssetTool(
      {
        id: "volcengine-ark",
        capability: "image",
        async execute(request) {
          calls.push(`generate:${request.assetId}`);
          return {
            bytes,
            mimeType: "image/jpeg",
            provenance: {
              assetId: request.assetId,
              kind: "image",
              origin: "generated",
              provider: "volcengine-ark",
              model: "seedream-test",
              prompt: request.prompt,
              license: "contract-defined",
              sha256: "a".repeat(64),
            },
          };
        },
      },
      {
        async store(request) {
          calls.push(`store:${request.projectId}:${request.role}`);
          expect(request.bytes).toEqual(bytes);
          return {
            entry: {
              assetId: request.provenance.assetId,
              kind: "image",
              role: "player",
              path: "assets/player.jpg",
              mimeType: "image/jpeg",
              bytes: bytes.length,
              sha256: "a".repeat(64),
              provenance: request.provenance,
            },
            manifestRevision: 1,
          };
        },
      },
      {
        projectId: "safety-sprint",
        assetId: "player",
        prompt: "A player sprite",
        role: "player",
      },
    );

    expect(result.isError).not.toBe(true);
    expect(calls).toEqual(["generate:player", "store:safety-sprint:player"]);
  });

  it("rejects a stale image replacement before calling the billable provider", async () => {
    const calls: string[] = [];
    const result = await requestImageAssetTool(
      {
        id: "volcengine-ark",
        capability: "image",
        async execute() {
          calls.push("provider");
          throw new Error("must not run");
        },
      },
      {
        async read(projectId) {
          calls.push(`read:${projectId}`);
          return { schemaVersion: "1.0", projectId, revision: 2, assets: [] };
        },
        async store() {
          calls.push("store");
          throw new Error("must not run");
        },
      },
      {
        projectId: "safety-sprint",
        assetId: "images/player",
        prompt: "A revised player sprite",
        role: "player",
        mode: "replace",
        expectedRevision: 1,
      },
    );
    expect(result.isError).toBe(true);
    expect(calls).toEqual(["read:safety-sprint"]);
    expect(JSON.stringify(readJsonResult(result))).toContain("revision conflict");
  });

  it("reads the authoritative asset manifest exactly once", async () => {
    const calls: string[] = [];
    const result = await getProjectAssetsTool({
      async read(projectId) {
        calls.push(projectId);
        return {
          schemaVersion: "1.0",
          projectId,
          revision: 1,
          assets: [],
        };
      },
    }, "safety-sprint");

    expect(result.isError).not.toBe(true);
    expect(calls).toEqual(["safety-sprint"]);
    expect(readJsonResult(result)).toEqual({
      schemaVersion: "1.0",
      projectId: "safety-sprint",
      revision: 1,
      assets: [],
    });
  });

  it("returns a stable error when the asset manifest cannot be read", async () => {
    const result = await getProjectAssetsTool({
      async read() {
        throw new Error("Runtime asset manifest is invalid.");
      },
    }, "safety-sprint");

    expect(result.isError).toBe(true);
    expect(readJsonResult(result)).toEqual({
      error: "project_assets_read_failed",
      message: "Runtime asset manifest is invalid.",
    });
  });

  it("recovers one interrupted asset transaction without invoking a provider", async () => {
    const calls: string[] = [];
    const result = await recoverProjectAssetsTool({
      async recover(projectId) {
        calls.push(projectId);
        return { schemaVersion: "1.0", projectId, revision: 2, assets: [] };
      },
    }, "safety-sprint");
    expect(result.isError).not.toBe(true);
    expect(calls).toEqual(["safety-sprint"]);
    expect(readJsonResult(result)).toMatchObject({ revision: 2 });
  });

  it("imports one selected sound preview and stores it once", async () => {
    const calls: string[] = [];
    const bytes = new Uint8Array([0x49, 0x44, 0x33, 0x04]);
    const result = await importSoundAssetTool(
      {
        async execute(request, classification) {
          calls.push(`preview:${request.soundId}:${classification}`);
          return {
            bytes,
            mimeType: "audio/mpeg",
            provenance: {
              assetId: request.assetId,
              kind: "sound",
              origin: "retrieved",
              provider: "freesound",
              sourceUrl: request.sourceUrl,
              license: `Freesound ${request.license}`,
              attribution: `by ${request.username}`,
              sha256: "b".repeat(64),
            },
          };
        },
      },
      {
        async store(request) {
          calls.push(`store:${request.projectId}:${request.role}`);
          return {
            entry: {
              assetId: request.provenance.assetId,
              kind: "sound",
              role: "hit-sound",
              path: "assets/impact.mp3",
              mimeType: "audio/mpeg",
              bytes: request.bytes.length,
              sha256: request.provenance.sha256,
              provenance: request.provenance,
            },
            manifestRevision: 1,
          };
        },
      },
      {
        projectId: "safety-sprint",
        assetId: "sounds/impact",
        soundId: 42,
        name: "Impact",
        username: "author",
        license: "Creative Commons 0",
        sourceUrl: "https://freesound.org/people/author/sounds/42/",
        previewUrl: "https://cdn.freesound.org/previews/0/42_1-hq.mp3",
        role: "hit-sound",
      },
    );
    expect(result.isError).not.toBe(true);
    expect(calls).toEqual(["preview:42:sound", "store:safety-sprint:hit-sound"]);
  });

  it("classifies a selected Freesound preview as music for the BGM role", async () => {
    const classifications: Array<string | undefined> = [];
    const result = await importSoundAssetTool(
      {
        async execute(request, classification) {
          classifications.push(classification);
          return {
            bytes: new Uint8Array([0x49, 0x44, 0x33, 0x04]),
            mimeType: "audio/mpeg",
            provenance: {
              assetId: request.assetId,
              kind: classification === "music" ? "music" : "sound",
              origin: "retrieved",
              provider: "freesound",
              sourceUrl: request.sourceUrl,
              license: `Freesound ${request.license}`,
              attribution: `by ${request.username}`,
              sha256: "d".repeat(64),
            },
          };
        },
      },
      {
        async store(request) {
          expect(request.provenance.kind).toBe("music");
          expect(request.role).toBe("bgm");
          return {
            entry: {
              assetId: request.provenance.assetId,
              kind: "music",
              role: "bgm",
              path: "assets/music/theme.mp3",
              mimeType: "audio/mpeg",
              bytes: request.bytes.length,
              sha256: request.provenance.sha256,
              provenance: request.provenance,
            },
            manifestRevision: 1,
          };
        },
      },
      {
        projectId: "safety-sprint",
        assetId: "music/theme",
        soundId: 84,
        name: "Looping theme",
        username: "composer",
        license: "Creative Commons 0",
        sourceUrl: "https://freesound.org/people/composer/sounds/84/",
        previewUrl: "https://cdn.freesound.org/previews/0/84_1-hq.mp3",
        role: "bgm",
      },
    );

    expect(result.isError).not.toBe(true);
    expect(classifications).toEqual(["music"]);
  });

  it("performs one instrumental music request and stores it as BGM", async () => {
    const calls: string[] = [];
    const bytes = new Uint8Array([0x49, 0x44, 0x33, 0x04]);
    const result = await generateMusicAssetTool(
      {
        id: "minimax",
        capability: "audio-generation",
        async execute(request) {
          calls.push(`generate:${request.assetId}`);
          return {
            bytes,
            mimeType: "audio/mpeg",
            provenance: {
              assetId: request.assetId,
              kind: "music",
              origin: "generated",
              provider: "minimax",
              model: "music-2.6",
              prompt: request.prompt,
              license: "account-confirmed-output-terms",
              sha256: "e".repeat(64),
            },
          };
        },
      },
      {
        async store(request) {
          calls.push(`store:${request.projectId}:${request.role}`);
          expect(request.provenance.kind).toBe("music");
          return {
            entry: {
              assetId: request.provenance.assetId,
              kind: "music",
              role: "bgm",
              path: "assets/music/theme.mp3",
              mimeType: "audio/mpeg",
              bytes: request.bytes.length,
              sha256: request.provenance.sha256,
              provenance: request.provenance,
            },
            manifestRevision: 1,
          };
        },
      },
      { projectId: "safety-sprint", assetId: "music/theme", prompt: "An instrumental puzzle loop" },
    );
    expect(result.isError).not.toBe(true);
    expect(calls).toEqual(["generate:music/theme", "store:safety-sprint:bgm"]);
  });

  it("keeps asynchronous TTS submit, query, and materialization deterministic", async () => {
    const calls: string[] = [];
    const jobHandle = `${"a".repeat(80)}.${"b".repeat(43)}`;
    const provider = {
      async submit(request: { projectId: string; assetId: string }) {
        calls.push(`submit:${request.projectId}:${request.assetId}`);
        return { jobHandle, taskId: "task-42", status: "processing" as const };
      },
      async query(request: { projectId: string; jobHandle: string }) {
        calls.push(`query:${request.projectId}`);
        return { jobHandle: request.jobHandle, taskId: "task-42", status: "succeeded" as const };
      },
      async materialize(request: { projectId: string }) {
        calls.push(`materialize:${request.projectId}`);
        return {
          bytes: new Uint8Array([0x49, 0x44, 0x33, 0x04]),
          mimeType: "audio/mpeg" as const,
          provenance: {
            assetId: "voices/guide",
            kind: "voice" as const,
            origin: "generated" as const,
            provider: "volcengine-speech",
            model: "voice-test",
            prompt: "Guide line",
            license: "account-terms",
            sha256: "c".repeat(64),
          },
        };
      },
    };
    const store = {
      async store(request: { projectId: string; role?: string; provenance: { assetId: string } }) {
        calls.push(`store:${request.projectId}:${request.role}`);
        return {
          entry: {
            assetId: request.provenance.assetId,
            kind: "voice" as const,
            role: "voice" as const,
            path: "assets/voices/guide.mp3",
            mimeType: "audio/mpeg" as const,
            bytes: 4,
            sha256: "c".repeat(64),
            provenance: {
              assetId: request.provenance.assetId,
              kind: "voice" as const,
              origin: "generated" as const,
              provider: "volcengine-speech",
              model: "voice-test",
              prompt: "Guide line",
              license: "account-terms",
              sha256: "c".repeat(64),
            },
          },
          manifestRevision: 1,
        };
      },
    };
    const submitRequest = {
      projectId: "safety-sprint",
      assetId: "voices/guide",
      text: "Guide line",
      voiceType: "voice-test",
    };
    const jobRequest = { projectId: "safety-sprint", jobHandle };

    expect((await submitVoiceJobTool(provider, submitRequest)).isError).not.toBe(true);
    expect((await queryVoiceJobTool(provider, jobRequest)).isError).not.toBe(true);
    expect((await materializeVoiceJobTool(provider, store, jobRequest)).isError).not.toBe(true);
    expect(calls).toEqual([
      "submit:safety-sprint:voices/guide",
      "query:safety-sprint",
      "materialize:safety-sprint",
      "store:safety-sprint:voice",
    ]);
  });

  it("checks a signed voice replacement before downloading audio", async () => {
    const calls: string[] = [];
    const provider = {
      async submit() { throw new Error("unused"); },
      async query() { throw new Error("unused"); },
      async inspect() {
        calls.push("inspect");
        return { assetId: "voices/guide", taskId: "task-42" };
      },
      async materialize() {
        calls.push("materialize");
        throw new Error("must not download");
      },
    };
    const result = await materializeVoiceJobTool(provider, {
      async read(projectId) {
        calls.push("read");
        return { schemaVersion: "1.0", projectId, revision: 2, assets: [] };
      },
      async store() {
        calls.push("store");
        throw new Error("must not store");
      },
    }, {
      projectId: "safety-sprint",
      jobHandle: `${"a".repeat(80)}.${"b".repeat(43)}`,
      mode: "replace",
      expectedRevision: 1,
    });
    expect(result.isError).toBe(true);
    expect(calls).toEqual(["inspect", "read"]);
  });

  it("executes one bounded browser verification and preserves failed reports", async () => {
    const calls: string[] = [];
    const verifier = {
      async verify(request: VerifyGameRequest) {
        calls.push(request.projectId);
        return {
          projectId: request.projectId,
          passed: false,
          state: { status: "running" as const, score: 0, lives: 3, remainingSeconds: 89 },
          screenshotPath: "D:\\projects\\safety-sprint\\.gameforge\\verification\\proof.png",
          evidencePath: ".gameforge/verification/proof.png",
          canvas: { width: 960, height: 540 },
          consoleErrors: ["runtime error"],
          pageErrors: [],
          failedRequests: [],
          actionsExecuted: request.actions?.length ?? 0,
          durationMs: 250,
        };
      },
    };
    const result = await verifyGameProjectTool(verifier, {
      projectId: "safety-sprint",
      actions: [{ type: "press", key: "ArrowRight" }],
      expectedOutcome: "won",
    });
    expect(result.isError).toBe(true);
    expect(calls).toEqual(["safety-sprint"]);
    expect(readJsonResult(result)).toMatchObject({ passed: false, consoleErrors: ["runtime error"] });
  });
});
