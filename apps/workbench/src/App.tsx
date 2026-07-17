import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { gamePreviewUrlSchema } from "@gameforge/contracts";
import {
  createDemoEvents,
  createInitialRunState,
  runReducer,
  type PhaseStatus,
  type RunStatus,
} from "./run-state.js";
import { connectRunEventStream, createGameTask, fetchRunEvents, stopRun } from "./run-client.js";
import { createWorkbenchRunId } from "./run-id.js";
import { createMapView, createSceneNodes } from "./design-view.js";
import { configuredPreviewOrigins, isAllowedPreviewUrl, previewFramePolicy, previewWindowRel, safePreviewUrl } from "./preview-security.js";

const configuredPreviewUrl = gamePreviewUrlSchema.safeParse(
  import.meta.env.VITE_GAME_PREVIEW_URL ?? "http://localhost:5173/",
);
const fallbackPreviewUrl = configuredPreviewUrl.success
  ? configuredPreviewUrl.data
  : "http://localhost:5173/";
const previewOrigins = configuredPreviewOrigins(import.meta.env.VITE_GAME_PREVIEW_ORIGINS);
const configuredAgentBaseUrl = import.meta.env.VITE_AGENT_BASE_URL?.trim();
const agentBaseUrl = configuredAgentBaseUrl === undefined || configuredAgentBaseUrl.length === 0
  ? (import.meta.env.DEV ? "http://127.0.0.1:8787/" : null)
  : configuredAgentBaseUrl;

const genreLabels = {
  arcade: "Arcade",
  platformer: "Platformer",
  puzzle: "Puzzle",
  shooter: "Shooter",
  strategy: "Strategy",
} as const;

const assetKindLabels = {
  image: "图片",
  voice: "配音",
  sound: "音效",
  music: "音乐",
} as const;

const statusLabels: Record<RunStatus, string> = {
  idle: "等待运行",
  running: "运行中",
  repair: "正在修复",
  succeeded: "已完成",
  failed: "失败",
  stopped: "已停止",
};

const phaseStatusLabels: Record<PhaseStatus, string> = {
  pending: "等待",
  running: "进行中",
  repair: "Repair",
  succeeded: "通过",
  failed: "失败",
};

export function App(): React.JSX.Element {
  const [runState, dispatch] = useReducer(runReducer, undefined, createInitialRunState);
  const [activeStage, setActiveStage] = useState<"preview" | "scene" | "map">("preview");
  const [activeSideTab, setActiveSideTab] = useState<"spec" | "assets">("spec");
  const [prompt, setPrompt] = useState(
    "制作一个90秒的俯视角安全训练小游戏：玩家收集5件防护装备，避开移动叉车，在倒计时结束前抵达出口。",
  );
  const [taskLanguage, setTaskLanguage] = useState<"zh-CN" | "en-US">("zh-CN");
  const [previewKey, setPreviewKey] = useState(0);
  const [relayRunId, setRelayRunId] = useState(() => createWorkbenchRunId());
  const [relayState, setRelayState] = useState<"disconnected" | "connecting" | "connected" | "error">("disconnected");
  const [relayMessage, setRelayMessage] = useState("等待连接事件中继");
  const [taskId, setTaskId] = useState<string | null>(null);
  const timerRef = useRef<number | null>(null);
  const disconnectRelayRef = useRef<(() => void) | null>(null);
  const relayCursorRef = useRef(0);

  useEffect(() => {
    if (runState.language !== null) setTaskLanguage(runState.language);
  }, [runState.language]);

  const progress = useMemo(() => {
    const completed = runState.phases.filter((phase) => phase.status === "succeeded").length;
    return Math.round((completed / runState.phases.length) * 100);
  }, [runState.phases]);
  const previewCandidate = runState.preview?.url;
  const previewAllowed = previewCandidate === undefined || isAllowedPreviewUrl(previewCandidate, previewOrigins);
  const previewUrl = safePreviewUrl(previewCandidate, fallbackPreviewUrl, previewOrigins);
  const previewHost = new URL(previewUrl).host;
  const sceneNodes = useMemo(
    () => runState.spec === null ? [] : createSceneNodes(runState.spec, runState.assets),
    [runState.spec, runState.assets],
  );
  const mapView = useMemo(
    () => runState.spec === null ? null : createMapView(runState.spec),
    [runState.spec],
  );
  const providers = useMemo(() => {
    const capabilities = runState.capabilities?.providers;
    const item = (name: string, ready: boolean | undefined) => ({
      name,
      detail: ready === undefined ? "等待 capability 事件" : ready ? "本次 MCP 已配置" : "本次 MCP 未配置",
      state: ready === undefined ? "supported" : ready ? "ready" : "pending",
    });
    return [
      item("Qwen", capabilities?.spec.ready),
      item("Seedream", capabilities?.image.ready),
      item("豆包语音", capabilities?.tts.ready),
      item("Freesound", capabilities?.sound.ready),
    ];
  }, [runState.capabilities]);

  const stopDemo = (): void => {
    const timerId = timerRef.current;
    const demoWasRunning = timerId !== null;
    if (timerId !== null) {
      window.clearInterval(timerId);
      timerRef.current = null;
    }
    if (demoWasRunning && runState.runId !== null && runState.status !== "idle") {
      dispatch({
        type: "run.stopped",
        runId: runState.runId,
        sequence: runState.lastSequence + 1,
      });
    }
  };

  const runDemo = (): void => {
    disconnectRelay();
    stopDemo();
    const runId = `demo-${Date.now()}`;
    const events = createDemoEvents(runId);
    let index = 0;

    const emitNext = (): void => {
      const event = events[index];
      if (event === undefined) {
        if (timerRef.current !== null) {
          window.clearInterval(timerRef.current);
          timerRef.current = null;
        }
        return;
      }
      dispatch(event);
      index += 1;
    };

    emitNext();
    timerRef.current = window.setInterval(emitNext, 340);
  };

  const disconnectRelay = (): void => {
    disconnectRelayRef.current?.();
    disconnectRelayRef.current = null;
    relayCursorRef.current = 0;
    setRelayState("disconnected");
    setRelayMessage("已断开事件中继");
  };

  const attachRelayStream = (runId: string, cursor: number): void => {
    if (agentBaseUrl === null) throw new Error("事件中继未配置。");
    relayCursorRef.current = cursor;
    disconnectRelayRef.current = connectRunEventStream({
      baseUrl: agentBaseUrl,
      runId,
      after: cursor,
      onEvent(event) {
        relayCursorRef.current = event.sequence;
        dispatch(event);
      },
      onOpen(cursorNow) {
        setRelayState("connected");
        setRelayMessage(`已连接 ${runId}，游标 ${cursorNow}`);
      },
      onGap(gap) {
        disconnectRelayRef.current?.();
        disconnectRelayRef.current = null;
        setRelayState("error");
        setRelayMessage(`事件缺口：等待 ${gap.expected}，收到 ${gap.received}；请重新连接回补`);
      },
      onError(error) {
        setRelayState("error");
        setRelayMessage(error.message);
      },
    });
  };

  const connectRelay = async (): Promise<void> => {
    if (agentBaseUrl === null) return;
    stopDemo();
    disconnectRelay();
    setTaskId(null);
    setRelayState("connecting");
    setRelayMessage("正在回放已有运行");

    try {
      let cursor = 0;
      for (let page = 0; page < 10; page += 1) {
        const events = await fetchRunEvents({ baseUrl: agentBaseUrl, runId: relayRunId, after: cursor });
        for (const event of events) dispatch(event);
        if (events.length > 0) cursor = events.at(-1)?.sequence ?? cursor;
        if (events.length < 1_000) break;
      }
      attachRelayStream(relayRunId, cursor);
      setRelayState("connected");
      setRelayMessage(`已连接 ${relayRunId}，游标 ${cursor}`);
    } catch (error) {
      setRelayState("error");
      setRelayMessage(error instanceof Error ? error.message : "事件中继连接失败");
    }
  };

  const submitTask = async (): Promise<void> => {
    if (agentBaseUrl === null) return;
    if (runState.status === "running" || runState.status === "repair") {
      setRelayState("error");
      setRelayMessage("当前运行尚未结束；请先停止或完成后再提交新任务。");
      return;
    }
    stopDemo();
    disconnectRelay();
    setRelayState("connecting");
    setRelayMessage("正在提交 CodeArts 任务");
    try {
      const created = await createGameTask({
        baseUrl: agentBaseUrl,
        runId: relayRunId,
        prompt,
        language: taskLanguage,
      });
      setTaskId(created.task.taskId);
      dispatch(created.event);
      attachRelayStream(created.task.runId, created.event.sequence);
      setRelayState("connected");
      setRelayMessage(`任务已排队；等待 CodeArts 认领，游标 ${created.event.sequence}`);
    } catch (error) {
      setRelayState("error");
      setRelayMessage(error instanceof Error ? error.message : "任务提交失败");
    }
  };

  const prepareNewTask = (): void => {
    if (runState.status === "running" || runState.status === "repair") {
      setRelayState("error");
      setRelayMessage("当前运行尚未结束；请先停止或等待完成后再创建新任务。");
      return;
    }
    disconnectRelay();
    stopDemo();
    const nextRunId = createWorkbenchRunId();
    dispatch({ type: "ui.reset" });
    setRelayRunId(nextRunId);
    setTaskId(null);
    setRelayMessage(`已准备新任务 ${nextRunId}`);
  };

  const stopRelayRun = async (): Promise<void> => {
    if (agentBaseUrl === null) return;
    disconnectRelayRef.current?.();
    disconnectRelayRef.current = null;
    setRelayState("connecting");
    setRelayMessage("正在请求停止运行");
    try {
      const stopped = await stopRun({ baseUrl: agentBaseUrl, runId: relayRunId });
      relayCursorRef.current = stopped.sequence;
      dispatch(stopped);
      setRelayState("disconnected");
      setRelayMessage(`运行 ${relayRunId} 已停止`);
    } catch (error) {
      setRelayState("error");
      setRelayMessage(error instanceof Error ? error.message : "停止运行失败");
    }
  };

  useEffect(() => () => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
    }
    disconnectRelayRef.current?.();
  }, []);

  return (
    <main className="workbench-shell">
      <header className="topbar">
        <div className="brand-block">
          <span className="brand-mark" aria-hidden="true">GF</span>
          <div>
            <strong>GameForge</strong>
            <span>AGENT WORKBENCH</span>
          </div>
        </div>

        <div className="provider-strip" aria-label="Provider 支持情况">
          {providers.map((provider) => (
            <div className="provider-chip" key={provider.name}>
              <span className={`status-dot ${provider.state}`} />
              <span><strong>{provider.name}</strong><small>{provider.detail}</small></span>
            </div>
          ))}
        </div>

        <div className="run-controls">
          <span className={`mode-badge ${relayState}`}>
            {agentBaseUrl === null ? "事件演示 · 未连接Agent" : `事件中继 · ${relayState}`}
          </span>
          <button className="button secondary" type="button" onClick={agentBaseUrl === null ? stopDemo : () => void stopRelayRun()}>
            停止
          </button>
          <button className="button primary" type="button" onClick={agentBaseUrl === null ? runDemo : () => void connectRelay()}>
            {agentBaseUrl === null ? "运行演示" : "连接运行"}
          </button>
        </div>
      </header>

      <section className="workspace-grid">
        <aside className="panel left-panel">
          <div className="tab-row compact-tabs" role="tablist">
            <button className={activeSideTab === "spec" ? "active" : ""} onClick={() => setActiveSideTab("spec")} type="button">需求与规格</button>
            <button className={activeSideTab === "assets" ? "active" : ""} onClick={() => setActiveSideTab("assets")} type="button">资产与授权</button>
          </div>

          {activeSideTab === "spec" ? (
            <div className="panel-content spec-content">
              <label className="field-label" htmlFor="game-prompt">游戏需求</label>
              <textarea id="game-prompt" value={prompt} onChange={(event) => setPrompt(event.target.value)} rows={6} />
              <label className="field-label language-label" htmlFor="task-language">生成语言</label>
              <select
                id="task-language"
                value={taskLanguage}
                disabled={relayState === "connecting" || relayState === "connected"}
                onChange={(event) => setTaskLanguage(event.target.value === "en-US" ? "en-US" : "zh-CN")}
              >
                <option value="zh-CN">简体中文</option>
                <option value="en-US">English (US)</option>
              </select>
              {agentBaseUrl !== null && (
                <div className={`relay-card ${relayState}`}>
                  <label htmlFor="relay-run-id">Run ID</label>
                  <input
                    id="relay-run-id"
                    value={relayRunId}
                    disabled={relayState === "connecting" || relayState === "connected"}
                    onChange={(event) => setRelayRunId(event.target.value)}
                  />
                  <p>{relayMessage}</p>
                  {taskId !== null && <p className="task-receipt">Task <code>{taskId}</code></p>}
                  <div>
                    <button type="button" onClick={() => void submitTask()}>提交给 CodeArts</button>
                    <button type="button" onClick={prepareNewTask}>新任务</button>
                    <button type="button" onClick={runDemo}>本地演示</button>
                  </div>
                </div>
              )}
              <div className="section-title">
                <span>GameSpec</span>
                <span className={`valid-badge ${runState.spec === null ? "pending" : ""}`}>
                  {runState.spec === null ? "等待事件" : "Schema 有效"}
                </span>
              </div>
              {runState.spec === null ? (
                <div className="empty-data">等待 CodeArts 发布 <code>spec.ready</code>。</div>
              ) : (
                <>
                  <dl className="spec-grid">
                    <div><dt>标题</dt><dd>{runState.spec.title}</dd></div>
                    <div><dt>语言</dt><dd>{runState.spec.locale ?? "zh-CN"}</dd></div>
                    <div><dt>类型</dt><dd>{genreLabels[runState.spec.genre]}</dd></div>
                    <div><dt>时长</dt><dd>{runState.spec.targetDurationSeconds} 秒</dd></div>
                    <div><dt>引擎</dt><dd>Phaser</dd></div>
                    <div><dt>目标数</dt><dd>{runState.spec.gameplay?.collectibleCount ?? (runState.spec.genre === "strategy" ? 6 : 5)}</dd></div>
                    <div><dt>危险数</dt><dd>{runState.spec.gameplay?.hazardCount ?? (runState.spec.genre === "platformer" ? 2 : 3)}</dd></div>
                    <div><dt>初始生命</dt><dd>{runState.spec.gameplay?.startingLives ?? 3}</dd></div>
                    <div><dt>移动速度</dt><dd>{runState.spec.gameplay?.movementSpeed ?? (runState.spec.genre === "strategy" ? 150 : runState.spec.genre === "platformer" ? 210 : 220)}</dd></div>
                  </dl>
                  <div className="spec-card">
                    <span>目标</span>
                    <p>{runState.spec.objective}</p>
                  </div>
                  <div className="spec-card">
                    <span>胜利条件</span>
                    <p>{runState.spec.winCondition}</p>
                  </div>
                  <div className="spec-card warning-card">
                    <span>失败条件</span>
                    <p>{runState.spec.loseCondition}</p>
                  </div>
                </>
              )}
            </div>
          ) : (
            <div className="panel-content asset-list">
              <div className="section-title"><span>Asset Manifest</span><span className="count-badge">{runState.assets.length}</span></div>
              {runState.voiceJobs.length > 0 && (
                <div className="voice-job-list" aria-label="异步配音任务">
                  {runState.voiceJobs.map((job) => (
                    <div className="spec-card" key={`${job.projectId}:${job.assetId}`}>
                      <span>异步配音 · {job.status}</span>
                      <p>{job.assetId}</p>
                    </div>
                  ))}
                </div>
              )}
              {runState.assets.length === 0 ? (
                <div className="empty-data">等待 CodeArts 发布 <code>asset.ready</code>。</div>
              ) : runState.assets.map((asset) => {
                const type = assetKindLabels[asset.kind];
                return (
                  <article className="asset-row" key={asset.assetId}>
                    <div className={`asset-icon ${asset.kind}`}>{type.slice(0, 1)}</div>
                    <div>
                      <strong>{asset.path.split("/").at(-1) ?? asset.assetId}</strong>
                      <span>{asset.provenance.provider} · {type} · {asset.role ?? "未绑定角色"}</span>
                    </div>
                    <em>{asset.provenance.license}</em>
                  </article>
                );
              })}
            </div>
          )}
        </aside>

        <section className="panel stage-panel">
          <div className="stage-toolbar">
            <div className="tab-row" role="tablist">
              <button className={activeStage === "preview" ? "active" : ""} onClick={() => setActiveStage("preview")} type="button">游戏预览</button>
              <button className={activeStage === "scene" ? "active" : ""} onClick={() => setActiveStage("scene")} type="button">场景结构</button>
              <button className={activeStage === "map" ? "active" : ""} onClick={() => setActiveStage("map")} type="button">地图视图</button>
            </div>
            <div className="preview-actions">
              <span>960 × 540</span>
              <button type="button" onClick={() => setPreviewKey((value) => value + 1)} aria-label="重新加载游戏预览">↻</button>
              <a href={previewUrl} target="_blank" rel={previewWindowRel} aria-label="在新窗口打开游戏预览">↗</a>
            </div>
          </div>

          <div className="stage-content">
            {activeStage === "preview" ? (
              <div className="preview-frame-wrap">
                <div className="preview-frame-header">
                  <span><i /> {previewHost}</span>
                  <span>Phaser Preview</span>
                </div>
                <iframe
                  key={previewKey}
                  className="game-frame"
                  src={previewUrl}
                  title="生成游戏预览"
                  {...previewFramePolicy}
                />
                <div className="preview-help">
                  {!previewAllowed ? (
                    <>运行事件中的预览 origin 未获授权，已回退到本地预览。配置 <code>VITE_GAME_PREVIEW_ORIGINS</code> 后重试。</>
                  ) : runState.preview === null ? (
                    <>请同时运行 <code>bun run dev:game</code>；等待 CodeArts 发布运行预览。</>
                  ) : (
                    <>运行产物 <code>{runState.preview.projectId}</code> · URL 已通过安全契约校验</>
                  )}
                </div>
              </div>
            ) : runState.spec === null ? (
              <div className="empty-editor">
                <span>{activeStage === "scene" ? "SCENE" : "MAP"}</span>
                <h2>等待结构化 GameSpec</h2>
                <p>收到 <code>spec.ready</code> 后显示确定性设计视图。</p>
              </div>
            ) : activeStage === "scene" ? (
              <div className="scene-editor" aria-label="游戏场景结构">
                <header><span>SCENE GRAPH</span><strong>{runState.spec.title}</strong><em>只读 · 来自运行事件</em></header>
                <ol className="scene-tree">
                  {sceneNodes.map((node) => (
                    <li className={`depth-${node.depth} ${node.state}`} key={node.id}>
                      <i aria-hidden="true" />
                      <div><strong>{node.label}</strong><span>{node.detail}</span></div>
                      <em>{node.state === "bound" ? "已绑定" : node.state === "fallback" ? "回退" : "运行时"}</em>
                    </li>
                  ))}
                </ol>
              </div>
            ) : mapView !== null ? (
              <div className="map-editor" aria-label="游戏模板地图视图">
                <header><div><span>LAYOUT BLUEPRINT</span><strong>{mapView.label}</strong></div><em>模板示意 · 非关卡文件</em></header>
                <div className="map-grid" style={{ gridTemplateColumns: `repeat(${mapView.columns}, 1fr)` }}>
                  {mapView.cells.map((cell, index) => (
                    <span
                      className={`map-cell ${cell.kind}`}
                      style={{ gridColumn: cell.column + 1, gridRow: cell.row + 1 }}
                      key={`${cell.kind}:${cell.column}:${cell.row}:${index}`}
                      title={cell.kind}
                    />
                  ))}
                </div>
                <div className="map-legend"><span className="player">玩家</span><span className="collectible">收集物</span><span className="hazard">危险物</span><span className="goal">目标</span><span className="platform">平台</span></div>
                <p>{runState.spec.objective}</p>
              </div>
            ) : null}
          </div>
        </section>

        <aside className="panel timeline-panel">
          <div className="timeline-header">
            <div><span className="eyebrow">AGENT RUN</span><strong>{statusLabels[runState.status]}</strong></div>
            <span className={`run-status ${runState.status}`}>{runState.runId ?? "NO RUN"}</span>
          </div>
          <div className="progress-track"><span style={{ width: `${progress}%` }} /></div>
          <div className="progress-caption"><span>阶段进度</span><strong>{progress}%</strong></div>

          {runState.verification !== null && (
            <section className={`verification-card ${runState.verification.passed ? "passed" : "failed"}`} aria-label="浏览器验收报告">
              <header><span>BROWSER PROOF</span><strong>{runState.verification.passed ? "验收通过" : "验收失败"}</strong></header>
              <div className="verification-outcome"><b>{runState.verification.outcome.toUpperCase()}</b><span>{runState.verification.canvas.width} × {runState.verification.canvas.height}</span></div>
              <dl>
                <div><dt>分数</dt><dd>{runState.verification.score}</dd></div>
                <div><dt>生命</dt><dd>{runState.verification.lives}</dd></div>
                <div><dt>剩余</dt><dd>{Math.round(runState.verification.remainingSeconds)}s</dd></div>
                <div><dt>诊断</dt><dd>{runState.verification.diagnostics.consoleErrors + runState.verification.diagnostics.pageErrors + runState.verification.diagnostics.failedRequests}</dd></div>
              </dl>
              <code title={runState.verification.evidencePath}>{runState.verification.evidencePath}</code>
              <small>{runState.verification.actionsExecuted} 个动作 · {runState.verification.durationMs} ms</small>
            </section>
          )}

          <ol className="timeline-list">
            {runState.phases.map((phase, index) => (
              <li className={phase.status} key={phase.id}>
                <div className="phase-index">{phase.status === "succeeded" ? "✓" : index + 1}</div>
                <div className="phase-copy"><strong>{phase.label}</strong><span>{phase.detail}</span></div>
                <div className="phase-meta"><em>{phaseStatusLabels[phase.status]}</em>{phase.attempt > 1 && <small>尝试 {phase.attempt}</small>}</div>
              </li>
            ))}
          </ol>
        </aside>

        <section className="panel log-panel">
          <div className="log-toolbar">
            <div><strong>运行输出</strong><span>{runState.logs.length} 条事件</span></div>
            <div className="log-legend"><span className="success">● 通过</span><span className="warning">● 修复</span><span>● 信息</span></div>
          </div>
          <div className="log-stream" aria-live="polite">
            {runState.logs.length === 0 ? (
              <div className="empty-log">运行事件将在这里按真实序列号显示。</div>
            ) : runState.logs.map((log) => (
              <div className={`log-line ${log.level}`} key={log.id}>
                <span>{String(log.sequence).padStart(3, "0")}</span>
                <em>{log.source.toUpperCase()}</em>
                <p>{log.message}</p>
              </div>
            ))}
          </div>
        </section>
      </section>
    </main>
  );
}
