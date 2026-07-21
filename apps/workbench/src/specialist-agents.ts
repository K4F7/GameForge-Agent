import type { GameTaskSpecialist } from "@gameforge/contracts";

export type SpecialistAgentOption = {
  id: GameTaskSpecialist;
  mention: `@${string}`;
  label: string;
  description: string;
};

export const specialistAgentOptions = [
  { id: "planner", mention: "@策划", label: "策划", description: "收敛玩法、规则、数值和 GameSpec。" },
  { id: "programmer", mention: "@程序员", label: "程序员", description: "实现功能、修复代码并运行工程验证。" },
  { id: "artist", mention: "@美术", label: "美术", description: "分析或生成候选视觉资产，不直接覆盖权威素材。" },
  { id: "tester", mention: "@测试", label: "测试", description: "复现问题、检查证据并执行独立复验。" },
] as const satisfies ReadonlyArray<SpecialistAgentOption>;

export function extractRequestedSpecialists(prompt: string): GameTaskSpecialist[] {
  return specialistAgentOptions
    .filter((option) => mentionPattern(option.mention).test(prompt))
    .map((option) => option.id);
}

export function appendSpecialistMention(prompt: string, specialist: GameTaskSpecialist): string {
  const option = specialistAgentOptions.find((candidate) => candidate.id === specialist);
  if (option === undefined || extractRequestedSpecialists(prompt).includes(specialist)) return prompt;
  const base = prompt.trimEnd();
  return `${base}${base === "" ? "" : " "}${option.mention} `;
}

export function specialistMentionLabels(specialists: ReadonlyArray<GameTaskSpecialist>): string[] {
  return specialistAgentOptions
    .filter((option) => specialists.includes(option.id))
    .map((option) => option.mention);
}

function mentionPattern(mention: string): RegExp {
  const escaped = mention.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`${escaped}(?=$|[\\s，。！？、,:：；;])`, "u");
}
