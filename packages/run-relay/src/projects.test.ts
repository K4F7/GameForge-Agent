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

describe("ProjectAuthority Attempts", () => {
  it("starts an immutable Attempt bound to authoritative Task, base, contract, and candidate state", () => {
    const { authority, project, taskId, contract } = candidateFixture();

    const attempt = authority.startAttempt({ taskId, projectId: project.projectId });

    expect(attempt).toMatchObject({
      taskId,
      projectId: project.projectId,
      acceptanceContractFingerprint: contract.fingerprint,
      state: "running",
    });
    expect(attempt.baseRevisionId).toBeUndefined();
    expect(attempt.attemptId).toMatch(/^attempt-[a-f0-9-]{36}$/);
    expect(attempt.revisionId).toMatch(/^revision-[a-f0-9-]{36}$/);
    expect(authority.getRevision(attempt.revisionId).state).toBe("candidate");
    expect(authority.getAttempt(attempt.attemptId)).toEqual(attempt);
    expect(Object.isFrozen(attempt)).toBe(true);
  });

  it("creates an explicit retry as a new Attempt without rewriting the previous Attempt", () => {
    const { authority, project, taskId } = candidateFixture();
    const first = authority.startAttempt({ taskId, projectId: project.projectId });
    const previousSnapshot = structuredClone(first);

    const retry = authority.retryAttempt({ attemptId: first.attemptId });

    expect(retry).toMatchObject({
      taskId: first.taskId,
      projectId: first.projectId,
      acceptanceContractFingerprint: first.acceptanceContractFingerprint,
      state: "running",
    });
    expect(retry.attemptId).not.toBe(first.attemptId);
    expect(retry.revisionId).not.toBe(first.revisionId);
    expect(authority.getAttempt(first.attemptId)).toEqual(previousSnapshot);
    expect(Object.isFrozen(authority.getAttempt(first.attemptId))).toBe(true);
  });

  it("rejects a retry after Authority advances the frozen acceptance contract", () => {
    const { authority, project, taskId, tasks } = candidateFixture();
    const first = authority.startAttempt({ taskId, projectId: project.projectId });
    const versionTwo = tasks.compileAcceptanceContract(taskId, acceptanceInput(2, "Reach the harder goal."));
    if (versionTwo.outcome !== "frozen") throw new Error("Expected version two to freeze.");

    expect(() => authority.retryAttempt({ attemptId: first.attemptId }))
      .toThrow(expect.objectContaining({ code: "acceptance_contract_changed" }));
    expect(authority.getAttempt(first.attemptId)).toEqual(first);
  });

  it("requires the explicit retry operation for a Task that already has an Attempt", () => {
    const { authority, project, taskId } = candidateFixture();
    const input = { taskId, projectId: project.projectId } as const;
    const first = authority.startAttempt(input);

    expect(() => authority.startAttempt(input))
      .toThrow(expect.objectContaining({ code: "attempt_already_started" }));
    expect(authority.retryAttempt({ attemptId: first.attemptId }).attemptId).not.toBe(first.attemptId);
  });

  it("rejects caller-supplied base and acceptance state", () => {
    const { authority, project, taskId, contract } = candidateFixture();

    expect(() => authority.startAttempt({
      taskId,
      projectId: project.projectId,
      baseRevisionId: "revision-11111111-1111-4111-8111-111111111111",
      acceptanceContractFingerprint: contract.fingerprint,
    } as never)).toThrow();
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
  return { authority, project, taskId, tasks, contract: result.contract };
}
