import { gameTaskSchema, type RunEventBatch, type WireRunEvent } from "@gameforge/contracts";
import { describe, expect, it } from "vitest";
import { captureBenchmarkEvidence, type EvidenceRelayClient } from "./capture.js";

const prompt = "Create a complete browser collection game with deterministic verification.";
const definition = {
  benchmarkId: "capture-evidence",
  prompt,
  language: "en-US" as const,
  target: {
    genre: "collect" as const,
    durationSeconds: 90,
    collectibleCount: 5,
    hazardCount: 3,
    startingLives: 3,
    movementSpeed: 220,
    mediaEnabled: false,
  },
};
const metadata = {
  client: { name: "codearts" as const, version: "26.6.2" },
  tools: { count: null, names: [], errors: null },
  humanInterventions: ["Started the OAuth TUI manually."],
  failure: "none" as const,
  evidence: ["experiments/capture/result.md"],
};
const miniPrompt = "制作一个45秒内可完成的中文抖音街机收集小游戏，使用程序化素材，并完成本地逻辑验收与LayaAir构建。";
const miniDefinition = {
  benchmarkId: "codearts-douyin-local-production",
  prompt: miniPrompt,
  language: "zh-CN" as const,
  target: {
    genre: "collect" as const,
    platform: "douyin-mini-game" as const,
    runtimeGenre: "arcade" as const,
    durationSeconds: 45,
    collectibleCount: 3,
    hazardCount: 2,
    startingLives: 3,
    movementSpeed: 220,
    mediaEnabled: false,
  },
};
const miniMetadata = {
  client: { name: "codearts" as const, version: "26.6.2" },
  tools: { count: null, names: [], errors: null },
  humanInterventions: ["Allowed the local production tools for this isolated experiment."],
  failure: "none" as const,
  evidence: ["experiments/codearts-douyin/result.md"],
};

describe("benchmark evidence capture", () => {
  it("paginates a complete run and exports only allowlisted summaries", async () => {
    const events = completeEvents();
    const calls: number[] = [];
    const relay = relayFixture(events, calls);
    const record = await captureBenchmarkEvidence({
      definition,
      metadata,
      taskId: "task-00000000-0000-0000-0000-000000000000",
      relay,
      mcpAudit: auditFixture(),
    });

    expect(calls).toEqual([0, 1000]);
    expect(record).toMatchObject({
      benchmarkId: "capture-evidence",
      terminalStatus: "completed",
      events: { count: 1001, types: { "run.started": 1, "log.appended": 998, "verification.ready": 1, "run.completed": 1 } },
      verification: { passed: true, outcome: "won", diagnostics: 0 },
      tools: { count: 2, names: ["validate_game_spec", "generate_game_project"], errors: 1 },
    });
    expect(record.evidence).toContain(".gameforge/verification/capture.png");
    expect(record.toolAudit).toMatchObject({ sessionId: "00000000-0000-4000-8000-000000000001" });
    const serialized = JSON.stringify(record);
    expect(serialized).not.toContain("DASHSCOPE_API_KEY");
    expect(serialized).not.toContain("super-secret");
    expect(serialized).not.toContain(prompt);
  });

  it("refuses a definition mismatch and incomplete completed evidence", async () => {
    const events = completeEvents();
    await expect(captureBenchmarkEvidence({
      definition: { ...definition, prompt: "Create a different complete browser collection game." },
      metadata,
      taskId: "task-00000000-0000-0000-0000-000000000000",
      relay: relayFixture(events),
    })).rejects.toThrow("does not match");

    await expect(captureBenchmarkEvidence({
      definition,
      metadata,
      taskId: "task-00000000-0000-0000-0000-000000000000",
      relay: relayFixture(events.filter((event) => event.type !== "verification.ready").map((event, index) => ({
        ...event,
        sequence: index + 1,
      })) as WireRunEvent[]),
    })).rejects.toThrow("Completed records require");
  });

  it("rejects sensitive metadata instead of attempting lossy redaction", async () => {
    await expect(captureBenchmarkEvidence({
      definition,
      metadata: {
        ...metadata,
        humanInterventions: ["token=super-secret"],
        evidence: ["D:\\private\\capture.png"],
      },
      taskId: "task-00000000-0000-0000-0000-000000000000",
      relay: relayFixture(completeEvents()),
    })).rejects.toThrow();
  });

  it("rejects truncated audits and conflicts with manual tool counts", async () => {
    await expect(captureBenchmarkEvidence({
      definition,
      metadata,
      taskId: "task-00000000-0000-0000-0000-000000000000",
      relay: relayFixture(completeEvents()),
      mcpAudit: { ...auditFixture(), truncated: true },
    })).rejects.toThrow("Truncated");
    await expect(captureBenchmarkEvidence({
      definition,
      metadata: { ...metadata, tools: { count: 1, names: ["validate_game_spec"], errors: 0 } },
      taskId: "task-00000000-0000-0000-0000-000000000000",
      relay: relayFixture(completeEvents()),
      mcpAudit: auditFixture(),
    })).rejects.toThrow("requires unknown tools");
    const { context: _context, ...unboundAudit } = auditFixture();
    await expect(captureBenchmarkEvidence({
      definition,
      metadata,
      taskId: "task-00000000-0000-0000-0000-000000000000",
      relay: relayFixture(completeEvents()),
      mcpAudit: unboundAudit,
    })).rejects.toThrow("not bound");
    await expect(captureBenchmarkEvidence({
      definition,
      metadata,
      taskId: "task-00000000-0000-0000-0000-000000000000",
      relay: relayFixture(completeEvents()),
      mcpAudit: { ...auditFixture(), context: { ...auditFixture().context, runId: "another-run" } },
    })).rejects.toThrow("not bound");
  });

  it("captures a completed Douyin workflow from strict gameplay and build summaries", async () => {
    const record = await captureBenchmarkEvidence({
      definition: miniDefinition,
      metadata: miniMetadata,
      taskId: "task-11111111-1111-1111-1111-111111111111",
      relay: miniRelayFixture(douyinEvents()),
    });

    expect(record).toMatchObject({
      terminalStatus: "completed",
      events: {
        count: 6,
        types: {
          "run.started": 1,
          "capabilities.ready": 1,
          "spec.ready": 1,
          "gameplay.verified": 1,
          "build.ready": 1,
          "run.completed": 1,
        },
      },
      minigame: {
        projectId: "codearts-douyin-arcade",
        target: "douyin-mini-game",
        genre: "arcade",
        gameplay: {
          passed: true,
          scenarios: [
            { name: "genre-win", outcome: "won", actions: 3 },
            { name: "timeout-loss", outcome: "lost", actions: 1 },
          ],
          durationMs: 122,
        },
        build: {
          passed: true,
          cliVersion: "3.4.0",
          fileCount: 14,
          totalBytes: 1_112_075,
          mainPackageBytes: 1_112_075,
          subpackageCount: 0,
          assetManifestRevision: 0,
          assetCount: 0,
          stdoutTruncated: false,
          stderrTruncated: false,
        },
      },
    });
    expect(record.verification).toBeUndefined();
    const serialized = JSON.stringify(record);
    expect(serialized).not.toContain("templateSha256");
    expect(serialized).not.toContain("allowedNetworkHosts");
    expect(serialized).not.toContain("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
    expect(serialized).not.toContain(miniPrompt);
  });

  it("rejects mismatched mini-game identity, platform, and runtime genre", async () => {
    const projectMismatch = douyinEvents().map((event): WireRunEvent => event.type === "build.ready"
      ? { ...event, projectId: "another-game" }
      : event);
    await expect(captureBenchmarkEvidence({
      definition: miniDefinition,
      metadata: miniMetadata,
      taskId: "task-11111111-1111-1111-1111-111111111111",
      relay: miniRelayFixture(projectMismatch),
    })).rejects.toThrow("project IDs");

    await expect(captureBenchmarkEvidence({
      definition: {
        ...miniDefinition,
        target: { ...miniDefinition.target, platform: "wechat-mini-game" as const },
      },
      metadata: miniMetadata,
      taskId: "task-11111111-1111-1111-1111-111111111111",
      relay: miniRelayFixture(douyinEvents()),
    })).rejects.toThrow("targets");

    await expect(captureBenchmarkEvidence({
      definition: {
        ...miniDefinition,
        target: { ...miniDefinition.target, runtimeGenre: "puzzle" as const },
      },
      metadata: miniMetadata,
      taskId: "task-11111111-1111-1111-1111-111111111111",
      relay: miniRelayFixture(douyinEvents()),
    })).rejects.toThrow("runtime genres");
  });

  it("rejects completed mini-game evidence missing either required proof event", async () => {
    for (const missing of ["gameplay.verified", "build.ready"] as const) {
      const events = douyinEvents()
        .filter((event) => event.type !== missing)
        .map((event, index): WireRunEvent => ({ ...event, sequence: index + 1 }));
      await expect(captureBenchmarkEvidence({
        definition: miniDefinition,
        metadata: miniMetadata,
        taskId: "task-11111111-1111-1111-1111-111111111111",
        relay: miniRelayFixture(events),
      })).rejects.toThrow("requires both");
    }
  });
});

function relayFixture(events: WireRunEvent[], calls: number[] = []): EvidenceRelayClient {
  const task = gameTaskSchema.parse({
    taskId: "task-00000000-0000-0000-0000-000000000000",
    runId: "capture-run",
    prompt,
    language: "en-US",
    status: "completed",
    createdAt: time(1),
    claimedAt: time(2),
    claimedBy: "codearts",
    completedAt: time(1001),
  });
  return {
    async getTask() { return task; },
    async replayEvents(input): Promise<RunEventBatch> {
      calls.push(input.after);
      return { runId: input.runId, after: input.after, events: events.slice(input.after, input.after + 1000) };
    },
  };
}

function completeEvents(): WireRunEvent[] {
  const events: WireRunEvent[] = [{
    type: "run.started",
    runId: "capture-run",
    sequence: 1,
    emittedAt: time(1),
    language: "en-US",
  }];
  for (let sequence = 2; sequence <= 999; sequence += 1) {
    events.push({
      type: "log.appended",
      runId: "capture-run",
      sequence,
      emittedAt: time(sequence),
      source: "agent",
      level: "info",
      message: "DASHSCOPE_API_KEY=super-secret D:\\private\\workspace",
    });
  }
  events.push({
    type: "verification.ready",
    runId: "capture-run",
    sequence: 1000,
    emittedAt: time(1000),
    projectId: "capture-game",
    passed: true,
    outcome: "won",
    score: 5,
    lives: 3,
    remainingSeconds: 12,
    evidencePath: ".gameforge/verification/capture.png",
    canvas: { width: 960, height: 540 },
    diagnostics: { consoleErrors: 0, pageErrors: 0, failedRequests: 0 },
    actionsExecuted: 6,
    durationMs: 2_000,
  });
  events.push({ type: "run.completed", runId: "capture-run", sequence: 1001, emittedAt: time(1001) });
  return events;
}

function miniRelayFixture(events: WireRunEvent[]): EvidenceRelayClient {
  const task = gameTaskSchema.parse({
    taskId: "task-11111111-1111-1111-1111-111111111111",
    runId: "codearts-douyin-run",
    prompt: miniPrompt,
    language: "zh-CN",
    status: "completed",
    createdAt: time(1),
    claimedAt: time(2),
    claimedBy: "codearts",
    completedAt: time(6),
  });
  return {
    async getTask() { return task; },
    async replayEvents(input): Promise<RunEventBatch> {
      return { runId: input.runId, after: input.after, events: events.slice(input.after, input.after + 1000) };
    },
  };
}

function douyinEvents(): WireRunEvent[] {
  return [
    {
      type: "run.started",
      runId: "codearts-douyin-run",
      sequence: 1,
      emittedAt: time(1),
      language: "zh-CN",
    },
    {
      type: "capabilities.ready",
      runId: "codearts-douyin-run",
      sequence: 2,
      emittedAt: time(2),
      snapshot: {
        providers: {
          spec: { provider: "bailian-qwen", ready: false },
          image: { provider: "volcengine-ark", ready: false },
          tts: { provider: "volcengine-speech", ready: false },
          sound: { provider: "freesound", ready: false },
          music: { provider: "minimax", ready: false },
        },
        engineering: {
          assetStore: true,
          generator: true,
          douyinBuild: true,
          wechatBuild: true,
          gameplayVerifier: true,
          verifier: true,
          preview: true,
          runRelay: true,
          taskInbox: true,
        },
      },
    },
    {
      type: "spec.ready",
      runId: "codearts-douyin-run",
      sequence: 3,
      emittedAt: time(3),
      spec: {
        title: "星尘拾光",
        locale: "zh-CN",
        genre: "arcade",
        objective: "在霓虹场地中移动角色，收集全部星尘并避开障碍。",
        controls: ["方向键或WASD移动", "触摸屏幕拖动角色"],
        winCondition: "收集全部星尘即可获胜。",
        loseCondition: "生命耗尽或倒计时结束则失败。",
        targetDurationSeconds: 45,
        gameplay: { collectibleCount: 3, hazardCount: 2, startingLives: 3, movementSpeed: 220 },
      },
    },
    {
      type: "gameplay.verified",
      runId: "codearts-douyin-run",
      sequence: 4,
      emittedAt: time(4),
      projectId: "codearts-douyin-arcade",
      target: "douyin-mini-game",
      genre: "arcade",
      passed: true,
      scenarios: [
        { name: "genre-win", outcome: "won", actions: 3 },
        { name: "timeout-loss", outcome: "lost", actions: 1 },
      ],
      durationMs: 122,
      templateSha256: "a".repeat(64),
    },
    {
      type: "build.ready",
      runId: "codearts-douyin-run",
      sequence: 5,
      emittedAt: time(5),
      projectId: "codearts-douyin-arcade",
      target: "douyin-mini-game",
      cliVersion: "3.4.0",
      passed: true,
      fileCount: 14,
      totalBytes: 1_112_075,
      mainPackageBytes: 1_112_075,
      subpackages: [],
      deviceOrientation: "portrait",
      capabilities: { network: false, login: false, share: false, ads: false, payments: false },
      allowedNetworkHosts: [],
      assetManifestRevision: 0,
      assetCount: 0,
      stdoutTruncated: false,
      stderrTruncated: false,
    },
    {
      type: "run.completed",
      runId: "codearts-douyin-run",
      sequence: 6,
      emittedAt: time(6),
    },
  ];
}

function time(sequence: number): string {
  return new Date(Date.UTC(2026, 6, 18, 0, 0, 0, sequence)).toISOString();
}

function auditFixture() {
  return {
    schemaVersion: 1 as const,
    sessionId: "00000000-0000-4000-8000-000000000001",
    startedAt: time(1),
    truncated: false,
    context: {
      taskId: "task-00000000-0000-0000-0000-000000000000",
      runId: "capture-run",
      boundAt: time(2),
    },
    calls: [
      { sequence: 1, tool: "validate_game_spec", startedAt: time(2), durationMs: 4, outcome: "success" as const },
      { sequence: 2, tool: "generate_game_project", startedAt: time(3), durationMs: 8, outcome: "error" as const },
    ],
  };
}
