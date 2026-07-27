import type { HarnessStep, HarnessTier } from "./contracts.js";

/**
 * The two run tiers (ADR-0005). A readiness pass asserts the environment is
 * usable - real CodeArts up to TUI ready, clean GUI diagnostics, a writable
 * Authority - and deliberately never submits a task or waits for authority
 * completion. Only an acceptance pass is an end-to-end verdict.
 */
export type { HarnessTier };

/** Readiness Tasks stay in the relay; the prefix keeps them identifiable and cleanable. */
export const READINESS_PROJECT_PREFIX = "testenv-readiness-";

export function buildScenario(tier: HarnessTier, options: { openChamberUrl: string; instruction: string; agentId: string; totalTimeoutMs: number }): { name: string; steps: HarnessStep[] } {
  if (tier === "readiness") {
    return {
      name: "testenv-readiness:baseline",
      steps: [
        { kind: "gui.navigate", url: options.openChamberUrl },
        // Wait for the app to actually mount before the diagnostics-gated
        // capture: navigation resolves at domcontentloaded, and capturing
        // immediately could green-light the page before its asynchronous
        // initialization requests and console errors have arrived.
        { kind: "gui.wait", selector: "#root > *", options: { state: "visible", timeoutMs: 30_000 } },
        { kind: "capture", label: "readiness" },
      ],
    };
  }
  return {
    name: "codearts-minimal-closure:baseline",
    steps: [
      { kind: "gui.navigate", url: options.openChamberUrl },
      { kind: "tui.text", text: options.instruction, appendEnter: true },
      { kind: "authority.wait", gate: { description: "Task claimed by the configured agent and Task/Run completed", timeoutMs: options.totalTimeoutMs, accepts: (snapshot) => snapshot.claimedBy === options.agentId && snapshot.taskStatus === "completed" && snapshot.runStatus === "completed" } },
      { kind: "gui.press", selector: "body", key: "Escape" },
      { kind: "capture", label: "completed" },
    ],
  };
}

export function tierBanner(tier: HarnessTier): string {
  return tier === "readiness"
    ? "档位：环境就绪检查 — 通过仅表示验收环境可用，不构成对产品行为的验收结论（ADR-0005）。"
    : "档位：真实验收 — 通过表示 Task 与 Run 均由 Authority 判定完成。";
}
