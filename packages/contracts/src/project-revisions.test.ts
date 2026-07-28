import { describe, expect, it } from "vitest";
import {
  candidateRevisionSchema,
  createCandidateRevisionInputSchema,
  createProjectInputSchema,
  projectSchema,
} from "./index.js";

describe("Project contracts", () => {
  it("parses a Project with no accepted Revision", () => {
    expect(createProjectInputSchema.parse({})).toEqual({});
    expect(projectSchema.parse({
      projectId: "project-11111111-1111-4111-8111-111111111111",
      currentRevisionId: null,
    })).toEqual({
      projectId: "project-11111111-1111-4111-8111-111111111111",
      currentRevisionId: null,
    });
  });

  it("rejects unknown input and malformed output", () => {
    expect(() => createProjectInputSchema.parse({ projectId: "caller-owned" })).toThrow();
    expect(() => projectSchema.parse({
      projectId: "project-11111111-1111-4111-8111-111111111111",
      currentRevisionId: null,
      unexpected: true,
    })).toThrow();
    expect(() => projectSchema.parse({
      projectId: "INVALID!",
      currentRevisionId: null,
    })).toThrow();
  });
});

describe("candidate Revision contracts", () => {
  it("parses an immutable candidate with its own identity", () => {
    expect(createCandidateRevisionInputSchema.parse({
      projectId: "stable-project",
      taskId: "task-00000000-0000-0000-0000-000000000000",
    })).toEqual({
      projectId: "stable-project",
      taskId: "task-00000000-0000-0000-0000-000000000000",
    });

    const revision = candidateRevisionSchema.parse({
      projectId: "stable-project",
      taskId: "task-00000000-0000-0000-0000-000000000000",
      revisionId: "revision-22222222-2222-4222-8222-222222222222",
      state: "candidate",
      acceptanceContractFingerprint: "a".repeat(64),
    });
    expect(revision).toEqual({
      projectId: "stable-project",
      taskId: "task-00000000-0000-0000-0000-000000000000",
      revisionId: "revision-22222222-2222-4222-8222-222222222222",
      state: "candidate",
      acceptanceContractFingerprint: "a".repeat(64),
    });
    expect(Object.isFrozen(revision)).toBe(true);
  });

  it("rejects unknown input and invalid candidate output", () => {
    expect(() => createCandidateRevisionInputSchema.parse({
      projectId: "stable-project",
      baseRevisionId: "revision-22222222-2222-4222-8222-222222222222",
    })).toThrow();
    expect(() => candidateRevisionSchema.parse({
      projectId: "stable-project",
      taskId: "task-00000000-0000-0000-0000-000000000000",
      revisionId: "revision-22222222-2222-4222-8222-222222222222",
      state: "accepted",
      acceptanceContractFingerprint: "a".repeat(64),
    })).toThrow();
    expect(() => candidateRevisionSchema.parse({
      projectId: "stable-project",
      taskId: "task-00000000-0000-0000-0000-000000000000",
      revisionId: "revision-------------------------------------",
      state: "candidate",
      acceptanceContractFingerprint: "a".repeat(64),
    })).toThrow();
  });
});
