import { describe, expect, it } from "vitest";
import { diagnose, renderDiagnosisMarkdown } from "./diagnosis.js";

describe("diagnose", () => {
  it("points a relay failure at the environment and the preflight command", () => {
    const diagnosis = diagnose({
      failure: "Run relay request failed.",
      files: ["result.json", "metadata.json", "gui", "mcp-audit.json"],
    });

    expect(diagnosis.category).toBe("environment");
    expect(diagnosis.nextCommand).toBe("bun run testenv:status");
    expect(diagnosis.likelyCause).toContain("Relay");
  });

  it("does not blame Relay for an unscoped browser-helper fetch failure", () => {
    const diagnosis = diagnose({ failure: "fetch failed", files: ["gui/browser-report.ndjson", "result.json"] });

    expect(diagnosis.category).toBe("unknown");
    expect(diagnosis.likelyCause).not.toContain("Relay");
  });

  it("classifies a preflight failure as environment", () => {
    const diagnosis = diagnose({
      failure: "Preflight failed: authority-relay (fix: bun run testenv:up)",
      files: ["result.json", "metadata.json"],
    });

    expect(diagnosis.category).toBe("environment");
    expect(diagnosis.nextCommand).toBe("bun run testenv:status");
  });

  it("names the dependency that actually failed preflight, not always the relay", () => {
    const diagnosis = diagnose({
      failure: "Preflight failed: codearts (fix: bun run codearts)",
      files: ["result.json"],
    });

    expect(diagnosis.category).toBe("environment");
    expect(diagnosis.likelyCause).toContain("codearts");
    expect(diagnosis.likelyCause).not.toContain("Relay");
  });

  it("attributes dirty browser diagnostics to the page under test, not the harness", () => {
    const diagnosis = diagnose({
      failure: "OpenChamber browser diagnostics are not clean: 4 issue(s)",
      // Screenshots are written as gui/<timestamp>-<label>.png.
      files: ["result.json", "gui/browser-report.ndjson", "gui/1753500000000-failed.png", "output.vtlog"],
    });

    expect(diagnosis.category).toBe("gui-diagnostics");
    expect(diagnosis.evidence).toContain("gui/browser-report.ndjson");
    expect(diagnosis.evidence).toContain("gui/1753500000000-failed.png");
    expect(diagnosis.responsibility).toContain("OpenChamber");
  });

  it("points an authority timeout at the authority trail", () => {
    const diagnosis = diagnose({
      failure: "Authority gate timed out: Task and Run completed",
      files: ["result.json", "authority.ndjson", "run-events.json", "mcp-audit.json", "output.vtlog"],
    });

    expect(diagnosis.category).toBe("authority-timeout");
    expect(diagnosis.evidence).toEqual(expect.arrayContaining(["authority.ndjson", "run-events.json", "mcp-audit.json"]));
  });

  it("points TUI inactivity at the screen evidence and names expired authorization as a candidate", () => {
    const diagnosis = diagnose({
      failure: "Activity watchdog timed out while waiting for: Task and Run completed",
      files: ["result.json", "output.vtlog", "final-screen.txt", "activity.ndjson"],
    });

    expect(diagnosis.category).toBe("tui-inactivity");
    expect(diagnosis.evidence).toEqual(expect.arrayContaining(["final-screen.txt", "output.vtlog"]));
    expect(diagnosis.likelyCause).toMatch(/授权|就绪/);
  });

  it("classifies a CodeArts startup failure and names expired authorization as a candidate", () => {
    const diagnosis = diagnose({
      failure: "CodeArts exited before the TUI became ready.",
      files: ["result.json", "output.vtlog", "final-screen.txt"],
    });

    expect(diagnosis.category).toBe("codearts-startup");
    expect(diagnosis.likelyCause).toMatch(/授权|就绪/);
    expect(diagnosis.evidence).toEqual(expect.arrayContaining(["final-screen.txt", "output.vtlog"]));

    const timeout = diagnose({ failure: "CodeArts TUI readiness timed out after 30000 milliseconds.", files: ["output.vtlog"] });
    expect(timeout.category).toBe("codearts-startup");
  });

  it("only lists evidence files that actually exist in the session", () => {
    const diagnosis = diagnose({
      failure: "Authority gate timed out: Task and Run completed",
      files: ["result.json"],
    });

    expect(diagnosis.evidence).toEqual([]);
  });

  it("falls back to an unknown category that still points somewhere", () => {
    const diagnosis = diagnose({
      failure: "something nobody classified",
      files: ["result.json", "lifecycle.ndjson"],
    });

    expect(diagnosis.category).toBe("unknown");
    expect(diagnosis.evidence).toContain("lifecycle.ndjson");
  });
});

describe("renderDiagnosisMarkdown", () => {
  it("renders the failure, category, evidence paths and next command", () => {
    const markdown = renderDiagnosisMarkdown({
      failure: "Run relay request failed.",
      sessionRoot: "D:/evidence/sessions/abc",
      diagnosis: diagnose({ failure: "Run relay request failed.", files: ["result.json"] }),
    });

    expect(markdown).toContain("Run relay request failed.");
    expect(markdown).toContain("environment");
    expect(markdown).toContain("bun run testenv:status");
    expect(markdown).toContain("D:/evidence/sessions/abc");
  });
});
