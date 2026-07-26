import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { evaluatePreflight, type PreflightDependency } from "./preflight.js";

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
    expect(entry(report, "openchamber-build").remediation).toContain("bun --cwd vendor/openchamber run build:web");
    expect(entry(report, "openchamber-service").remediation).toBeUndefined();
  });

  it("directs an operator to the CodeArts executable override when discovery fails", () => {
    const report = evaluatePreflight([
      { dependency: "codearts", available: false, detail: "No CodeArts client was found" },
    ]);

    expect(entry(report, "codearts").remediation).toContain("CODEARTS_BIN");
    expect(entry(report, "codearts").remediation).not.toContain("bun run codearts");
  });


  it("only names repository scripts that actually exist", async () => {
    const manifest = JSON.parse(await readFile(path.resolve(import.meta.dirname, "..", "..", "..", "package.json"), "utf8")) as { scripts: Record<string, string> };
    const dependencies: PreflightDependency[] = ["authority-relay", "openchamber-service", "openchamber-build", "codearts"];

    for (const dependency of dependencies) {
      const report = evaluatePreflight([{ dependency, available: false }]);
      const remediation = entry(report, dependency).remediation;
      expect(remediation, `${dependency} has no remediation`).toBeDefined();
      for (const script of [...remediation!.matchAll(/(?:^|&&\s*)bun run ([\w:-]+)/g)].map((match) => match[1]!)) {
        expect(Object.keys(manifest.scripts), `${dependency} names missing root script ${script}`).toContain(script);
      }
    }
  });
});

function entry(report: ReturnType<typeof evaluatePreflight>, dependency: string) {
  const found = report.entries.find((candidate) => candidate.dependency === dependency);
  if (found === undefined) throw new Error(`Preflight report is missing ${dependency}.`);
  return found;
}
