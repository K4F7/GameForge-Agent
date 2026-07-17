import { describe, expect, it } from "vitest";
import { parseArgs } from "./args.js";

describe("TUI arguments", () => {
  it("parses a bilingual task submission", () => {
    expect(parseArgs([
      "submit", "--run-id", "run-1", "--prompt", "Create a complete browser safety game.", "--language", "en-US",
      "--project-id", "safety-game",
    ])).toMatchObject({ command: "submit", runId: "run-1", language: "en-US", projectId: "safety-game" });
  });

  it("supports positional IDs and bounded list filters", () => {
    expect(parseArgs(["list", "--status", "queued", "--limit", "5"]))
      .toMatchObject({ command: "list", status: "queued", limit: 5 });
    expect(parseArgs(["run", "run-1", "--after", "4"]))
      .toMatchObject({ command: "run", runId: "run-1", after: 4 });
  });

  it("rejects unknown and malformed input", () => {
    expect(() => parseArgs(["unknown"])).toThrow("Unknown command");
    expect(() => parseArgs(["submit", "--run-id", "run-1"])).toThrow("requires");
    expect(() => parseArgs(["list", "--limit", "0"])).toThrow("between");
    expect(() => parseArgs(["watch", "run-1", "--after", "-1"])).toThrow("integer");
    expect(() => parseArgs(["submit", "--project-id"])).toThrow("Missing value");
  });
});
