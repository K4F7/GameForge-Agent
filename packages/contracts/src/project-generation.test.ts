import { describe, expect, it } from "vitest";
import {
  gamePlatformTargetSchema,
  generatedProjectFileSchema,
  projectGenerationRequestSchema,
} from "./project-generation.js";

const spec = {
  title: "Safety Sprint",
  genre: "arcade",
  objective: "Collect all equipment before the timer expires.",
  controls: ["Arrow keys"],
  winCondition: "Collect all equipment.",
  loseCondition: "The timer reaches zero.",
  targetDurationSeconds: 90,
};
const identity = {
  attemptId: "attempt-00000000-0000-4000-8000-000000000064",
  revisionId: "revision-00000000-0000-4000-8000-000000000064",
  acceptanceContractFingerprint: "a".repeat(64),
};

describe("project generation contracts", () => {
  it("defaults to a dry run", () => {
    expect(projectGenerationRequestSchema.parse({ projectId: "safety-sprint", spec, ...identity })).toMatchObject({
      projectId: "safety-sprint",
      mode: "dry-run",
      operation: "create",
      target: "web",
    });
  });

  it("exposes web as the only supported platform target", () => {
    expect(gamePlatformTargetSchema.options).toEqual(["web"]);
    expect(projectGenerationRequestSchema.parse({ projectId: "safety-sprint", spec, target: "web", ...identity }).target)
      .toBe("web");
    expect(projectGenerationRequestSchema.safeParse({ projectId: "safety-sprint", spec, target: "unknown", ...identity }).success)
      .toBe(false);
  });

  it("accepts an explicit managed update CAS without a force mode", () => {
    expect(projectGenerationRequestSchema.parse({
      projectId: "safety-sprint", spec, operation: "update", mode: "apply", expectedPlanSha256: "a".repeat(64),
      attemptId: "attempt-00000000-0000-4000-8000-000000000064",
      revisionId: "revision-00000000-0000-4000-8000-000000000064",
      acceptanceContractFingerprint: "a".repeat(64),
    })).toMatchObject({ operation: "update", expectedPlanSha256: "a".repeat(64) });
    expect(projectGenerationRequestSchema.safeParse({
      projectId: "safety-sprint", spec, mode: "apply",
    }).success).toBe(false);
    expect(projectGenerationRequestSchema.safeParse({
      projectId: "safety-sprint", spec, operation: "update", force: true,
    }).success).toBe(false);
  });

  it("rejects path traversal and unknown GameSpec fields", () => {
    expect(projectGenerationRequestSchema.safeParse({ projectId: "../outside", spec, ...identity }).success).toBe(false);
    expect(projectGenerationRequestSchema.safeParse({
      projectId: "safety-sprint",
      spec: { ...spec, sourceCode: "do not execute" },
      ...identity,
    }).success).toBe(false);
  });

  it("allows only the generated npm registry dotfile", () => {
    const base = { bytes: 42, sha256: "a".repeat(64) };
    expect(generatedProjectFileSchema.safeParse({ ...base, path: ".npmrc" }).success).toBe(true);
    expect(generatedProjectFileSchema.safeParse({ ...base, path: ".env" }).success).toBe(false);
    expect(generatedProjectFileSchema.safeParse({ ...base, path: ".npmrc/evil" }).success).toBe(false);
  });
});
