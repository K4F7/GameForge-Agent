import type { BenchmarkDefinition, BenchmarkRecord } from "./schema.js";
import { fingerprintDefinition, hasSuccessfulWorkflowEvidence } from "./schema.js";

export type BenchmarkComparison = {
  comparableTask: boolean;
  workflowComparable: boolean;
  reason: string;
  records: BenchmarkRecord[];
};

export function compareRecords(definition: BenchmarkDefinition, records: readonly BenchmarkRecord[]): BenchmarkComparison {
  if (records.length < 2) throw new Error("At least two benchmark records are required.");
  const fingerprint = fingerprintDefinition(definition);
  const comparableTask = records.every((record) =>
    record.benchmarkId === definition.benchmarkId && record.definitionFingerprint === fingerprint);
  const successful = records.filter((record) => record.terminalStatus === "completed" &&
    record.failure === "none" && workflowEvidenceMatches(definition, record));
  const workflowComparable = comparableTask && successful.length === records.length;
  const reason = !comparableTask
    ? "记录未使用相同的规范化任务定义。"
    : workflowComparable
      ? "所有客户端都完成了同一基准，可以比较工作流结果。"
      : "任务定义相同，但至少一个客户端未完成；只能比较启动与失败边界，不能比较工作流质量。";
  return { comparableTask, workflowComparable, reason, records: [...records] };
}

export function formatComparison(definition: BenchmarkDefinition, comparison: BenchmarkComparison): string {
  const lines = [
    `# ${definition.benchmarkId} 客户端基准报告`,
    "",
    `- 同一任务定义：${comparison.comparableTask ? "是" : "否"}`,
    `- 工作流质量可比较：${comparison.workflowComparable ? "是" : "否"}`,
    `- 结论：${comparison.reason}`,
    "",
    "| Client | Version | Model | Status | Events | Tools | Errors | Human | Failure | Proof |",
    "|---|---|---|---:|---:|---:|---:|---:|---|---|",
  ];
  for (const record of comparison.records) {
    const proof = record.verification === undefined
      ? "—"
      : `browser:${record.verification.outcome}/${record.verification.passed ? "pass" : "fail"}`;
    lines.push(`| ${record.client.name} | ${cell(record.client.version)} | ${cell(record.client.model ?? "—")} | ${record.terminalStatus} | ${record.events.count} | ${record.tools.count ?? "unknown"} | ${record.tools.errors ?? "unknown"} | ${record.humanInterventions.length} | ${record.failure} | ${proof} |`);
  }
  lines.push("", "不同 Task ID/Run ID 是预期行为；`definitionFingerprint` 才是同任务判据。凭据、会话正文和完整本地日志不属于基准记录。", "");
  return lines.join("\n");
}

function workflowEvidenceMatches(definition: BenchmarkDefinition, record: BenchmarkRecord): boolean {
  if (!hasSuccessfulWorkflowEvidence(record)) return false;
  return (definition.target.platform === undefined || definition.target.platform === "web") &&
    record.verification?.passed === true;
}

function cell(value: string): string {
  return value.replaceAll("|", "\\|").replace(/[\r\n]+/g, " ");
}
