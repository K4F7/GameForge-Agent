import { describe, expect, it } from "vitest";
import { evaluatePreflight } from "./preflight.js";

describe("evaluatePreflight", () => {
  it("names a runnable command for each unavailable dependency", () => {
    const report = evaluatePreflight([
      { dependency: "authority-relay", available: false, detail: "127.0.0.1:8787 is not listening" },
      { dependency: "openchamber-build", available: false },
      { dependency: "openchamber-service", available: true },
      { dependency: "codearts", available: true },
    ]);

    expect(report.ready).toBe(false);
    expect(report.blocking).toEqual(["authority-relay", "openchamber-build"]);
    expect(entry(report, "authority-relay").remediation).toBe("bun run testenv:up");
    expect(entry(report, "authority-relay").detail).toBe("127.0.0.1:8787 is not listening");
    expect(entry(report, "openchamber-build").remediation).toBe("bun --cwd vendor/openchamber run build:web");
    expect(entry(report, "openchamber-service").remediation).toBeUndefined();
  });
});

function entry(report: ReturnType<typeof evaluatePreflight>, dependency: string) {
  const found = report.entries.find((candidate) => candidate.dependency === dependency);
  if (found === undefined) throw new Error(`Preflight report is missing ${dependency}.`);
  return found;
}
