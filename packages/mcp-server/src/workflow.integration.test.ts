import {
  createGameTaskResponseSchema,
  runEventBatchSchema,
  runtimeAssetManifestSchema,
} from "@gameforge/contracts";
import { ProjectAssetStore } from "@gameforge/asset-store";
import { GamePreviewManager } from "@gameforge/game-verifier";
import { GameProjectGenerator } from "@gameforge/generator";
import { createRunRelayServer } from "@gameforge/run-relay";
import { RunRelayClient } from "@gameforge/run-relay/client";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { createServer } from "./server.js";

const servers: Server[] = [];
const temporaryRoots: string[] = [];
const recoveryJobHandle = `${"r".repeat(80)}.${"s".repeat(43)}`;
const recoveryTtsOptions = {
  asyncTtsProvider: {
    async submit() {
      return { jobHandle: recoveryJobHandle, taskId: "tts-recovery", status: "processing" as const };
    },
    async query() {
      return { jobHandle: recoveryJobHandle, taskId: "tts-recovery", status: "succeeded" as const };
    },
    async materialize(): Promise<never> {
      throw new Error("Materialization is outside this recovery test.");
    },
  },
  assetStore: {
    async store(): Promise<never> {
      throw new Error("Asset storage is outside this recovery test.");
    },
  },
};

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => {
    server.closeAllConnections();
    server.close(() => resolve());
  })));
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("local CodeArts workflow boundary", () => {
  it("creates one idempotent Task and Run through MCP without a GUI", async () => {
    const relayBaseUrl = await startRelay();
    const relayClient = new RunRelayClient({ baseUrl: relayBaseUrl });
    const pair = InMemoryTransport.createLinkedPair();
    const server = createServer({ runRelayClient: relayClient, taskRelayClient: relayClient });
    const client = new Client({ name: "codearts-headless-create", version: "1.0.0" });
    await server.connect(pair[1]);
    await client.connect(pair[0]);
    try {
      const request = {
        runId: "run-codearts-headless-create",
        prompt: "制作一个可由 CodeArts CLI 无界面启动的抖音小游戏。",
        language: "zh-CN" as const,
        projectId: "headless-douyin-game",
      };
      const created = createGameTaskResponseSchema.parse(await callJson(client, "create_game_task", request));
      const retried = createGameTaskResponseSchema.parse(await callJson(client, "create_game_task", request));

      expect(retried).toEqual(created);
      expect(created).toMatchObject({
        task: {
          runId: request.runId,
          prompt: request.prompt,
          language: request.language,
          projectId: request.projectId,
          status: "queued",
        },
        event: {
          type: "run.started",
          runId: request.runId,
          sequence: 1,
          language: request.language,
        },
      });

      const snapshot = await callJson(client, "list_game_tasks", { limit: 20 }) as {
        tasks: Array<{ taskId: string; runId: string }>;
      };
      expect(snapshot.tasks).toEqual([{ ...created.task }]);
      const replay = runEventBatchSchema.parse(await callJson(client, "replay_game_run", {
        runId: request.runId,
        after: 0,
      }));
      expect(replay.events).toEqual([created.event]);

      const conflict = await client.callTool({
        name: "create_game_task",
        arguments: { ...request, prompt: "制作一个内容不同、不得复用同一 Run ID 的小游戏。" },
      });
      expect(conflict.isError).toBe(true);
      if (!Array.isArray(conflict.content) || conflict.content[0]?.type !== "text") {
        throw new Error("Expected a structured Relay conflict.");
      }
      expect(JSON.parse(conflict.content[0].text)).toEqual({
        error: "run_relay_failed",
        relayCode: "task_run_conflict",
        message: "Run relay operation failed.",
      });
      await expect(relayClient.listTasks({ limit: 20 })).resolves.toHaveLength(1);
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("resumes an already claimed task after the CodeArts MCP client restarts", async () => {
    const relayBaseUrl = await startRelay();
    const relayClient = new RunRelayClient({ baseUrl: relayBaseUrl });
    const createdResponse = await fetch(`${relayBaseUrl}/tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "http://localhost:4173" },
      body: JSON.stringify({
        runId: "run-codearts-resume",
        prompt: "制作一个可在 CodeArts 中断后继续完成的浏览器小游戏。",
        language: "zh-CN",
      }),
    });
    const created = createGameTaskResponseSchema.parse(await createdResponse.json());

    const firstPair = InMemoryTransport.createLinkedPair();
    const firstServer = createServer({
      runRelayClient: relayClient,
      taskRelayClient: relayClient,
      ...recoveryTtsOptions,
    });
    const firstClient = new Client({ name: "codearts-before-restart", version: "1.0.0" });
    await firstServer.connect(firstPair[1]);
    await firstClient.connect(firstPair[0]);
    try {
      await callJson(firstClient, "claim_game_task", { taskId: created.task.taskId, agentId: "codearts" });
      const submitted = await callJson(firstClient, "submit_voice_job", {
        projectId: "resume-game",
        assetId: "voices/guide",
        text: "这条配音任务需要在 CodeArts 重启后恢复。",
        voiceType: "zh_female_test",
        format: "wav",
      });
      expect(submitted).toMatchObject({ jobHandle: recoveryJobHandle, status: "processing" });
      await callJson(firstClient, "publish_run_events", {
        runId: created.task.runId,
        after: 1,
        events: [
          {
            type: "phase.completed",
            runId: created.task.runId,
            sequence: 2,
            emittedAt: new Date().toISOString(),
            phase: "spec",
            detail: "Specification already completed before restart",
          },
          {
            type: "voice.job.updated",
            runId: created.task.runId,
            sequence: 3,
            emittedAt: new Date().toISOString(),
            projectId: "resume-game",
            assetId: "voices/guide",
            jobHandle: recoveryJobHandle,
            status: "processing",
          },
        ],
      });
    } finally {
      await firstClient.close();
      await firstServer.close();
    }

    const secondPair = InMemoryTransport.createLinkedPair();
    const secondServer = createServer({
      runRelayClient: relayClient,
      taskRelayClient: relayClient,
      ...recoveryTtsOptions,
    });
    const secondClient = new Client({ name: "codearts-after-restart", version: "1.0.0" });
    await secondServer.connect(secondPair[1]);
    await secondClient.connect(secondPair[0]);
    try {
      const snapshot = await callJson(secondClient, "list_game_tasks", { limit: 20 }) as {
        tasks: Array<{ taskId: string; status: string; claimedBy?: string }>;
      };
      expect(snapshot.tasks).toEqual([
        expect.objectContaining({ taskId: created.task.taskId, status: "claimed", claimedBy: "codearts" }),
      ]);
      await expect(callJson(secondClient, "claim_game_task", {
        taskId: created.task.taskId,
        agentId: "codearts",
      })).resolves.toMatchObject({ task: { status: "claimed", claimedBy: "codearts" } });
      const replay = runEventBatchSchema.parse(await callJson(secondClient, "replay_game_run", {
        runId: created.task.runId,
        after: 0,
      }));
      expect(replay.events.map((event) => event.type)).toEqual([
        "run.started",
        "phase.completed",
        "voice.job.updated",
      ]);
      const recoveredJob = replay.events.find((event) => event.type === "voice.job.updated");
      expect(recoveredJob).toMatchObject({
        projectId: "resume-game",
        assetId: "voices/guide",
        jobHandle: recoveryJobHandle,
        status: "processing",
      });
      await expect(callJson(secondClient, "query_voice_job", {
        projectId: "resume-game",
        jobHandle: recoveredJob?.type === "voice.job.updated" ? recoveredJob.jobHandle : "missing",
      })).resolves.toMatchObject({ jobHandle: recoveryJobHandle, status: "succeeded" });
      await callJson(secondClient, "complete_game_run", { runId: created.task.runId });
      await expect(relayClient.getTask(created.task.taskId)).resolves.toMatchObject({ status: "completed" });
    } finally {
      await secondClient.close();
      await secondServer.close();
    }
  });

  it("carries one GameForge task through claim, replay, generation, preview, and completion", async () => {
    const relayBaseUrl = await startRelay();
    const projectsRoot = await mkdtemp(path.join(tmpdir(), "gameforge-workflow-"));
    temporaryRoots.push(projectsRoot);
    const relayClient = new RunRelayClient({ baseUrl: relayBaseUrl });
    const previewManager = new GamePreviewManager({ projectsRoot });
    const assetStore = new ProjectAssetStore({ projectsRoot });
    const imageBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
    const imageSha256 = createHash("sha256").update(imageBytes).digest("hex");
    const soundBytes = new Uint8Array([0x49, 0x44, 0x33, 0x04]);
    const soundSha256 = createHash("sha256").update(soundBytes).digest("hex");
    const voiceBytes = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45]);
    const voiceSha256 = createHash("sha256").update(voiceBytes).digest("hex");
    const jobHandle = `${"a".repeat(80)}.${"b".repeat(43)}`;
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const mcpServer = createServer({
      projectGenerator: new GameProjectGenerator({ outputRoot: projectsRoot }),
      projectPreviewManager: previewManager,
      assetStore,
      imageProvider: {
        id: "volcengine-ark",
        capability: "image",
        async execute(request) {
          return {
            bytes: imageBytes,
            mimeType: "image/jpeg" as const,
            provenance: {
              assetId: request.assetId,
              kind: "image" as const,
              origin: "generated" as const,
              provider: "volcengine-ark",
              model: "seedream-test-double",
              prompt: request.prompt,
              license: "test-only",
              sha256: imageSha256,
            },
          };
        },
      },
      soundPreviewProvider: {
        async execute(request) {
          return {
            bytes: soundBytes,
            mimeType: "audio/mpeg" as const,
            provenance: {
              assetId: request.assetId,
              kind: "sound" as const,
              origin: "retrieved" as const,
              provider: "freesound",
              sourceUrl: request.sourceUrl,
              license: `Freesound ${request.license}`,
              attribution: `“${request.name}” by ${request.username}`,
              sha256: soundSha256,
            },
          };
        },
      },
      asyncTtsProvider: {
        async submit() {
          return { jobHandle, taskId: "tts-local-e2e", status: "processing" as const };
        },
        async query() {
          return { jobHandle, taskId: "tts-local-e2e", status: "succeeded" as const };
        },
        async materialize() {
          return {
            bytes: voiceBytes,
            mimeType: "audio/wav" as const,
            provenance: {
              assetId: "voices/guide",
              kind: "voice" as const,
              origin: "generated" as const,
              provider: "volcengine-speech",
              model: "zh_female_test",
              prompt: "收集全部能量核心，注意避开障碍。",
              license: "test-only",
              sha256: voiceSha256,
            },
          };
        },
      },
      projectVerifier: {
        async verify(request) {
          return {
            projectId: request.projectId,
            passed: true,
            state: { status: "won", score: 5, lives: 2, remainingSeconds: 21 },
            screenshotPath: path.join(projectsRoot, request.projectId, ".gameforge", "verification", "proof.png"),
            evidencePath: ".gameforge/verification/proof.png",
            canvas: { width: 960, height: 540 },
            consoleErrors: [],
            pageErrors: [],
            failedRequests: [],
            actionsExecuted: request.actions?.length ?? 0,
            durationMs: 900,
          };
        },
      },
      runRelayClient: relayClient,
      taskRelayClient: relayClient,
    });
    const mcpClient = new Client({ name: "codearts-workflow-test", version: "1.0.0" });
    await mcpServer.connect(serverTransport);
    await mcpClient.connect(clientTransport);

    try {
      const createdResponse = await fetch(`${relayBaseUrl}/tasks`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: "http://localhost:4173" },
        body: JSON.stringify({
          runId: "run-local-e2e",
          prompt: "制作一个收集五个能量核心并避开障碍的浏览器小游戏。",
          language: "zh-CN",
        }),
      });
      const created = createGameTaskResponseSchema.parse(await createdResponse.json());

      const claimed = await callJson(mcpClient, "claim_game_task", {
        taskId: created.task.taskId,
        agentId: "codearts",
      });
      expect(claimed).toMatchObject({ task: { status: "claimed", runId: "run-local-e2e" } });

      const initialReplay = runEventBatchSchema.parse(await callJson(mcpClient, "replay_game_run", {
        runId: "run-local-e2e",
        after: 0,
      }));
      expect(initialReplay.events).toEqual([expect.objectContaining({ type: "run.started", sequence: 1 })]);

      const capabilities = await callJson(mcpClient, "get_gameforge_capabilities", {}) as Record<string, unknown>;
      expect(capabilities).toMatchObject({
        providers: {
          spec: { ready: false },
          image: { provider: "volcengine-ark", ready: true },
          tts: { provider: "volcengine-speech", ready: true },
          sound: { provider: "freesound", ready: false },
        },
        engineering: { assetStore: true, generator: true, verifier: true, preview: true, runRelay: true, taskInbox: true },
      });

      const spec = {
        title: "能量核心冲刺",
        genre: "arcade",
        objective: "收集五个能量核心并避开障碍。",
        controls: ["方向键移动"],
        winCondition: "收集全部五个能量核心。",
        loseCondition: "时间耗尽或生命值归零。",
        targetDurationSeconds: 90,
        gameplay: { collectibleCount: 5, hazardCount: 3, startingLives: 3, movementSpeed: 220 },
      };
      const validated = await callJson(mcpClient, "validate_game_spec", { spec });
      expect(validated).toMatchObject({ valid: true, spec });
      const emittedAt = new Date().toISOString();
      await callJson(mcpClient, "publish_run_events", {
        runId: "run-local-e2e",
        after: 1,
        events: [
          { type: "capabilities.ready", runId: "run-local-e2e", sequence: 2, emittedAt, snapshot: capabilities },
          { type: "spec.ready", runId: "run-local-e2e", sequence: 3, emittedAt, spec },
        ],
      });

      const generationInput = { projectId: "local-e2e", spec };
      const dryRun = await callJson(mcpClient, "generate_game_project", generationInput);
      expect(dryRun).toMatchObject({ mode: "dry-run", plan: { projectId: "local-e2e" } });
      const applied = await callJson(mcpClient, "generate_game_project", {
        ...generationInput,
        mode: "apply",
      });
      expect(applied).toMatchObject({ mode: "apply", plan: { projectId: "local-e2e" } });

      const storedAsset = await callJson(mcpClient, "request_image_asset", {
        projectId: "local-e2e",
        assetId: "player",
        prompt: "国风科幻能量收集者角色，透明背景，游戏精灵图。",
        size: "1K",
        watermark: false,
        role: "player",
      }) as { entry: Record<string, unknown>; manifestRevision: number };
      expect(storedAsset).toMatchObject({
        manifestRevision: 1,
        entry: {
          assetId: "player",
          role: "player",
          path: "assets/player.jpg",
          sha256: imageSha256,
          provenance: { provider: "volcengine-ark", model: "seedream-test-double" },
        },
      });
      const manifest = runtimeAssetManifestSchema.parse(JSON.parse(await readFile(
        path.join(projectsRoot, "local-e2e", "public", "assets", "manifest.json"),
        "utf8",
      )) as unknown);
      expect(manifest).toMatchObject({ revision: 1, assets: [{ assetId: "player", role: "player" }] });
      const recoveredAssets = await callJson(mcpClient, "get_project_assets", {
        projectId: "local-e2e",
      });
      expect(recoveredAssets).toMatchObject({
        projectId: "local-e2e",
        revision: 1,
        assets: [{ assetId: "player", role: "player" }],
      });
      await expect(callJson(mcpClient, "recover_project_assets", {
        projectId: "local-e2e",
      })).resolves.toMatchObject({ revision: 1, assets: [{ assetId: "player" }] });
      await callJson(mcpClient, "publish_run_events", {
        runId: "run-local-e2e",
        after: 3,
        events: [{
          type: "asset.ready",
          runId: "run-local-e2e",
          sequence: 4,
          emittedAt: new Date().toISOString(),
          projectId: "local-e2e",
          manifestRevision: storedAsset.manifestRevision,
          entry: storedAsset.entry,
        }],
      });

      const storedSound = await callJson(mcpClient, "import_sound_asset", {
        projectId: "local-e2e",
        assetId: "sounds/collect",
        soundId: 42,
        name: "Energy collect",
        username: "test-author",
        license: "Creative Commons 0",
        sourceUrl: "https://freesound.org/s/42/",
        previewUrl: "https://cdn.freesound.org/previews/0/42.mp3",
        role: "collect-sound",
      }) as { entry: Record<string, unknown>; manifestRevision: number };
      expect(storedSound).toMatchObject({
        manifestRevision: 2,
        entry: {
          assetId: "sounds/collect",
          role: "collect-sound",
          sha256: soundSha256,
          provenance: { provider: "freesound", license: "Freesound Creative Commons 0" },
        },
      });
      await callJson(mcpClient, "publish_run_events", {
        runId: "run-local-e2e",
        after: 4,
        events: [{
          type: "asset.ready",
          runId: "run-local-e2e",
          sequence: 5,
          emittedAt: new Date().toISOString(),
          projectId: "local-e2e",
          manifestRevision: storedSound.manifestRevision,
          entry: storedSound.entry,
        }],
      });

      const submittedVoice = await callJson(mcpClient, "submit_voice_job", {
        projectId: "local-e2e",
        assetId: "voices/guide",
        text: "收集全部能量核心，注意避开障碍。",
        voiceType: "zh_female_test",
        format: "wav",
      });
      expect(submittedVoice).toMatchObject({ jobHandle, status: "processing" });
      await callJson(mcpClient, "publish_run_events", {
        runId: "run-local-e2e",
        after: 5,
        events: [{
          type: "voice.job.updated",
          runId: "run-local-e2e",
          sequence: 6,
          emittedAt: new Date().toISOString(),
          projectId: "local-e2e",
          assetId: "voices/guide",
          jobHandle,
          status: "processing",
        }],
      });
      const queriedVoice = await callJson(mcpClient, "query_voice_job", {
        projectId: "local-e2e",
        jobHandle,
      });
      expect(queriedVoice).toMatchObject({ jobHandle, status: "succeeded" });
      await callJson(mcpClient, "publish_run_events", {
        runId: "run-local-e2e",
        after: 6,
        events: [{
          type: "voice.job.updated",
          runId: "run-local-e2e",
          sequence: 7,
          emittedAt: new Date().toISOString(),
          projectId: "local-e2e",
          assetId: "voices/guide",
          jobHandle,
          status: "succeeded",
        }],
      });
      const storedVoice = await callJson(mcpClient, "materialize_voice_job", {
        projectId: "local-e2e",
        jobHandle,
      }) as { entry: Record<string, unknown>; manifestRevision: number };
      expect(storedVoice).toMatchObject({
        manifestRevision: 3,
        entry: {
          assetId: "voices/guide",
          role: "voice",
          sha256: voiceSha256,
          provenance: { provider: "volcengine-speech", model: "zh_female_test" },
        },
      });
      const audioManifest = runtimeAssetManifestSchema.parse(JSON.parse(await readFile(
        path.join(projectsRoot, "local-e2e", "public", "assets", "manifest.json"),
        "utf8",
      )) as unknown);
      expect(audioManifest).toMatchObject({
        revision: 3,
        assets: [
          { assetId: "player", role: "player" },
          { assetId: "sounds/collect", role: "collect-sound" },
          { assetId: "voices/guide", role: "voice" },
        ],
      });
      await callJson(mcpClient, "publish_run_events", {
        runId: "run-local-e2e",
        after: 7,
        events: [{
          type: "asset.ready",
          runId: "run-local-e2e",
          sequence: 8,
          emittedAt: new Date().toISOString(),
          projectId: "local-e2e",
          manifestRevision: storedVoice.manifestRevision,
          entry: storedVoice.entry,
        }],
      });

      const preview = await callJson(mcpClient, "start_game_preview", { projectId: "local-e2e" }) as {
        projectId: string;
        url: string;
      };
      expect(preview).toMatchObject({ projectId: "local-e2e" });
      const previewResponse = await fetch(preview.url);
      expect(previewResponse.status).toBe(200);
      const previewHtml = await previewResponse.text();
      expect(previewHtml).toContain('id="game"');
      expect(previewHtml).toContain('src="/src/main.ts"');

      await callJson(mcpClient, "publish_run_events", {
        runId: "run-local-e2e",
        after: 8,
        events: [{
          type: "preview.ready",
          runId: "run-local-e2e",
          sequence: 9,
          emittedAt: new Date().toISOString(),
          projectId: preview.projectId,
          url: preview.url,
        }],
      });
      const verification = await callJson(mcpClient, "verify_game_project", {
        projectId: "local-e2e",
        actions: [{ type: "press", key: "ArrowRight" }],
        expectedOutcome: "won",
      }) as {
        projectId: string;
        passed: boolean;
        state: { status: "running" | "won" | "lost"; score: number; lives: number; remainingSeconds: number };
        evidencePath: string;
        canvas: { width: number; height: number };
        consoleErrors: string[];
        pageErrors: string[];
        failedRequests: string[];
        actionsExecuted: number;
        durationMs: number;
      };
      await callJson(mcpClient, "publish_run_events", {
        runId: "run-local-e2e",
        after: 9,
        events: [{
          type: "verification.ready",
          runId: "run-local-e2e",
          sequence: 10,
          emittedAt: new Date().toISOString(),
          projectId: verification.projectId,
          passed: verification.passed,
          outcome: verification.state.status,
          score: verification.state.score,
          lives: verification.state.lives,
          remainingSeconds: verification.state.remainingSeconds,
          evidencePath: verification.evidencePath,
          canvas: verification.canvas,
          diagnostics: {
            consoleErrors: verification.consoleErrors.length,
            pageErrors: verification.pageErrors.length,
            failedRequests: verification.failedRequests.length,
          },
          actionsExecuted: verification.actionsExecuted,
          durationMs: verification.durationMs,
        }],
      });
      await callJson(mcpClient, "complete_game_run", { runId: "run-local-e2e" });

      const finalReplay = runEventBatchSchema.parse(await callJson(mcpClient, "replay_game_run", {
        runId: "run-local-e2e",
        after: 0,
      }));
      expect(finalReplay.events.map((event) => event.type)).toEqual([
        "run.started",
        "capabilities.ready",
        "spec.ready",
        "asset.ready",
        "asset.ready",
        "voice.job.updated",
        "voice.job.updated",
        "asset.ready",
        "preview.ready",
        "verification.ready",
        "run.completed",
      ]);
      await expect(relayClient.getTask(created.task.taskId)).resolves.toMatchObject({ status: "completed" });
    } finally {
      await previewManager.closeAll();
      await mcpClient.close();
      await mcpServer.close();
    }
  }, 30_000);
});

async function startRelay(): Promise<string> {
  const server = createRunRelayServer({ heartbeatMilliseconds: 1_000 });
  servers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}

async function callJson(client: Client, name: string, arguments_: Record<string, unknown>): Promise<unknown> {
  const result = await client.callTool({ name, arguments: arguments_ });
  expect(result.isError).not.toBe(true);
  if (!Array.isArray(result.content) || result.content[0]?.type !== "text") {
    throw new Error(`MCP tool ${name} did not return text content.`);
  }
  return JSON.parse(result.content[0].text) as unknown;
}
