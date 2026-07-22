import type { ActivitySample } from "./contracts.js";

export type ActivityDecision = {
  active: boolean;
  reasons: readonly string[];
};

export function compareActivity(previous: ActivitySample, current: ActivitySample): ActivityDecision {
  const reasons: string[] = [];
  if (current.tuiOutputSequence > previous.tuiOutputSequence) reasons.push("tui-output");
  if (current.authorityEventSequence > previous.authorityEventSequence) reasons.push("authority-event");
  if (current.projectFingerprint !== previous.projectFingerprint) reasons.push("project-change");
  return { active: reasons.length > 0, reasons };
}

export function inactiveForMs(lastActivityAt: number, now: number): number {
  return Math.max(0, now - lastActivityAt);
}
