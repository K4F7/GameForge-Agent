import { describe, expect, it } from "vitest";
import { renderPhaseTimings } from "./timing.js";

describe("renderPhaseTimings", () => {
  it("lists each phase and stays quiet inside the soft budget", () => {
    const output = renderPhaseTimings([
      { label: "tui.start", durationMs: 8_000 },
      { label: "steps", durationMs: 30_000 },
    ], 60_000);

    expect(output).toContain("tui.start");
    expect(output).toContain("8.0s");
    expect(output).toContain("38.0s");
    expect(output).not.toContain("超出");
  });

  it("warns without failing when the total exceeds the soft budget", () => {
    const output = renderPhaseTimings([
      { label: "tui.start", durationMs: 50_000 },
      { label: "steps", durationMs: 20_000 },
    ], 60_000);

    expect(output).toContain("超出");
    expect(output).toContain("60");
  });
});
