import type {
  GameSpec,
  RunEvent,
  RunPhase,
  RunStatus,
  RuntimeAssetEntry,
  GameforgeCapabilitySnapshot,
} from "@gameforge/contracts";

export type { RunEvent, RunPhase, RunStatus } from "@gameforge/contracts";
export type RunStateAction = RunEvent | { type: "ui.reset" };

export type PhaseStatus = "pending" | "running" | "repair" | "succeeded" | "failed";

export type PhaseState = {
  id: RunPhase;
  label: string;
  status: PhaseStatus;
  attempt: number;
  detail: string;
};

export type RunLog = {
  id: string;
  sequence: number;
  source: "agent" | "tool" | "build" | "test" | "visual";
  level: "info" | "success" | "warning" | "error";
  message: string;
};

export type PreviewState = {
  projectId: string;
  url: string;
};

export type VoiceJobState = {
  projectId: string;
  assetId: string;
  status: "processing" | "succeeded" | "failed";
};

export type VerificationState = {
  projectId: string;
  passed: boolean;
  outcome: "running" | "won" | "lost";
  score: number;
  lives: number;
  remainingSeconds: number;
  evidencePath: string;
  canvas: { width: number; height: number };
  diagnostics: { consoleErrors: number; pageErrors: number; failedRequests: number };
  actionsExecuted: number;
  durationMs: number;
};

export type RunState = {
  runId: string | null;
  language: "zh-CN" | "en-US" | null;
  status: RunStatus;
  lastSequence: number;
  phases: ReadonlyArray<PhaseState>;
  logs: ReadonlyArray<RunLog>;
  preview: PreviewState | null;
  spec: GameSpec | null;
  assets: ReadonlyArray<RuntimeAssetEntry>;
  voiceJobs: ReadonlyArray<VoiceJobState>;
  verification: VerificationState | null;
  capabilities: GameforgeCapabilitySnapshot | null;
};

const phaseLabels: Record<RunPhase, string> = {
  spec: "解析规格",
  template: "选择模板",
  assets: "准备资产",
  code: "生成代码",
  build: "构建检查",
  test: "自动测试",
  visual: "视觉验收",
};

export function createInitialRunState(): RunState {
  return {
    runId: null,
    language: null,
    status: "idle",
    lastSequence: 0,
    phases: (Object.keys(phaseLabels) as RunPhase[]).map((id) => ({
      id,
      label: phaseLabels[id],
      status: "pending",
      attempt: 0,
      detail: "等待开始",
    })),
    logs: [],
    preview: null,
    spec: null,
    assets: [],
    voiceJobs: [],
    verification: null,
    capabilities: null,
  };
}

function updatePhase(
  phases: ReadonlyArray<PhaseState>,
  phaseId: RunPhase,
  update: (phase: PhaseState) => PhaseState,
): ReadonlyArray<PhaseState> {
  return phases.map((phase) => (phase.id === phaseId ? update(phase) : phase));
}

export function runReducer(state: RunState, event: RunStateAction): RunState {
  if (event.type === "ui.reset") return createInitialRunState();
  if (event.type === "run.started") {
    const activeStatuses: ReadonlySet<RunStatus> = new Set(["running", "repair"]);
    if (
      event.sequence !== 1 ||
      state.runId === event.runId ||
      (state.runId !== null && activeStatuses.has(state.status))
    ) {
      return state;
    }

    return {
      ...createInitialRunState(),
      runId: event.runId,
      language: event.language ?? null,
      status: "running",
      lastSequence: event.sequence,
    };
  }

  if (event.sequence <= state.lastSequence) {
    return state;
  }
  if (state.runId !== null && event.runId !== state.runId) {
    return state;
  }

  const eventState = { ...state, lastSequence: event.sequence };

  switch (event.type) {
    case "run.stopped":
      return { ...eventState, status: "stopped" };
    case "run.completed":
      return { ...eventState, status: "succeeded" };
    case "spec.ready":
      return { ...eventState, spec: event.spec };
    case "capabilities.ready":
      return { ...eventState, capabilities: event.snapshot };
    case "asset.ready":
      return {
        ...eventState,
        assets: [
          ...state.assets.filter((asset) => asset.assetId !== event.entry.assetId),
          event.entry,
        ],
      };
    case "preview.ready":
      return {
        ...eventState,
        preview: { projectId: event.projectId, url: event.url },
      };
    case "verification.ready":
      return {
        ...eventState,
        verification: {
          projectId: event.projectId,
          passed: event.passed,
          outcome: event.outcome,
          score: event.score,
          lives: event.lives,
          remainingSeconds: event.remainingSeconds,
          evidencePath: event.evidencePath,
          canvas: event.canvas,
          diagnostics: event.diagnostics,
          actionsExecuted: event.actionsExecuted,
          durationMs: event.durationMs,
        },
      };
    case "voice.job.updated":
      return {
        ...eventState,
        voiceJobs: [
          ...state.voiceJobs.filter((job) => (
            job.projectId !== event.projectId || job.assetId !== event.assetId
          )),
          { projectId: event.projectId, assetId: event.assetId, status: event.status },
        ],
      };
    case "phase.started":
      return {
        ...eventState,
        status: "running",
        phases: updatePhase(state.phases, event.phase, (phase) => ({
          ...phase,
          status: "running",
          attempt: phase.attempt + 1,
          detail: event.detail,
        })),
      };
    case "phase.completed":
      return {
        ...eventState,
        phases: updatePhase(state.phases, event.phase, (phase) => ({
          ...phase,
          status: "succeeded",
          detail: event.detail,
        })),
      };
    case "phase.failed":
      return {
        ...eventState,
        status: event.repairable ? "repair" : "failed",
        phases: updatePhase(state.phases, event.phase, (phase) => ({
          ...phase,
          status: event.repairable ? "repair" : "failed",
          detail: event.message,
        })),
      };
    case "log.appended":
      return {
        ...eventState,
        logs: [
          ...state.logs,
          {
            id: `${event.runId}:${event.sequence}`,
            sequence: event.sequence,
            source: event.source,
            level: event.level,
            message: event.message,
          },
        ].slice(-200),
      };
  }
}

export function createDemoEvents(runId: string): ReadonlyArray<RunEvent> {
  let sequence = 1;
  const next = (): number => sequence++;

  return [
    { type: "run.started", runId, sequence: next() },
    {
      type: "capabilities.ready",
      runId,
      sequence: next(),
      snapshot: {
        providers: {
          spec: { provider: "bailian-qwen", ready: false },
          image: { provider: "volcengine-ark", ready: false },
          tts: { provider: "volcengine-speech", ready: false },
          sound: { provider: "freesound", ready: false },
        },
        engineering: { assetStore: false, generator: true, douyinBuild: false, verifier: true, preview: true, runRelay: false, taskInbox: false },
      },
    },
    {
      type: "log.appended",
      runId,
      sequence: next(),
      source: "agent",
      level: "info",
      message: "读取 GameSpec 与项目约束。",
    },
    { type: "phase.started", runId, sequence: next(), phase: "spec", detail: "Zod 校验中" },
    {
      type: "spec.ready",
      runId,
      sequence: next(),
      spec: {
        title: "Safety Sprint",
        genre: "arcade",
        objective: "在倒计时结束前收集全部防护装备并抵达出口。",
        controls: ["方向键移动"],
        winCondition: "收集全部防护装备并抵达出口。",
        loseCondition: "倒计时归零或与叉车碰撞三次。",
        targetDurationSeconds: 90,
        gameplay: { collectibleCount: 5, hazardCount: 3, startingLives: 3, movementSpeed: 220 },
      },
    },
    { type: "phase.completed", runId, sequence: next(), phase: "spec", detail: "规格有效" },
    {
      type: "phase.started",
      runId,
      sequence: next(),
      phase: "template",
      detail: "匹配 Phaser Arcade 模板",
    },
    {
      type: "phase.completed",
      runId,
      sequence: next(),
      phase: "template",
      detail: "模板已锁定",
    },
    { type: "phase.started", runId, sequence: next(), phase: "assets", detail: "检查资产来源" },
    {
      type: "asset.ready",
      runId,
      sequence: next(),
      projectId: "safety-sprint",
      manifestRevision: 1,
      entry: {
        assetId: "jump",
        kind: "sound",
        role: "hit-sound",
        path: "assets/jump.wav",
        mimeType: "audio/wav",
        bytes: 128,
        sha256: "a".repeat(64),
        provenance: {
          assetId: "jump",
          kind: "sound",
          origin: "retrieved",
          provider: "freesound",
          sourceUrl: "https://freesound.org/s/42/",
          license: "CC0",
          sha256: "a".repeat(64),
        },
      },
    },
    {
      type: "log.appended",
      runId,
      sequence: next(),
      source: "tool",
      level: "success",
      message: "validate_asset_manifest：4 项资产来源有效。",
    },
    { type: "phase.completed", runId, sequence: next(), phase: "assets", detail: "资产清单有效" },
    { type: "phase.started", runId, sequence: next(), phase: "code", detail: "生成场景与玩法代码" },
    { type: "phase.completed", runId, sequence: next(), phase: "code", detail: "代码变更已写入" },
    { type: "phase.started", runId, sequence: next(), phase: "build", detail: "运行 TypeScript 检查" },
    {
      type: "phase.failed",
      runId,
      sequence: next(),
      phase: "build",
      message: "发现 1 个严格类型错误，准备 Repair",
      repairable: true,
    },
    {
      type: "log.appended",
      runId,
      sequence: next(),
      source: "build",
      level: "warning",
      message: "TS2322：碰撞回调参数类型不兼容。",
    },
    { type: "phase.started", runId, sequence: next(), phase: "build", detail: "Repair 后重新检查" },
    { type: "phase.completed", runId, sequence: next(), phase: "build", detail: "类型检查通过" },
    { type: "phase.started", runId, sequence: next(), phase: "test", detail: "运行 Vitest" },
    {
      type: "log.appended",
      runId,
      sequence: next(),
      source: "test",
      level: "success",
      message: "18 项契约测试与 4 项 MCP 测试通过。",
    },
    { type: "phase.completed", runId, sequence: next(), phase: "test", detail: "测试通过" },
    { type: "phase.started", runId, sequence: next(), phase: "visual", detail: "等待浏览器截图" },
    {
      type: "preview.ready",
      runId,
      sequence: next(),
      projectId: "safety-sprint",
      url: "http://127.0.0.1:5173/",
    },
    {
      type: "verification.ready",
      runId,
      sequence: next(),
      projectId: "safety-sprint",
      passed: true,
      outcome: "won",
      score: 5,
      lives: 2,
      remainingSeconds: 24,
      evidencePath: ".gameforge/verification/demo-proof.png",
      canvas: { width: 960, height: 540 },
      diagnostics: { consoleErrors: 0, pageErrors: 0, failedRequests: 0 },
      actionsExecuted: 12,
      durationMs: 2_400,
    },
    {
      type: "phase.completed",
      runId,
      sequence: next(),
      phase: "visual",
      detail: "预览可见，控制台无错误",
    },
    { type: "run.completed", runId, sequence: next() },
  ];
}
