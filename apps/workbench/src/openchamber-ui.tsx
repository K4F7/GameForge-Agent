import type { OpenChamberRuntimeView } from "./openchamber-adapter.js";

type RelayState = "disconnected" | "connecting" | "connected" | "error";

/**
 * Layout concept adapted from OpenChamber's SidebarTopBar at commit
 * 31b43fbde90d368c5d131ec52e761d888466d597. The OpenCode runtime and
 * privileged desktop regions are intentionally replaced by GameForge Relay data.
 */
export function OpenChamberRuntimeBrand(props: {
  relayState: RelayState;
  runtime: OpenChamberRuntimeView;
}): React.JSX.Element {
  return (
    <div className="oc-runtime-brand">
      <span className="oc-brand-mark" aria-hidden="true">GF</span>
      <div className="oc-brand-copy">
        <strong>GameForge</strong>
        <span>OPENCHAMBER · RELAY</span>
      </div>
      <div className="oc-runtime-metrics" aria-label="GameForge Runtime 摘要">
        <span className={`oc-connection-dot ${props.relayState}`} aria-hidden="true" />
        <small>{props.runtime.tasks.length} TASKS</small>
        <small>{props.runtime.evidenceCount} PROOFS</small>
      </div>
    </div>
  );
}

export function TaskRunNavigator(props: {
  tasks: OpenChamberRuntimeView["tasks"];
  disabled: boolean;
  onSelect(taskId: string): void;
}): React.JSX.Element {
  return (
    <section className="oc-task-navigator" aria-label="Task 和 Run 导航">
      <header>
        <span>TASK / RUNS</span>
        <small>GAMEFORGE RELAY</small>
      </header>
      {props.tasks.length === 0 ? (
        <div className="oc-task-empty">刷新历史后，这里会显示 Relay 中的 Task 与 Run。</div>
      ) : (
        <div className="oc-task-list" role="listbox" aria-label="Task 历史（最近 20 项）">
          {props.tasks.map((task) => (
            <button
              aria-selected={task.selected}
              className={`oc-task-item ${task.selected ? "selected" : ""}`}
              disabled={props.disabled}
              key={task.taskId}
              onClick={() => props.onSelect(task.taskId)}
              role="option"
              type="button"
            >
              <span className={`oc-task-status ${task.status}`} aria-hidden="true" />
              <span className="oc-task-copy">
                <strong>{task.title}</strong>
                <small>{task.projectLabel} · {task.runId}</small>
              </span>
              <span className="oc-task-meta">
                <em>{task.statusLabel}</em>
                <time dateTime={task.createdAt}>{formatTaskTime(task.createdAt)}</time>
              </span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

export function OpenChamberContextPanel(props: {
  context: OpenChamberRuntimeView["context"];
}): React.JSX.Element {
  const { project, manifest, audit } = props.context;
  const hiddenAuditCalls = audit === null ? 0 : Math.max(0, audit.totalCalls - Math.min(6, audit.calls.length));
  return (
    <section className="oc-context-panel" aria-label="GameForge 项目上下文">
      <header><span>PROJECT CONTEXT</span><small>RELAY PROJECTION</small></header>

      <article className="oc-context-card">
        <div className="oc-context-title"><strong>MANIFEST / PLAN</strong><span>{project === null ? "等待" : project.mode}</span></div>
        {project === null ? (
          <p>发布 <code>project.generated</code> 后显示生成计划与受管文件。</p>
        ) : (
          <>
            <div className="oc-context-summary"><b>{project.projectId}</b><span>{project.target} · v{project.generatorVersion}</span></div>
            <dl>
              <div><dt>文件</dt><dd>{project.files.length}</dd></div>
              <div><dt>总量</dt><dd>{formatBytes(project.totalBytes)}</dd></div>
              <div><dt>操作</dt><dd>{project.operation}</dd></div>
            </dl>
            <ul>{project.files.slice(0, 6).map((file) => <li key={file.path}><code>{file.path}</code><span>{formatBytes(file.bytes)}</span></li>)}</ul>
            {project.files.length > 6 && <small>另有 {project.files.length - 6} 个受管文件</small>}
            <code className="oc-context-hash" title={project.planSha256}>{project.planSha256}</code>
          </>
        )}
      </article>

      <article className="oc-context-card">
        <div className="oc-context-title"><strong>ASSET MANIFEST</strong><span>r{manifest.revision}</span></div>
        {manifest.assets.length === 0 ? <p>尚未收到 <code>asset.ready</code>。</p> : (
          <ul>{manifest.assets.slice(0, 6).map((asset) => <li key={asset.assetId}><code>{asset.path}</code><span>{asset.kind} · {asset.origin}</span></li>)}</ul>
        )}
      </article>

      {project?.update !== null && project?.update !== undefined && (
        <article className={`oc-context-card ${project.update.conflicts > 0 ? "warning" : ""}`}>
          <div className="oc-context-title"><strong>UPDATE DIFF</strong><span>{project.update.conflicts > 0 ? "冲突" : "安全"}</span></div>
          <dl>
            <div><dt>更新</dt><dd>{project.update.updated}</dd></div>
            <div><dt>保留</dt><dd>{project.update.preserved}</dd></div>
            <div><dt>删除</dt><dd>{project.update.deleted}</dd></div>
            <div><dt>冲突</dt><dd>{project.update.conflicts}</dd></div>
          </dl>
          <small>{project.update.unchanged} 个文件未变化</small>
        </article>
      )}

      <article className="oc-context-card">
        <div className="oc-context-title"><strong>MCP AUDIT</strong><span>{audit === null ? "等待" : `${audit.totalCalls} CALLS`}</span></div>
        {audit === null ? <p>调用 <code>get_mcp_audit_summary</code> 并发布返回事件后显示脱敏审计。</p> : (
          <>
            <ol className="oc-audit-list">{audit.calls.slice(-6).map((call) => (
              <li className={call.outcome} key={call.sequence}><span>{call.sequence}</span><code>{call.tool}</code><em>{call.durationMs} ms</em></li>
            ))}</ol>
            {(audit.truncated || hiddenAuditCalls > 0) && (
              <small>仅显示最近 6 条{hiddenAuditCalls > 0 ? `，另有 ${hiddenAuditCalls} 条` : ""}；原始参数与结果从未进入投影。</small>
            )}
          </>
        )}
      </article>
    </section>
  );
}

function formatTaskTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "--:--";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MiB`;
}
