import { defaultProviderConfig } from "@gameforge/contracts";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import type { SoundSearchProvider } from "@gameforge/contracts";
import type { FreesoundSearchRequest, FreesoundSearchResult } from "@gameforge/providers";
import { createServer } from "./server.js";
import type { ProjectGenerationResult } from "@gameforge/contracts";
import type { ToolAuditContextBinder, ToolAuditRecorder, ToolAuditToken } from "./tool-audit.js";

describe("GameForge MCP server", () => {
  it("audits executed tool callbacks without inspecting arguments or results", async () => {
    const completed: Array<{ token: ToolAuditToken; outcome: "success" | "error" }> = [];
    let sequence = 0;
    let auditContext: { taskId: string; runId: string; boundAt: string } | undefined;
    const toolAudit: ToolAuditRecorder & ToolAuditContextBinder = {
      begin(tool) {
        sequence += 1;
        return { sequence, tool, startedAt: new Date().toISOString(), monotonicStart: performance.now() };
      },
      async finish(token, outcome) { completed.push({ token, outcome }); },
      async bindContext(taskId, runId) {
        if (auditContext !== undefined && (auditContext.taskId !== taskId || auditContext.runId !== runId)) {
          throw new Error("conflict");
        }
        auditContext ??= { taskId, runId, boundAt: new Date().toISOString() };
        return auditContext;
      },
    };
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = createServer({ toolAudit });
    const client = new Client({ name: "gameforge-audit-test", version: "1.0.0" });
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    try {
      expect((await client.listTools()).tools.map((tool) => tool.name)).toContain("bind_mcp_audit_context");
      const bound = await client.callTool({
        name: "bind_mcp_audit_context",
        arguments: { taskId: "task-00000000-0000-0000-0000-000000000000", runId: "audit-run" },
      });
      expect(bound.isError).not.toBe(true);
      const conflict = await client.callTool({
        name: "bind_mcp_audit_context",
        arguments: { taskId: "task-00000000-0000-0000-0000-000000000000", runId: "other-run" },
      });
      expect(conflict.isError).toBe(true);
      await client.callTool({ name: "get_gameforge_capabilities", arguments: {} });
      expect(completed).toMatchObject([
        { token: { sequence: 1, tool: "bind_mcp_audit_context" }, outcome: "success" },
        { token: { sequence: 2, tool: "bind_mcp_audit_context" }, outcome: "error" },
        { token: { sequence: 3, tool: "get_gameforge_capabilities" }, outcome: "success" },
      ]);
      expect(completed[0]?.token).not.toHaveProperty("arguments");
      expect(completed[0]?.token).not.toHaveProperty("result");
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("registers the bounded Douyin build only when a builder is configured", async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = createServer({
      douyinProjectBuilder: {
        async build(projectId) {
          return {
            projectId,
            cliVersion: "3.4.0",
            outputPath: "D:/managed/safe-game/release/bytedancegame",
            validation: {
              platform: "douyin-mini-game",
              passed: true,
              fileCount: 12,
              totalBytes: 1_000_000,
              mainPackageBytes: 1_000_000,
              subpackages: [],
              deviceOrientation: "portrait",
              capabilities: { network: false, login: false, share: false, ads: false, payments: false },
              allowedNetworkHosts: [],
            },
            stdoutTruncated: false,
            stderrTruncated: false,
          };
        },
      },
    });
    const client = new Client({ name: "gameforge-douyin-builder-test", version: "1.0.0" });
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    try {
      expect((await client.listTools()).tools.map((tool) => tool.name)).toContain("build_douyin_mini_game");
      const result = await client.callTool({ name: "build_douyin_mini_game", arguments: { projectId: "safe-game" } });
      expect(result.isError).not.toBe(true);
      expect(result.content).toEqual(expect.arrayContaining([expect.objectContaining({ type: "text" })]));
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("registers and invokes all deterministic validation tools", async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = createServer();
    const client = new Client({ name: "gameforge-test", version: "1.0.0" });

    await server.connect(serverTransport);
    await client.connect(clientTransport);

    try {
      const tools = await client.listTools();
      expect(tools.tools.map((tool) => tool.name).sort()).toEqual([
        "get_gameforge_capabilities",
        "validate_asset_manifest",
        "validate_game_spec",
        "validate_provider_config",
      ]);

      const capabilities = await client.callTool({ name: "get_gameforge_capabilities", arguments: {} });
      expect(capabilities.isError).not.toBe(true);
      if (!Array.isArray(capabilities.content) || capabilities.content[0]?.type !== "text") {
        throw new Error("Expected capability snapshot text.");
      }
      expect(JSON.parse(capabilities.content[0].text)).toMatchObject({
        providers: {
          spec: { provider: "bailian-qwen", ready: false },
          image: { provider: "volcengine-ark", ready: false },
          tts: { provider: "volcengine-speech", ready: false },
          sound: { provider: "freesound", ready: false },
        },
        engineering: { generator: false, runRelay: false },
      });

      const result = await client.callTool({
        name: "validate_provider_config",
        arguments: { config: defaultProviderConfig },
      });

      expect(result.isError).not.toBe(true);
      if (!Array.isArray(result.content)) {
        throw new Error("Expected MCP tool content to be an array.");
      }
      const firstContent = result.content[0];
      expect(firstContent?.type).toBe("text");
      if (firstContent?.type === "text") {
        expect(JSON.parse(firstContent.text)).toMatchObject({
          valid: true,
          config: {
            image: { provider: "volcengine-ark" },
            tts: { provider: "volcengine-speech" },
          },
        });
      }
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("registers the sound search tool only when a provider is configured", async () => {
    const provider: SoundSearchProvider<FreesoundSearchRequest, FreesoundSearchResult> = {
      id: "freesound",
      capability: "sound-search",
      async execute() {
        return { total: 0, candidates: [] };
      },
    };
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = createServer({ soundSearchProvider: provider });
    const client = new Client({ name: "gameforge-sound-test", version: "1.0.0" });

    await server.connect(serverTransport);
    await client.connect(clientTransport);

    try {
      const tools = await client.listTools();
      expect(tools.tools.map((tool) => tool.name)).toContain("search_sound_asset");
      const result = await client.callTool({
        name: "search_sound_asset",
        arguments: { query: "jump", license: "cc0", page: 1, pageSize: 5, sort: "score" },
      });
      expect(result.isError).not.toBe(true);
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("registers project generation only when an output implementation is configured", async () => {
    const generated: ProjectGenerationResult = {
      mode: "dry-run",
      operation: "create",
      plan: {
        generatorVersion: "0.1.0",
        projectId: "safety-sprint",
        target: "web",
        specSha256: "a".repeat(64),
        planSha256: "b".repeat(64),
        files: [{ path: "game-spec.json", bytes: 10, sha256: "c".repeat(64) }],
      },
    };
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = createServer({ projectGenerator: { execute: async () => generated } });
    const client = new Client({ name: "gameforge-generator-test", version: "1.0.0" });
    await server.connect(serverTransport);
    await client.connect(clientTransport);

    try {
      expect((await client.listTools()).tools.map((tool) => tool.name)).toContain("generate_game_project");
      const result = await client.callTool({
        name: "generate_game_project",
        arguments: {
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
      });
      expect(result.isError).not.toBe(true);
    } finally {
      await client.close();
      await server.close();
    }
  });


  it("registers GameSpec drafting only when Bailian is configured", async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = createServer({
      gameSpecDraftProvider: {
        async execute() {
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
      },
    });
    const client = new Client({ name: "gameforge-qwen-test", version: "1.0.0" });
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    try {
      expect((await client.listTools()).tools.map((tool) => tool.name)).toContain("draft_game_spec");
      const result = await client.callTool({
        name: "draft_game_spec",
        arguments: { prompt: "Create a 90 second safety training arcade game." },
      });
      expect(result.isError).not.toBe(true);
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("registers relay lifecycle tools only when a relay client is configured", async () => {
    const client = {
      async createRun(runId: string) {
        return { type: "run.started" as const, runId, sequence: 1, emittedAt: "2026-07-16T06:00:00+08:00" };
      },
      async replayEvents(input: { runId: string; after: number }) {
        return { runId: input.runId, after: input.after, events: [] };
      },
      async publishEvents(batch: { events: unknown[] }) {
        return { accepted: batch.events.length, lastSequence: 2 };
      },
      async completeRun(runId: string) {
        return { type: "run.completed" as const, runId, sequence: 2, emittedAt: "2026-07-16T06:00:01+08:00" };
      },
      async stopRun(runId: string) {
        return { type: "run.stopped" as const, runId, sequence: 2, emittedAt: "2026-07-16T06:00:01+08:00" };
      },
    };
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = createServer({ runRelayClient: client });
    const mcpClient = new Client({ name: "gameforge-relay-test", version: "1.0.0" });
    await server.connect(serverTransport);
    await mcpClient.connect(clientTransport);
    try {
      const names = (await mcpClient.listTools()).tools.map((tool) => tool.name);
      expect(names).toEqual(expect.arrayContaining([
        "create_game_run",
        "replay_game_run",
        "publish_run_events",
        "complete_game_run",
        "stop_game_run",
      ]));
      expect((await mcpClient.callTool({
        name: "create_game_run",
        arguments: { runId: "run-1" },
      })).isError).not.toBe(true);
      expect((await mcpClient.callTool({
        name: "replay_game_run",
        arguments: { runId: "run-1", after: 1 },
      })).isError).not.toBe(true);
    } finally {
      await mcpClient.close();
      await server.close();
    }
  });

  it("registers deterministic task handoff tools only when a task relay is configured", async () => {
    const taskId = "task-00000000-0000-0000-0000-000000000000";
    const queued = {
      taskId,
      runId: "run-1",
      prompt: "Create a complete browser arcade game.",
      language: "en-US" as const,
      status: "queued" as const,
      createdAt: "2026-07-16T08:00:00Z",
    };
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = createServer({
      taskRelayClient: {
        async listTasks() { return [queued]; },
        async getTask() { return queued; },
        async claimTask(_taskId, request) {
          return {
            ...queued,
            status: "claimed",
            claimedAt: "2026-07-16T08:01:00Z",
            claimedBy: request.agentId,
          };
        },
      },
    });
    const client = new Client({ name: "gameforge-task-test", version: "1.0.0" });
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    try {
      const names = (await client.listTools()).tools.map((tool) => tool.name);
      expect(names).toEqual(expect.arrayContaining(["list_game_tasks", "get_game_task", "claim_game_task"]));
      expect((await client.callTool({
        name: "list_game_tasks",
        arguments: { status: "queued", limit: 10 },
      })).isError).not.toBe(true);
      expect((await client.callTool({
        name: "claim_game_task",
        arguments: { taskId, agentId: "codearts" },
      })).isError).not.toBe(true);
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("registers image materialization only when provider and store are both configured", async () => {
    const calls: string[] = [];
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = createServer({
      imageProvider: {
        id: "volcengine-ark",
        capability: "image",
        async execute(request) {
          calls.push(`provider:${request.assetId}`);
          return {
            bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]),
            mimeType: "image/jpeg" as const,
            provenance: {
              assetId: request.assetId,
              kind: "image" as const,
              origin: "generated" as const,
              provider: "volcengine-ark",
              model: "seedream-test",
              prompt: request.prompt,
              license: "contract-defined",
              sha256: "a".repeat(64),
            },
          };
        },
      },
      assetStore: {
        async store(request) {
          calls.push(`store:${request.provenance.assetId}`);
          return {
            entry: {
              assetId: request.provenance.assetId,
              kind: "image",
              role: "player",
              path: "assets/player.jpg",
              mimeType: "image/jpeg",
              bytes: request.bytes.length,
              sha256: request.provenance.sha256,
              provenance: request.provenance,
            },
            manifestRevision: 1,
          };
        },
      },
    });
    const client = new Client({ name: "gameforge-image-test", version: "1.0.0" });
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    try {
      expect((await client.listTools()).tools.map((tool) => tool.name)).toContain("request_image_asset");
      expect((await client.callTool({
        name: "request_image_asset",
        arguments: {
          projectId: "safety-sprint",
          assetId: "player",
          prompt: "A player sprite",
          role: "player",
        },
      })).isError).not.toBe(true);
      expect(calls).toEqual(["provider:player", "store:player"]);

      expect((await client.callTool({
        name: "request_image_asset",
        arguments: {
          projectId: "safety-sprint",
          assetId: "invalid-voice-image",
          prompt: "This request must be rejected before Seedream is called.",
          role: "voice",
        },
      })).isError).toBe(true);
      expect(calls).toEqual(["provider:player", "store:player"]);
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("registers asynchronous TTS tools only with a provider and asset store", async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const jobHandle = `${"a".repeat(80)}.${"b".repeat(43)}`;
    const server = createServer({
      asyncTtsProvider: {
        async submit() {
          return { jobHandle, taskId: "task-42", status: "processing" };
        },
        async query(request) {
          return { jobHandle: request.jobHandle, taskId: "task-42", status: "processing" };
        },
        async materialize() {
          return {
            bytes: new Uint8Array([0x49, 0x44, 0x33, 0x04]),
            mimeType: "audio/mpeg",
            provenance: {
              assetId: "voices/guide",
              kind: "voice",
              origin: "generated",
              provider: "volcengine-speech",
              model: "voice-test",
              prompt: "Guide line",
              license: "account-terms",
              sha256: "c".repeat(64),
            },
          };
        },
      },
      assetStore: {
        async store(request) {
          return {
            entry: {
              assetId: request.provenance.assetId,
              kind: "voice",
              role: "voice",
              path: "assets/voices/guide.mp3",
              mimeType: "audio/mpeg",
              bytes: request.bytes.length,
              sha256: request.provenance.sha256,
              provenance: request.provenance,
            },
            manifestRevision: 1,
          };
        },
      },
    });
    const client = new Client({ name: "gameforge-tts-test", version: "1.0.0" });
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    try {
      const names = (await client.listTools()).tools.map((tool) => tool.name);
      expect(names).toEqual(expect.arrayContaining([
        "submit_voice_job",
        "query_voice_job",
        "materialize_voice_job",
      ]));
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("registers browser verification only when a verifier is configured", async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = createServer({
      projectVerifier: {
        async verify(request) {
          return {
            projectId: request.projectId,
            passed: true,
            state: { status: "running", score: 0, lives: 3, remainingSeconds: 90 },
            screenshotPath: "D:\\proof.png",
            evidencePath: ".gameforge/verification/proof.png",
            canvas: { width: 960, height: 540 },
            consoleErrors: [],
            pageErrors: [],
            failedRequests: [],
            actionsExecuted: request.actions?.length ?? 0,
            durationMs: 100,
          };
        },
      },
    });
    const client = new Client({ name: "gameforge-verifier-test", version: "1.0.0" });
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    try {
      expect((await client.listTools()).tools.map((tool) => tool.name)).toContain("verify_game_project");
      const result = await client.callTool({
        name: "verify_game_project",
        arguments: { projectId: "safety-sprint", actions: [] },
      });
      expect(result.isError).not.toBe(true);
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("registers managed preview lifecycle tools only when a preview manager is configured", async () => {
    const calls: string[] = [];
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = createServer({
      projectPreviewManager: {
        async start(request) {
          calls.push(`start:${request.projectId}`);
          return { projectId: request.projectId, url: "http://127.0.0.1:5173/", reused: false };
        },
        async stop(request) {
          calls.push(`stop:${request.projectId}`);
          return { projectId: request.projectId, stopped: true };
        },
      },
    });
    const client = new Client({ name: "gameforge-preview-test", version: "1.0.0" });
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    try {
      const names = (await client.listTools()).tools.map((tool) => tool.name);
      expect(names).toEqual(expect.arrayContaining(["start_game_preview", "stop_game_preview"]));
      expect((await client.callTool({
        name: "start_game_preview",
        arguments: { projectId: "safety-sprint" },
      })).isError).not.toBe(true);
      expect((await client.callTool({
        name: "stop_game_preview",
        arguments: { projectId: "safety-sprint" },
      })).isError).not.toBe(true);
      expect(calls).toEqual(["start:safety-sprint", "stop:safety-sprint"]);
    } finally {
      await client.close();
      await server.close();
    }
  });
});
