import { describe, expect, it } from "vitest";
import { ProjectAuthority } from "./server.js";

describe("ProjectAuthority Projects", () => {
  it("creates and reads a stable Project with no current Revision", () => {
    const authority = new ProjectAuthority();

    const created = authority.createProject({});
    expect(created.projectId).toMatch(/^project-[a-f0-9-]{36}$/);
    expect(created.currentRevisionId).toBeNull();
    expect(authority.getProject(created.projectId)).toEqual(created);
    expect(Object.isFrozen(created)).toBe(true);
  });

  it("rejects invalid creation and reads of unknown Projects", () => {
    const authority = new ProjectAuthority();

    expect(() => authority.createProject({ requestedId: "caller-owned" } as never)).toThrow();
    expect(() => authority.getProject("UNKNOWN!")).toThrow();
    expect(() => authority.getProject("missing-project")).toThrow(/Unknown Project/);
  });
});

describe("ProjectAuthority candidate Revisions", () => {
  it("creates and reads an immutable candidate without making it current", () => {
    const authority = new ProjectAuthority();
    const project = authority.createProject({});

    const candidate = authority.createCandidateRevision({ projectId: project.projectId });
    expect(candidate).toMatchObject({
      projectId: project.projectId,
      state: "candidate",
    });
    expect(candidate.revisionId).toMatch(/^revision-[a-f0-9-]{36}$/);
    expect(authority.getRevision(candidate.revisionId)).toEqual(candidate);
    expect(authority.getProject(project.projectId).currentRevisionId).toBeNull();

    expect(() => {
      (candidate as { state: string }).state = "accepted";
    }).toThrow(TypeError);
    expect(authority.getRevision(candidate.revisionId).state).toBe("candidate");
  });

  it("rejects invalid candidate creation and unknown Revision reads", () => {
    const authority = new ProjectAuthority();
    const project = authority.createProject({});

    expect(() => authority.createCandidateRevision({
      projectId: project.projectId,
      state: "accepted",
    } as never)).toThrow();
    expect(() => authority.createCandidateRevision({ projectId: "missing-project" })).toThrow(/Unknown Project/);
    expect(() => authority.getRevision("INVALID!")).toThrow();
    expect(() => authority.getRevision("revision-33333333-3333-4333-8333-333333333333"))
      .toThrow(/Unknown Revision/);
  });
});
