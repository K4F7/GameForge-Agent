import { describe, expect, it } from "vitest";
import type { ActivitySample } from "./contracts.js";
import { compareActivity, inactiveForMs } from "./watchdog.js";

describe("activity watchdog", () => {
  it("recognizes activity from TUI, authority and project changes", () => {
    const previous: ActivitySample = { sampledAt: "2026-07-22T00:00:00.000Z", tuiOutputSequence: 1, authorityEventSequence: 2, projectFingerprint: "a" };
    const current: ActivitySample = { sampledAt: "2026-07-22T00:00:01.000Z", tuiOutputSequence: 2, authorityEventSequence: 3, projectFingerprint: "b" };
    expect(compareActivity(previous, current)).toEqual({ active: true, reasons: ["tui-output", "authority-event", "project-change"] });
  });

  it("clamps negative inactivity durations", () => {
    expect(inactiveForMs(20, 10)).toBe(0);
  });
});
