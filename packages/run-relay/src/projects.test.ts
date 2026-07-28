import { describe, expect, it } from "vitest";
import { ProjectAuthority } from "./server.js";
import { RunStore } from "./store.js";
import { TaskInbox } from "./tasks.js";

describe("ProjectAuthority Projects", () => {
  it("creates and reads a stable Project with no current Revision", () => {
    const authority = new ProjectAuthority(new TaskInbox(new RunStore()));

    const created = authority.createProject({});
    expect(created.projectId).toMatch(/^project-[a-f0-9-]{36}$/);
    expect(created.currentRevisionId).toBeNull();
    expect(authority.getProject(created.projectId)).toEqual(created);
    expect(Object.isFrozen(created)).toBe(true);
  });

  it("rejects invalid creation and reads of unknown Projects", () => {
    const authority = new ProjectAuthority(new TaskInbox(new RunStore()));

    expect(() => authority.createProject({ requestedId: "caller-owned" } as never)).toThrow();
    expect(() => authority.getProject("UNKNOWN!")).toThrow();
    expect(() => authority.getProject("missing-project")).toThrow(/Unknown Project/);
  });
});

describe("ProjectAuthority candidate Revisions", () => {
  it("creates and reads an immutable candidate without making it current", () => {
    const { authority, project, taskId } = candidateFixture();

    const candidate = authority.createCandidateRevision({ projectId: project.projectId, taskId });
    expect(candidate).toMatchObject({
      projectId: project.projectId,
      taskId,
      state: "candidate",
      acceptanceContractFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
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
    const { authority, project, taskId } = candidateFixture();

    expect(() => authority.createCandidateRevision({
      projectId: project.projectId,
      taskId,
      state: "accepted",
    } as never)).toThrow();
    expect(() => authority.createCandidateRevision({ projectId: "missing-project", taskId })).toThrow(/Unknown Project/);
    expect(() => authority.getRevision("INVALID!")).toThrow();
    expect(() => authority.getRevision("revision-33333333-3333-4333-8333-333333333333"))
      .toThrow(/Unknown Revision/);
  });

  it("invalidates candidates bound to an older acceptance contract fingerprint", () => {
    const tasks = new TaskInbox(new RunStore());
    const authority = new ProjectAuthority(tasks);
    const project = authority.createProject({});
    const task = tasks.create({
      runId: "run-candidate-contract",
      prompt: "Create a game whose candidate remains bound to the reviewed requirements.",
      language: "en-US",
      projectId: project.projectId,
    }).task;
    const versionOne = tasks.compileAcceptanceContract(task.taskId, acceptanceInput(1, "Collect 3 stars."));
    if (versionOne.outcome !== "frozen") throw new Error("Expected version one to freeze.");

    const oldCandidate = authority.createCandidateRevision({
      projectId: project.projectId,
      taskId: task.taskId,
    });
    expect(oldCandidate.acceptanceContractFingerprint).toBe(versionOne.contract.fingerprint);
    expect(authority.getCandidateAcceptanceValidity(oldCandidate.revisionId)).toMatchObject({
      revisionId: oldCandidate.revisionId,
      valid: true,
    });

    const versionTwo = tasks.compileAcceptanceContract(task.taskId, acceptanceInput(2, "Collect 5 stars."));
    if (versionTwo.outcome !== "frozen") throw new Error("Expected version two to freeze.");
    expect(versionTwo.contract.fingerprint).not.toBe(versionOne.contract.fingerprint);
    expect(authority.getCandidateAcceptanceValidity(oldCandidate.revisionId)).toMatchObject({
      revisionId: oldCandidate.revisionId,
      acceptanceContractFingerprint: versionOne.contract.fingerprint,
      valid: false,
    });

    const currentCandidate = authority.createCandidateRevision({
      projectId: project.projectId,
      taskId: task.taskId,
    });
    expect(authority.getCandidateAcceptanceValidity(currentCandidate.revisionId)).toMatchObject({
      acceptanceContractFingerprint: versionTwo.contract.fingerprint,
      valid: true,
    });
  });

  it("rejects a candidate when its Task belongs to another Project", () => {
    const tasks = new TaskInbox(new RunStore());
    const authority = new ProjectAuthority(tasks);
    const taskProject = authority.createProject({});
    const otherProject = authority.createProject({});
    const task = tasks.create({
      runId: "run-candidate-project-mismatch",
      prompt: "Modify only the Project identified by the Task.",
      language: "en-US",
      projectId: taskProject.projectId,
    }).task;
    const frozen = tasks.compileAcceptanceContract(task.taskId, acceptanceInput(1, "Reach the goal."));
    if (frozen.outcome !== "frozen") throw new Error("Expected acceptance to freeze.");

    expect(() => authority.createCandidateRevision({
      projectId: otherProject.projectId,
      taskId: task.taskId,
    })).toThrow(expect.objectContaining({ code: "task_project_mismatch" }));
  });

  it("invalidates an in-flight candidate when an in-progress Task advances its contract version", () => {
    const { authority, project, taskId, tasks } = candidateFixture();
    const oldCandidate = authority.createCandidateRevision({ projectId: project.projectId, taskId });
    const claimed = tasks.claim(taskId, { agentId: "codearts" });
    expect(claimed.status).toBe("claimed");
    const started = tasks.transition(taskId, { status: "in-progress", agentId: "codearts" });
    expect(started).toMatchObject({ outcome: "accepted", task: { status: "in-progress" } });

    const versionTwo = tasks.compileAcceptanceContract(taskId, acceptanceInput(2, "Reach the harder goal."));

    expect(versionTwo).toMatchObject({
      outcome: "frozen",
      task: { status: "in-progress", claimedBy: "codearts" },
      contract: { contractVersion: 2 },
    });
    expect(authority.getCandidateAcceptanceValidity(oldCandidate.revisionId).valid).toBe(false);
  });
});

function acceptanceInput(contractVersion: number, expected: string) {
  return {
    contractVersion,
    criteria: [{
      criterionId: "star-goal",
      sourceRequirement: expected,
      expected,
      verification: { kind: "public-telemetry" as const, path: "$.collectedStars" },
    }],
  };
}

function candidateFixture() {
  const tasks = new TaskInbox(new RunStore());
  const authority = new ProjectAuthority(tasks);
  const project = authority.createProject({});
  const taskId = tasks.create({
    runId: "run-project-fixture",
    prompt: "Create a browser game candidate against frozen acceptance criteria.",
    language: "en-US",
    projectId: project.projectId,
  }).task.taskId;
  const result = tasks.compileAcceptanceContract(taskId, acceptanceInput(1, "Reach the goal."));
  if (result.outcome !== "frozen") throw new Error("Expected fixture acceptance to freeze.");
  return { authority, project, taskId, tasks };
}
