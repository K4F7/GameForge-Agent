import { describe, expect, it } from "vitest";
import { READINESS_PROJECT_PREFIX, buildScenario, tierBanner } from "./tiers.js";

describe("buildScenario", () => {
  it("keeps the acceptance scenario exactly as the existing closure", () => {
    const scenario = buildScenario("acceptance", { openChamberUrl: "http://127.0.0.1:43163/", instruction: "run the task", totalTimeoutMs: 900_000 });

    expect(scenario.name).toBe("codearts-minimal-closure:baseline");
    expect(scenario.steps.map((step) => step.kind)).toEqual(["gui.navigate", "tui.text", "authority.wait", "gui.press", "capture"]);
  });

  it("builds a readiness scenario that never submits a task or waits for authority completion", () => {
    const scenario = buildScenario("readiness", { openChamberUrl: "http://127.0.0.1:43163/", instruction: "run the task", totalTimeoutMs: 900_000 });

    expect(scenario.name).toBe("testenv-readiness:baseline");
    const kinds = scenario.steps.map((step) => step.kind);
    expect(kinds).not.toContain("tui.text");
    expect(kinds).not.toContain("authority.wait");
    expect(kinds).toContain("gui.navigate");
    expect(kinds).toContain("capture");
  });
});

describe("tier labelling", () => {
  it("marks the readiness tier as not an acceptance verdict", () => {
    expect(tierBanner("readiness")).toContain("环境就绪检查");
    expect(tierBanner("readiness")).toContain("不构成");
    expect(tierBanner("acceptance")).toContain("真实验收");
  });

  it("prefixes readiness projects so their tasks stay identifiable in the relay", () => {
    expect(READINESS_PROJECT_PREFIX).toBe("testenv-readiness-");
  });
});
