import { describe, expect, it } from "vitest";
import { generatedProjectFileSchema, projectGenerationRequestSchema } from "./project-generation.js";

const spec = {
  title: "Safety Sprint",
  genre: "arcade",
  objective: "Collect all equipment before the timer expires.",
  controls: ["Arrow keys"],
  winCondition: "Collect all equipment.",
  loseCondition: "The timer reaches zero.",
  targetDurationSeconds: 90,
};

describe("project generation contracts", () => {
  it("defaults to a dry run", () => {
    expect(projectGenerationRequestSchema.parse({ projectId: "safety-sprint", spec })).toMatchObject({
      projectId: "safety-sprint",
      mode: "dry-run",
    });
  });

  it("rejects path traversal and unknown GameSpec fields", () => {
    expect(projectGenerationRequestSchema.safeParse({ projectId: "../outside", spec }).success).toBe(false);
    expect(projectGenerationRequestSchema.safeParse({
      projectId: "safety-sprint",
      spec: { ...spec, sourceCode: "do not execute" },
    }).success).toBe(false);
  });

  it("allows only the generated npm registry dotfile", () => {
    const base = { bytes: 42, sha256: "a".repeat(64) };
    expect(generatedProjectFileSchema.safeParse({ ...base, path: ".npmrc" }).success).toBe(true);
    expect(generatedProjectFileSchema.safeParse({ ...base, path: ".env" }).success).toBe(false);
    expect(generatedProjectFileSchema.safeParse({ ...base, path: ".npmrc/evil" }).success).toBe(false);
  });
});
