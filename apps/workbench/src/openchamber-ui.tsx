import type { OpenChamberRuntimeView } from "./openchamber-adapter.js";
import {
  appendSpecialistMention,
  extractRequestedSpecialists,
  specialistAgentOptions,
} from "./specialist-agents.js";

type RelayState = "disconnected" | "connecting" | "connected" | "error";

/**
 * Layout concept adapted from OpenChamber's SidebarTopBar at the pinned official
 * commit f9ad0de3e5e7cf281dd4966391409f3e19de4e79. The OpenCode runtime and
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
                <small>
                  {task.specialistMentions.length > 0 && `${task.specialistMentions.join(" ")} · `}
                  {task.projectLabel} · {task.runId}
                </small>
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

export function SpecialistMentionPicker(props: {
  prompt: string;
  disabled: boolean;
  onChange(prompt: string): void;
}): React.JSX.Element {
  const selected = extractRequestedSpecialists(props.prompt);
  return (
    <section className="oc-agent-mentions" aria-label="专业 Agent">
      <header>
        <span>CALL SPECIALIST</span>
        <small>{selected.length === 0 ? "按需点名" : `已点名 ${selected.length} 位`}</small>
      </header>
      <div className="oc-agent-mention-list">
        {specialistAgentOptions.map((option) => {
          const active = selected.includes(option.id);
          return (
            <button
              aria-label={`将 ${option.mention} 添加到游戏需求`}
              aria-pressed={active}
              className={active ? "active" : ""}
              disabled={props.disabled}
              key={option.id}
              onClick={() => props.onChange(appendSpecialistMention(props.prompt, option.id))}
              title={option.description}
              type="button"
            >
              {option.mention}
            </button>
          );
        })}
      </div>
      <p>所有角色共享当前 Task；CodeArts 仍是任务负责人。</p>
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
