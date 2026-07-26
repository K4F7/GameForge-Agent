/**
 * Failure diagnosis: classifies a failed run and points at the evidence files
 * worth opening. Per the context glossary this is navigation over evidence
 * already recorded - it never produces new facts about the run.
 */

export type DiagnosisInput = {
  failure: string;
  /** Paths present in the session directory, relative to the session root. */
  files: readonly string[];
};

export type Diagnosis = {
  category: "environment" | "codearts-startup" | "gui-diagnostics" | "authority-timeout" | "tui-inactivity" | "cleanup" | "unknown";
  likelyCause: string;
  /** Evidence files worth opening, filtered to those that actually exist. */
  evidence: string[];
  nextCommand?: string;
  /** Present when the responsible party is not the harness itself. */
  responsibility?: string;
};

type Rule = {
  category: Diagnosis["category"];
  matches: (failure: string) => boolean;
  likelyCause: string;
  candidateEvidence: string[];
  nextCommand?: string;
  responsibility?: string;
};

/**
 * Ordered by specificity; the first matching rule wins. The match strings come
 * from failures actually observed in .gameforge-validation history and from
 * the controller's own error messages - not from imagined failure modes.
 */
const RULES: Rule[] = [
  {
    category: "environment",
    matches: (failure) => /^Preflight failed|relay request failed|relay unreachable|fetch failed|ECONNREFUSED/i.test(failure),
    likelyCause: "Authority Relay 未启动或不可达，运行在场景开始前就失败了。",
    candidateEvidence: ["result.json", "metadata.json"],
    nextCommand: "bun run testenv:status",
  },
  {
    category: "codearts-startup",
    matches: (failure) => /before the TUI became ready|TUI readiness timed out|ConPTY could not start CodeArts/i.test(failure),
    likelyCause: "CodeArts 客户端未能就绪：可能未完成安装、授权已过期或启动即退出。先看最终屏幕与 VT 输出确认它停在哪一步。",
    candidateEvidence: ["final-screen.txt", "output.vtlog", "lifecycle.ndjson"],
    nextCommand: "bun run codearts",
  },
  {
    category: "gui-diagnostics",
    matches: (failure) => failure.startsWith("OpenChamber browser diagnostics are not clean"),
    likelyCause: "被测 OpenChamber 页面存在 console error、page error 或 failed request；门禁按约束拒绝放行。",
    candidateEvidence: ["gui/browser-report.ndjson", "gui/failed.png", "gui/success.png"],
    responsibility: "这是被测 OpenChamber 页面的问题，不是 harness 缺陷；逐条核对 browser-report 中的来源 URL 后再决定是否上报上游。",
  },
  {
    category: "authority-timeout",
    matches: (failure) => failure.startsWith("Authority gate timed out"),
    likelyCause: "Relay 在门禁时限内没有给出可接受的 Task/Run 终态；Agent 未完成任务或事件未发布。",
    candidateEvidence: ["authority.ndjson", "run-events.json", "mcp-audit.json", "output.vtlog"],
  },
  {
    category: "tui-inactivity",
    matches: (failure) => failure.startsWith("Activity watchdog timed out"),
    likelyCause: "CodeArts TUI 在活动窗口内没有任何进展：客户端未就绪、授权可能过期，或任务卡死。先看最终屏幕内容。",
    candidateEvidence: ["final-screen.txt", "output.vtlog", "activity.ndjson", "screen-frames.ndjson"],
  },
  {
    category: "cleanup",
    matches: (failure) => /Cleanup failed|cleanup timed out|did not exit within/i.test(failure),
    likelyCause: "场景本身可能已完成，但进程树或窗口清理未收敛；检查残留 PID 与生命周期时间线。",
    candidateEvidence: ["lifecycle.ndjson", "result.json"],
  },
];

const FALLBACK_EVIDENCE = ["lifecycle.ndjson", "output.vtlog", "final-screen.txt", "gui/browser-report.ndjson", "result.json"];

export function diagnose(input: DiagnosisInput): Diagnosis {
  const present = new Set(input.files);
  const rule = RULES.find((candidate) => candidate.matches(input.failure));
  if (rule === undefined) {
    return {
      category: "unknown",
      likelyCause: "失败信息未命中任何已知分类；从生命周期时间线开始排查。",
      evidence: FALLBACK_EVIDENCE.filter((file) => present.has(file)),
    };
  }
  return {
    category: rule.category,
    likelyCause: rule.likelyCause,
    evidence: rule.candidateEvidence.filter((file) => present.has(file)),
    ...(rule.nextCommand === undefined ? {} : { nextCommand: rule.nextCommand }),
    ...(rule.responsibility === undefined ? {} : { responsibility: rule.responsibility }),
  };
}

export function renderDiagnosisMarkdown(options: { failure: string; sessionRoot: string; diagnosis: Diagnosis }): string {
  const { failure, sessionRoot, diagnosis } = options;
  const lines = [
    "# 失败诊断",
    "",
    `- **失败信息**：${failure}`,
    `- **分类**：${diagnosis.category}`,
    `- **最可能原因**：${diagnosis.likelyCause}`,
    ...(diagnosis.responsibility === undefined ? [] : [`- **责任方**：${diagnosis.responsibility}`]),
    "",
    "## 建议打开的证据",
    "",
    ...(diagnosis.evidence.length === 0
      ? [`（本次 session 中没有命中分类的证据文件，直接查看 ${sessionRoot}）`]
      : diagnosis.evidence.map((file) => `- ${sessionRoot}/${file}`)),
    "",
    ...(diagnosis.nextCommand === undefined ? [] : ["## 建议的下一条命令", "", "```", diagnosis.nextCommand, "```", ""]),
  ];
  return `${lines.join("\n")}\n`;
}

export function renderDiagnosisTerminal(options: { failure: string; sessionRoot: string; diagnosis: Diagnosis }): string {
  const { failure, sessionRoot, diagnosis } = options;
  const lines = [
    `失败：${failure}`,
    `分类：${diagnosis.category} — ${diagnosis.likelyCause}`,
    ...(diagnosis.responsibility === undefined ? [] : [`责任方：${diagnosis.responsibility}`]),
    ...(diagnosis.evidence.length === 0
      ? [`证据：${sessionRoot}`]
      : ["证据：", ...diagnosis.evidence.map((file) => `  ${sessionRoot}/${file}`)]),
    ...(diagnosis.nextCommand === undefined ? [] : [`下一步：${diagnosis.nextCommand}`]),
  ];
  return `${lines.join("\n")}\n`;
}
