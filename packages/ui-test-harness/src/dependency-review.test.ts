import { describe, expect, it } from "vitest";
import { verifyHarnessDependencyReview } from "./dependency-review.js";

describe("UI harness dependency review", () => {
  it("verifies pinned versions, licenses, and runtime dependency closure", async () => {
    await expect(verifyHarnessDependencyReview()).resolves.toEqual({ verified: 4 });
  });
});
