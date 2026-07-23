import { describe, expect, it } from "vitest";
import { assertExactDependencyCoverage, verifyHarnessDependencyReview } from "./dependency-review.js";

describe("UI harness dependency review", () => {
  it("verifies pinned versions, licenses, and runtime dependency closure", async () => {
    await expect(verifyHarnessDependencyReview()).resolves.toEqual({ verified: 4 });
  });

  it("rejects duplicate reviewed dependency names", () => {
    expect(() => assertExactDependencyCoverage({ dependencies: [
      { name: "playwright-core", version: "1.61.1", license: "Apache-2.0", source: "https://example.test", purpose: "browser", officialGap: "gap", transitiveRuntimeDependencies: [] },
      { name: "playwright-core", version: "1.61.1", license: "Apache-2.0", source: "https://example.test", purpose: "browser", officialGap: "gap", transitiveRuntimeDependencies: [] },
      { name: "bun-pty", version: "0.4.10", license: "MIT", source: "https://example.test", purpose: "pty", officialGap: "gap", transitiveRuntimeDependencies: [] },
    ] }, { "playwright-core": "1.61.1", "bun-pty": "0.4.10" })).toThrow("exactly once");
  });
});
