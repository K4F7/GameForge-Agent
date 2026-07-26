import type { PhaseTiming } from "./contracts.js";

/**
 * Renders per-phase durations with a cumulative column, and warns - without
 * failing - when the total crosses the soft budget. "Which phase is slow" and
 * "which phase broke" are the same question, so this shares the phase list the
 * diagnosis path reads.
 */
export function renderPhaseTimings(phases: readonly PhaseTiming[], softBudgetMs: number): string {
  let cumulative = 0;
  const rows = phases.map((phase) => {
    cumulative += phase.durationMs;
    return `  ${phase.label.padEnd(16)} ${seconds(phase.durationMs).padStart(7)}   (${seconds(cumulative)})`;
  });
  const total = cumulative;
  const summary = total > softBudgetMs
    ? `总耗时 ${seconds(total)}，超出软预算 ${seconds(softBudgetMs)}（仅警告，不失败）`
    : `总耗时 ${seconds(total)}，软预算 ${seconds(softBudgetMs)}`;
  return `阶段耗时：\n${rows.join("\n")}\n${summary}\n`;
}

function seconds(ms: number): string { return `${(ms / 1_000).toFixed(1)}s`; }
