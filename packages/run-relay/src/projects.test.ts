import { describe, expect, it } from "vitest";
import { ProjectAuthority } from "./server.js";
import { RunStore } from "./store.js";
import { TaskInbox } from "./tasks.js";
import { createHash } from "node:crypto";
import { bundleBudgetIssues, mcpToolAuditDigest, sealEvidence, webGameBundleLimits, type EvidenceAggregateInput, type EvidenceSubmission, type WireRunEvent } from "@gameforge/contracts";

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

  it("rejects restored Projects whose current Revision is missing or belongs to another Project", () => {
    const missingRevisionId = "revision-00000000-0000-4000-8000-000000000065";
    expect(() => restoreWithCurrentRevision(missingRevisionId, [])).toThrow("current Revision");

    const otherProjectId = "project-00000000-0000-4000-8000-000000000066";
    expect(() => restoreWithCurrentRevision(missingRevisionId, [{
      projectId: otherProjectId,
      revisionId: missingRevisionId,
      state: "candidate",
      acceptanceContractFingerprint: "a".repeat(64),
    }])).toThrow("another Project");
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
    const { authority, project, taskId, tasks } = candidateFixture();
    const first = authority.startAttempt({ taskId, projectId: project.projectId });
    expect(authority.sealAttemptEvidence(evidenceFor(first, true, tasks)).status).toBe("incomplete");
    expect(tasks.transition(taskId, { status: "in-progress", agentId: "codearts" }).outcome).toBe("accepted");
    const previousSnapshot = structuredClone(authority.getAttempt(first.attemptId));
    const firstRunId = tasks.get(taskId).runId;

    const retry = authority.retryAttempt({ attemptId: first.attemptId });
    const retryRunId = tasks.get(taskId).runId;

    expect(retry).toMatchObject({
      taskId: first.taskId,
      projectId: first.projectId,
      acceptanceContractFingerprint: first.acceptanceContractFingerprint,
      state: "running",
    });
    expect(retry.attemptId).not.toBe(first.attemptId);
    expect(retry.revisionId).not.toBe(first.revisionId);
    expect(retryRunId).not.toBe(firstRunId);
    expect(tasks.authoritativeRunEvents(retryRunId)).toEqual([
      expect.objectContaining({ type: "run.started", runId: retryRunId, sequence: 1 }),
    ]);
    expect(tasks.authoritativeRunEvents(firstRunId)).toEqual([
      expect.objectContaining({ type: "run.started", sequence: 1 }),
      expect.objectContaining({ type: "project.generated", sequence: 2 }),
      expect.objectContaining({ type: "mcp.audit.ready", sequence: 3 }),
      expect.objectContaining({ type: "verification.ready", sequence: 4 }),
      expect.objectContaining({ type: "run.completed", sequence: 5 }),
    ]);
    expect(authority.getAttempt(first.attemptId)).toEqual(previousSnapshot);
    expect(Object.isFrozen(authority.getAttempt(first.attemptId))).toBe(true);
    expect(() => authority.retryAttempt({ attemptId: first.attemptId }))
      .toThrow(expect.objectContaining({ code: "attempt_already_retried" }));
  });

  it("leaves the current Run and Attempt unchanged when retry Run capacity is exhausted", () => {
    const store = new RunStore({ maxRuns: 1 });
    const tasks = new TaskInbox(store);
    const authority = new ProjectAuthority(tasks);
    const project = authority.createProject({});
    const task = tasks.create({
      runId: "run-retry-capacity",
      prompt: "Create a browser game candidate against frozen acceptance criteria.",
      language: "en-US",
      projectId: project.projectId,
    }).task;
    const frozen = tasks.compileAcceptanceContract(task.taskId, acceptanceInput(1, "Reach the goal."));
    if (frozen.outcome !== "frozen") throw new Error("Expected acceptance to freeze.");
    const attempt = authority.startAttempt({ taskId: task.taskId, projectId: project.projectId });
    expect(authority.sealAttemptEvidence(evidenceFor(attempt, true, tasks)).status).toBe("incomplete");
    expect(tasks.transition(task.taskId, { status: "in-progress", agentId: "codearts" }).outcome).toBe("accepted");
    const incompleteSnapshot = authority.getAttempt(attempt.attemptId);

    expect(() => authority.retryAttempt({ attemptId: attempt.attemptId })).toThrow("capacity");
    expect(store.status(task.runId)).toBe("succeeded");
    expect(tasks.get(task.taskId).runId).toBe(task.runId);
    expect(authority.getAttempt(attempt.attemptId)).toEqual(incompleteSnapshot);
    expect(authority.snapshot().retriedAttemptIds).toEqual([]);
  });

  it("rejects a retry after Authority advances the frozen acceptance contract", () => {
    const { authority, project, taskId, tasks } = candidateFixture();
    const first = authority.startAttempt({ taskId, projectId: project.projectId });
    expect(authority.sealAttemptEvidence(evidenceFor(first, true, tasks)).status).toBe("incomplete");
    expect(tasks.transition(taskId, { status: "in-progress", agentId: "codearts" }).outcome).toBe("accepted");
    const incompleteSnapshot = authority.getAttempt(first.attemptId);
    const versionTwo = tasks.compileAcceptanceContract(taskId, acceptanceInput(2, "Reach the harder goal."));
    if (versionTwo.outcome !== "frozen") throw new Error("Expected version two to freeze.");

    expect(() => authority.retryAttempt({ attemptId: first.attemptId }))
      .toThrow(expect.objectContaining({ code: "acceptance_contract_changed" }));
    expect(authority.getAttempt(first.attemptId)).toEqual(incompleteSnapshot);
  });

  it("starts a fresh immutable Attempt after Authority invalidates the previous contract", () => {
    const { authority, project, taskId, tasks, store } = candidateFixture();
    const first = authority.startAttempt({ taskId, projectId: project.projectId });
    evidenceFor(first, false, tasks, { leaveRunOpen: true });
    const firstRunId = first.runId;
    const versionTwo = tasks.compileAcceptanceContract(taskId, acceptanceInput(2, "Reach the harder goal."));
    if (versionTwo.outcome !== "frozen") throw new Error("Expected version two to freeze.");

    const fresh = authority.startAttempt({ taskId, projectId: project.projectId });

    expect(fresh.attemptId).not.toBe(first.attemptId);
    expect(fresh.runId).not.toBe(firstRunId);
    expect(fresh.revisionId).not.toBe(first.revisionId);
    expect(fresh.acceptanceContractFingerprint).toBe(versionTwo.contract.fingerprint);
    expect(store.status(firstRunId)).toBe("stopped");
    expect(tasks.authoritativeRunEvents(firstRunId).at(-1)).toMatchObject({ type: "run.stopped" });
    expect(tasks.authoritativeRunEvents(fresh.runId)).toEqual([
      expect.objectContaining({ type: "run.started", sequence: 1 }),
    ]);
    expect(authority.getAttempt(first.attemptId)).toEqual(first);
    expect(authority.startAttempt({ taskId, projectId: project.projectId })).toEqual(fresh);
  });

  it("recovers the compatible running Attempt without consuming its explicit retry", () => {
    const { authority, project, taskId, tasks } = candidateFixture();
    const input = { taskId, projectId: project.projectId } as const;
    const first = authority.startAttempt(input);

    expect(authority.startAttempt(input)).toEqual(first);
    expect(authority.sealAttemptEvidence(evidenceFor(first, true, tasks)).status).toBe("incomplete");
    expect(tasks.transition(taskId, { status: "in-progress", agentId: "codearts" }).outcome).toBe("accepted");
    expect(authority.retryAttempt({ attemptId: first.attemptId }).attemptId).not.toBe(first.attemptId);
  });

  it.each(["running", "passed"] as const)("rejects retrying a %s Attempt", (state) => {
    const { authority, project, taskId, tasks } = candidateFixture();
    const attempt = authority.startAttempt({ taskId, projectId: project.projectId });
    if (state === "passed") expect(authority.sealAttemptEvidence(evidenceFor(attempt, false, tasks)).status).toBe("sealed");

    expect(() => authority.retryAttempt({ attemptId: attempt.attemptId }))
      .toThrow(expect.objectContaining({ code: "attempt_not_incomplete" }));
    expect(authority.getAttempt(attempt.attemptId).state).toBe(state);
  });

  it("rejects retrying an incomplete Attempt while its Task is not in progress", () => {
    const { authority, project, taskId, tasks } = candidateFixture();
    const attempt = authority.startAttempt({ taskId, projectId: project.projectId });
    expect(authority.sealAttemptEvidence(evidenceFor(attempt, true, tasks)).status).toBe("incomplete");
    const taskSnapshot = tasks.get(taskId);
    const runSnapshot = tasks.authoritativeRunEvents(attempt.runId);

    expect(() => authority.retryAttempt({ attemptId: attempt.attemptId }))
      .toThrow(expect.objectContaining({ code: "task_not_retryable" }));
    expect(tasks.get(taskId)).toEqual(taskSnapshot);
    expect(tasks.authoritativeRunEvents(attempt.runId)).toEqual(runSnapshot);
    expect(authority.snapshot().retriedAttemptIds).toEqual([]);
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

  it("persists incomplete evidence and its stable reason on the authoritative Attempt", () => {
    const { authority, project, taskId, tasks } = candidateFixture();
    const attempt = authority.startAttempt({ taskId, projectId: project.projectId });
    const evidence = evidenceFor(attempt, true, tasks);

    expect(authority.sealAttemptEvidence(evidence)).toEqual({
      status: "incomplete",
      reasonCode: "evidence.missing-required-proof.v1",
      attemptId: attempt.attemptId,
    });
    expect(authority.getAttempt(attempt.attemptId)).toMatchObject({
      state: "incomplete",
      incompleteReasonCode: "evidence.missing-required-proof.v1",
    });
    const stored = authority.getAttempt(attempt.attemptId);
    if (stored.state !== "incomplete") throw new Error("expected incomplete Attempt");
    if (stored.incompleteEvidence.mcpAudit === undefined) throw new Error("expected audit proof");
    expect(Object.isFrozen(stored.incompleteEvidence)).toBe(true);
    expect(Object.isFrozen(stored.incompleteEvidence.mcpAudit.calls)).toBe(true);
  });

  it.each(["artifacts", "audit-calls", "authority-events", "build-metrics", "criteria", "screenshots"] as const)(
    "persists structurally missing %s as immutable incomplete Evidence",
    (missing) => {
      const { authority, project, taskId, tasks } = candidateFixture();
      const attempt = authority.startAttempt({ taskId, projectId: project.projectId });
      const evidence = evidenceFor(attempt, false, tasks);
      if (missing === "artifacts") evidence.artifacts = undefined;
      if (missing === "audit-calls") evidence.mcpAudit.calls = [];
      if (missing === "authority-events") evidence.authorityEvents = [];
      if (missing === "build-metrics") {
        evidence.build.report.metrics = {
          initial: { raw: 0, gzip: 0 },
          async: { raw: 0, gzip: 0 },
          total: { raw: 0, gzip: 0 },
          files: [],
        };
      }
      if (missing === "criteria") evidence.criterionResults = [];
      if (missing === "screenshots") evidence.browserProof.screenshots = [];

      expect(authority.sealAttemptEvidence(evidence)).toEqual({
        status: "incomplete",
        reasonCode: "evidence.missing-required-proof.v1",
        attemptId: attempt.attemptId,
      });
      expect(authority.getAttempt(attempt.attemptId)).toMatchObject({
        state: "incomplete",
        incompleteReasonCode: "evidence.missing-required-proof.v1",
      });
    },
  );

  it("gives a retry after incomplete Evidence a writable authoritative Run", () => {
    const { authority, project, taskId, tasks } = candidateFixture();
    const first = authority.startAttempt({ taskId, projectId: project.projectId });
    const firstEvidence = evidenceFor(first, true, tasks);
    expect(authority.sealAttemptEvidence(firstEvidence).status).toBe("incomplete");
    expect(tasks.transition(taskId, { status: "in-progress", agentId: "codearts" }).outcome).toBe("accepted");
    const firstSnapshot = authority.getAttempt(first.attemptId);

    const retry = authority.retryAttempt({ attemptId: first.attemptId });
    const retryRunId = tasks.get(taskId).runId;
    expect(retryRunId).not.toBe(firstEvidence.runId);

    const retryEvidence = evidenceFor(retry, false, tasks);
    expect(retryEvidence.runId).toBe(retryRunId);
    expect(retryEvidence.authorityEvents.every(({ attemptId }) => attemptId === retry.attemptId)).toBe(true);
    expect(retryEvidence.authorityEvents.find(({ event }) => event.type === "verification.ready")).toMatchObject({
      event: { attemptId: retry.attemptId, revisionId: retry.revisionId, projectId: retry.projectId },
    });
    expect(authority.sealAttemptEvidence(retryEvidence).status).toBe("sealed");
    expect(authority.getAttempt(retry.attemptId).state).toBe("passed");
    expect(authority.getAttempt(first.attemptId)).toEqual(firstSnapshot);
  });

  it("stores sealed evidence in Authority state and rejects resealing", () => {
    const { authority, project, taskId, tasks } = candidateFixture();
    const attempt = authority.startAttempt({ taskId, projectId: project.projectId });
    const evidence = evidenceFor(attempt, false, tasks);
    const sealed = authority.sealAttemptEvidence(evidence);
    expect(sealed.status).toBe("sealed");
    if (sealed.status !== "sealed") throw new Error("expected sealed evidence");
    expect(authority.getAttempt(attempt.attemptId)).toMatchObject({ state: "passed", sealedDigest: sealed.evidence.digest });
    const stored = authority.getAttempt(attempt.attemptId);
    if (stored.state !== "passed") throw new Error("expected passed Attempt");
    expect(Object.isFrozen(stored.sealedEvidence)).toBe(true);
    expect(Object.isFrozen(stored.sealedEvidence.authorityEvents)).toBe(true);
    expect(() => authority.sealAttemptEvidence(evidence)).toThrow("already sealed");
    expect(() => authority.startAttempt({ taskId, projectId: project.projectId }))
      .toThrow(expect.objectContaining({ code: "attempt_already_started" }));
  });

  it("seals complete Evidence before terminal Run completion", () => {
    const { authority, project, taskId, tasks } = candidateFixture();
    const attempt = authority.startAttempt({ taskId, projectId: project.projectId });
    const evidence = evidenceFor(attempt, false, tasks, { leaveRunOpen: true });

    expect(tasks.get(taskId).status).toBe("claimed");
    expect(authority.sealAttemptEvidence(evidence).status).toBe("sealed");
    expect(authority.getAttempt(attempt.attemptId).state).toBe("passed");
    expect(tasks.finishRun(evidence.runId, "run.completed")).toMatchObject({ type: "run.completed" });
  });

  it("rejects every Attempt-bound producer event after sealing while allowing terminal Run completion", () => {
    const { authority, project, taskId, tasks } = candidateFixture();
    const attempt = authority.startAttempt({ taskId, projectId: project.projectId });
    const evidence = evidenceFor(attempt, false, tasks, { leaveRunOpen: true });
    expect(authority.sealAttemptEvidence(evidence).status).toBe("sealed");

    const producerEvents = evidence.authorityEvents
      .map(({ event }) => event)
      .filter((event): event is Extract<WireRunEvent, { type: "project.generated" | "mcp.audit.ready" | "verification.ready" }> =>
        event.type === "project.generated" || event.type === "mcp.audit.ready" || event.type === "verification.ready");
    expect(producerEvents.map(({ type }) => type)).toEqual([
      "project.generated",
      "mcp.audit.ready",
      "verification.ready",
    ]);
    for (const producerEvent of producerEvents) {
      expect(() => tasks.appendRun(evidence.runId, {
        runId: evidence.runId,
        after: 4,
        events: [{ ...structuredClone(producerEvent), sequence: 5 }],
      })).toThrow(expect.objectContaining({ code: "attempt_already_sealed" }));
    }
    expect(tasks.authoritativeRunEvents(evidence.runId)).toHaveLength(4);
    expect(tasks.finishRun(evidence.runId, "run.completed")).toMatchObject({
      type: "run.completed",
      sequence: 5,
    });
  });

  it("freezes incomplete Attempt producer evidence, including nested Attempt identities", () => {
    const { authority, project, taskId, tasks } = candidateFixture();
    const attempt = authority.startAttempt({ taskId, projectId: project.projectId });
    const evidence = evidenceFor(attempt, true, tasks, { leaveRunOpen: true });
    expect(authority.sealAttemptEvidence(evidence).status).toBe("incomplete");
    const generated = evidence.authorityEvents.find(({ event }) => event.type === "project.generated")?.event;
    const verification = evidence.authorityEvents.find(({ event }) => event.type === "verification.ready")?.event;
    if (generated?.type !== "project.generated" || verification?.type !== "verification.ready") {
      throw new Error("Expected producer evidence events.");
    }
    const nestedOnlyGenerated = structuredClone(generated);
    delete nestedOnlyGenerated.attemptId;
    const nestedOnlyVerification = structuredClone(verification);
    delete nestedOnlyVerification.attemptId;

    for (const producerEvent of [nestedOnlyGenerated, nestedOnlyVerification]) {
      expect(() => tasks.appendRun(evidence.runId, {
        runId: evidence.runId,
        after: 4,
        events: [{ ...producerEvent, sequence: 5 }],
      })).toThrow(expect.objectContaining({ code: "attempt_already_sealed" }));
    }
    expect(tasks.finishRun(evidence.runId, "run.completed")).toMatchObject({ sequence: 5 });
  });

  it("rejects producer events that combine running Attempt identities", () => {
    const store = new RunStore();
    const tasks = new TaskInbox(store);
    const authority = new ProjectAuthority(tasks);
    const start = (suffix: string) => {
      const project = authority.createProject({});
      const task = tasks.create({
        runId: `run-mixed-producer-${suffix}`,
        prompt: "Create a browser game candidate against frozen acceptance criteria.",
        language: "en-US",
        projectId: project.projectId,
      }).task;
      const frozen = tasks.compileAcceptanceContract(task.taskId, acceptanceInput(1, "Reach the goal."));
      if (frozen.outcome !== "frozen") throw new Error("Expected acceptance to freeze.");
      return authority.startAttempt({ taskId: task.taskId, projectId: project.projectId });
    };
    const first = start("first");
    const second = start("second");
    const firstEvidence = evidenceFor(first, false, tasks, { leaveRunOpen: true });
    const secondEvidence = evidenceFor(second, false, tasks, { leaveRunOpen: true });
    const firstGenerated = firstEvidence.authorityEvents.find(({ event }) => event.type === "project.generated")?.event;
    const secondVerification = secondEvidence.authorityEvents.find(({ event }) => event.type === "verification.ready")?.event;
    if (firstGenerated?.type !== "project.generated" || secondVerification?.type !== "verification.ready") {
      throw new Error("Expected producer evidence events.");
    }

    expect(() => tasks.appendRun(second.runId, {
      runId: second.runId,
      after: 4,
      events: [{
        ...structuredClone(firstGenerated),
        runId: second.runId,
        sequence: 5,
        attemptId: second.attemptId,
      }],
    })).toThrow(expect.objectContaining({ code: "evidence_attempt_mismatch" }));
    expect(() => tasks.appendRun(second.runId, {
      runId: second.runId,
      after: 4,
      events: [{
        ...structuredClone(secondVerification),
        sequence: 5,
        revisionId: first.revisionId,
      }],
    })).toThrow(expect.objectContaining({ code: "evidence_attempt_mismatch" }));
  });

  it("rejects unknown Attempt producer events before they can poison authoritative history", () => {
    const { authority, project, taskId, tasks } = candidateFixture();
    const attempt = authority.startAttempt({ taskId, projectId: project.projectId });
    tasks.claim(taskId, { agentId: "codearts" });
    const fabricatedAttemptId = "attempt-99999999-9999-4999-8999-999999999999";

    expect(() => tasks.appendRun(attempt.runId, {
      runId: attempt.runId,
      after: 1,
      events: [{
        type: "mcp.audit.ready",
        runId: attempt.runId,
        sequence: 2,
        emittedAt: "2026-07-30T00:00:00.000Z",
        attemptId: fabricatedAttemptId,
        auditDigest: "a".repeat(64),
        truncated: false,
        totalCalls: 0,
        calls: [],
      }],
    })).toThrow(expect.objectContaining({ code: "attempt_not_found" }));
    expect(tasks.authoritativeRunEvents(attempt.runId)).toEqual([
      expect.objectContaining({ type: "run.started", sequence: 1 }),
    ]);
    expect(authority.sealAttemptEvidence(evidenceFor(attempt, false, tasks)).status).toBe("sealed");
  });

  it("requires passed immutable Evidence before completing the authoritative Task", () => {
    const { authority, project, taskId, tasks } = candidateFixture();
    const attempt = authority.startAttempt({ taskId, projectId: project.projectId });
    tasks.claim(taskId, { agentId: "codearts" });
    expect(tasks.transition(taskId, { status: "in-progress", agentId: "codearts" }).outcome).toBe("accepted");
    const incomplete = evidenceFor(attempt, true, tasks);
    expect(authority.sealAttemptEvidence(incomplete).status).toBe("incomplete");

    expect(tasks.transition(taskId, { status: "completed", agentId: "codearts" })).toMatchObject({
      outcome: "rejected",
      code: "missing-passed-attempt",
      task: { status: "in-progress" },
    });
  });

  it("rejects authoritative Task completion when no Attempt has sealed Evidence", () => {
    const { taskId, tasks } = candidateFixture();
    tasks.claim(taskId, { agentId: "codearts" });
    expect(tasks.transition(taskId, { status: "in-progress", agentId: "codearts" }).outcome).toBe("accepted");
    tasks.finishRun(tasks.get(taskId).runId, "run.completed");

    expect(tasks.transition(taskId, { status: "completed", agentId: "codearts" })).toMatchObject({
      outcome: "rejected",
      code: "missing-passed-attempt",
      task: { status: "in-progress" },
    });
  });

  it("restores sealed Evidence followed only by the documented terminal completion suffix", () => {
    const { authority, project, taskId, tasks, store } = candidateFixture();
    const attempt = authority.startAttempt({ taskId, projectId: project.projectId });
    const evidence = evidenceFor(attempt, false, tasks, { leaveRunOpen: true });
    expect(authority.sealAttemptEvidence(evidence).status).toBe("sealed");
    tasks.finishRun(attempt.runId, "run.completed");

    const restoredStore = new RunStore();
    restoredStore.restore(store.snapshot());
    const restoredTasks = new TaskInbox(restoredStore);
    restoredTasks.restore(tasks.snapshot());
    const restoredAuthority = new ProjectAuthority(restoredTasks);

    expect(() => restoredAuthority.restore(authority.snapshot())).not.toThrow();
    expect(restoredAuthority.getAttempt(attempt.attemptId)).toMatchObject({ state: "passed" });
  });

  it("restores incomplete Evidence followed by the explicit retry stop suffix", () => {
    const { authority, project, taskId, tasks, store } = candidateFixture();
    const attempt = authority.startAttempt({ taskId, projectId: project.projectId });
    const evidence = evidenceFor(attempt, true, tasks, { leaveRunOpen: true });
    expect(authority.sealAttemptEvidence(evidence).status).toBe("incomplete");
    expect(tasks.transition(taskId, { status: "in-progress", agentId: "codearts" }).outcome).toBe("accepted");
    const retry = authority.retryAttempt({ attemptId: attempt.attemptId });
    expect(tasks.authoritativeRunEvents(attempt.runId).at(-1)).toMatchObject({ type: "run.stopped" });

    const restoredStore = new RunStore();
    restoredStore.restore(store.snapshot());
    const restoredTasks = new TaskInbox(restoredStore);
    restoredTasks.restore(tasks.snapshot());
    const restoredAuthority = new ProjectAuthority(restoredTasks);

    expect(() => restoredAuthority.restore(authority.snapshot())).not.toThrow();
    expect(restoredAuthority.getAttempt(attempt.attemptId)).toMatchObject({ state: "incomplete" });
    expect(restoredAuthority.getAttempt(retry.attemptId)).toMatchObject({ state: "running" });
  });

  it("rejects restored terminal Evidence rebound to another authoritative Run", () => {
    const { authority, project, taskId, tasks, store } = candidateFixture();
    const attempt = authority.startAttempt({ taskId, projectId: project.projectId });
    const evidence = evidenceFor(attempt, false, tasks);
    expect(authority.sealAttemptEvidence(evidence).status).toBe("sealed");
    const otherTask = tasks.create({
      runId: "run-other-restored-evidence",
      prompt: "Create another independent browser game.",
      language: "en-US",
    }).task;
    const snapshot = authority.snapshot();
    const stored = snapshot.attempts.find(({ attemptId }) => attemptId === attempt.attemptId);
    if (stored?.state !== "passed") throw new Error("Expected passed Attempt snapshot.");
    const mutableSealed = structuredClone(stored.sealedEvidence) as unknown as EvidenceAggregateInput & {
      digest: string;
      status: "sealed";
    };
    const { digest: _digest, status: _status, ...tampered } = mutableSealed;
    tampered.runId = otherTask.runId;
    tampered.mcpAudit.context!.runId = otherTask.runId;
    tampered.authorityEvents = tasks.authoritativeRunEvents(otherTask.runId).map((event) => ({
      attemptId: attempt.attemptId,
      event,
    }));
    const resealed = sealEvidence(tampered);
    if (resealed.status !== "sealed") throw new Error("Expected internally valid tampered Evidence.");
    const tamperedSnapshot = {
      ...snapshot,
      attempts: snapshot.attempts.map((entry) => entry.attemptId === attempt.attemptId
        ? { ...entry, sealedDigest: resealed.evidence.digest, sealedEvidence: resealed.evidence }
        : entry),
    };

    const restoredStore = new RunStore();
    restoredStore.restore(store.snapshot());
    const restoredTasks = new TaskInbox(restoredStore);
    restoredTasks.restore(tasks.snapshot());
    expect(() => new ProjectAuthority(restoredTasks).restore(tamperedSnapshot)).toThrow("identities must match");
  });

  it("rejects Evidence with a base Revision that is not bound to the Attempt", () => {
    const { authority, project, taskId, tasks } = candidateFixture();
    const attempt = authority.startAttempt({ taskId, projectId: project.projectId });
    const evidence = evidenceFor(attempt, false, tasks);
    evidence.baseRevisionId = "revision-99999999-9999-4999-8999-999999999999";
    expect(() => authority.sealAttemptEvidence(evidence)).toThrow("does not belong");
  });

  it("rejects Evidence with an acceptance contract not bound to the Attempt", () => {
    const { authority, project, taskId, tasks } = candidateFixture();
    const attempt = authority.startAttempt({ taskId, projectId: project.projectId });
    const evidence = evidenceFor(attempt, false, tasks);
    evidence.acceptanceContractFingerprint = "a".repeat(64);
    expect(() => authority.sealAttemptEvidence(evidence)).toThrow("does not belong");
  });

  it("rejects Evidence with a Run not bound to the authoritative Task", () => {
    const { authority, project, taskId, tasks } = candidateFixture();
    const attempt = authority.startAttempt({ taskId, projectId: project.projectId });
    const evidence = evidenceFor(attempt, false, tasks);
    evidence.runId = "run-fabricated";
    evidence.mcpAudit.context!.runId = "run-fabricated";
    evidence.authorityEvents[0]!.event.runId = "run-fabricated";
    expect(() => authority.sealAttemptEvidence(evidence)).toThrow("same Run");
  });

  it("rejects fabricated Authority events that were never published to the Run", () => {
    const { authority, project, taskId, tasks } = candidateFixture();
    const attempt = authority.startAttempt({ taskId, projectId: project.projectId });
    tasks.claim(taskId, { agentId: "codearts" });

    expect(() => authority.sealAttemptEvidence(evidenceFor(attempt, false)))
      .toThrow("authoritative Run history");
  });

  it("rejects authoritative Run history without successful verification and completion", () => {
    const { authority, project, taskId, tasks } = candidateFixture();
    const attempt = authority.startAttempt({ taskId, projectId: project.projectId });
    tasks.claim(taskId, { agentId: "codearts" });
    const evidence = evidenceFor(attempt, false);
    evidence.authorityEvents = tasks.authoritativeRunEvents(evidence.runId).map((event) => ({
      attemptId: attempt.attemptId,
      event,
    }));

    expect(() => authority.sealAttemptEvidence(evidence)).toThrow("does not match authoritative verification");
  });

  it("rejects Evidence whose normalized request differs from the authoritative Task prompt", () => {
    const { authority, project, taskId, tasks } = candidateFixture();
    const attempt = authority.startAttempt({ taskId, projectId: project.projectId });
    const evidence = evidenceFor(attempt, false, tasks);
    evidence.request.normalized = "Create an unrelated game.";
    evidence.request.fingerprint = createHash("sha256").update(evidence.request.normalized).digest("hex");

    expect(() => authority.sealAttemptEvidence(evidence)).toThrow("Task prompt");
  });

  it("rejects sealing after Authority advances the frozen acceptance contract", () => {
    const { authority, project, taskId, tasks } = candidateFixture();
    const attempt = authority.startAttempt({ taskId, projectId: project.projectId });
    const evidence = evidenceFor(attempt, false, tasks);
    const advanced = tasks.compileAcceptanceContract(taskId, acceptanceInput(2, "Reach the harder goal."));
    expect(advanced.outcome).toBe("frozen");

    expect(() => authority.sealAttemptEvidence(evidence)).toThrow("current acceptance contract");
  });

  it("keeps incomplete Evidence immutable after creating its explicit retry", () => {
    const { authority, project, taskId, tasks } = candidateFixture();
    const attempt = authority.startAttempt({ taskId, projectId: project.projectId });
    const evidence = evidenceFor(attempt, true, tasks);
    expect(authority.sealAttemptEvidence(evidence).status).toBe("incomplete");
    expect(tasks.transition(taskId, { status: "in-progress", agentId: "codearts" }).outcome).toBe("accepted");
    authority.retryAttempt({ attemptId: attempt.attemptId });

    expect(() => authority.sealAttemptEvidence(evidence)).toThrow("already sealed");
    expect(authority.getAttempt(attempt.attemptId)).toMatchObject({ state: "incomplete" });
  });

  it("marks Evidence incomplete when it does not cover every frozen acceptance criterion", () => {
    const tasks = new TaskInbox(new RunStore());
    const authority = new ProjectAuthority(tasks);
    const project = authority.createProject({});
    const task = tasks.create({
      runId: "run-project-fixture",
      prompt: "Create a browser game candidate against frozen acceptance criteria.",
      language: "en-US",
      projectId: project.projectId,
    }).task;
    const frozen = tasks.compileAcceptanceContract(task.taskId, {
      contractVersion: 1,
      criteria: [
        acceptanceInput(1, "Reach the goal.").criteria[0],
        {
          criterionId: "score-goal",
          sourceRequirement: "Score at least 10.",
          expected: "10",
          verification: { kind: "public-telemetry", path: "$.score" },
        },
      ],
    });
    expect(frozen.outcome).toBe("frozen");
    const attempt = authority.startAttempt({ taskId: task.taskId, projectId: project.projectId });
    const evidence = evidenceFor(attempt, false, tasks);

    expect(authority.sealAttemptEvidence(evidence)).toEqual({
      status: "incomplete",
      reasonCode: "evidence.missing-required-proof.v1",
      attemptId: attempt.attemptId,
    });
    expect(authority.getAttempt(attempt.attemptId)).toMatchObject({
      state: "incomplete",
      missingCriterionIds: ["score-goal"],
    });
  });

  it("rejects unexpected authoritative criterion IDs before complete or partial terminal state", () => {
    const { authority, project, taskId, tasks } = candidateFixture();
    const attempt = authority.startAttempt({ taskId, projectId: project.projectId });
    const evidence = evidenceFor(attempt, false, tasks, { includeUnexpectedCriterion: true });

    for (const submission of [
      evidence,
      { ...structuredClone(evidence), browserProof: undefined },
    ]) {
      expect(() => authority.sealAttemptEvidence(submission)).toThrow(expect.objectContaining({
        code: "evidence_attempt_mismatch",
      }));
      expect(authority.getAttempt(attempt.attemptId).state).toBe("running");
    }
  });

  it("validates integrity before persisting criterion-gap Evidence", () => {
    const tasks = new TaskInbox(new RunStore());
    const authority = new ProjectAuthority(tasks);
    const project = authority.createProject({});
    const task = tasks.create({
      runId: "run-project-fixture",
      prompt: "Create a browser game candidate against frozen acceptance criteria.",
      language: "en-US",
      projectId: project.projectId,
    }).task;
    tasks.compileAcceptanceContract(task.taskId, {
      contractVersion: 1,
      criteria: [
        acceptanceInput(1, "Reach the goal.").criteria[0],
        { criterionId: "score-goal", sourceRequirement: "Score 10.", expected: "10", verification: { kind: "public-telemetry", path: "$.score" } },
      ],
    });
    const attempt = authority.startAttempt({ taskId: task.taskId, projectId: project.projectId });
    const evidence = evidenceFor(attempt, false, tasks);
    evidence.artifacts!.aggregateSha256 = "a".repeat(64);

    expect(() => authority.sealAttemptEvidence(evidence)).toThrow("Artifact aggregate");
    expect(authority.getAttempt(attempt.attemptId).state).toBe("running");
  });

  it.each([
    ["artifacts", (evidence: EvidenceAggregateInput) => {
      evidence.artifacts!.files[0]!.sha256 = "c".repeat(64);
      evidence.artifacts!.aggregateSha256 = createHash("sha256")
        .update(JSON.stringify(evidence.artifacts!.files))
        .digest("hex");
    }],
    ["audit", (evidence: EvidenceAggregateInput) => { evidence.mcpAudit.calls[0]!.tool = "gameforge.other"; }],
    ["build", (evidence: EvidenceAggregateInput) => {
      evidence.build.report.metrics.files[0]!.raw += 1;
      evidence.build.report.metrics.initial.raw += 1;
      evidence.build.report.metrics.total.raw += 1;
      evidence.build.report.issues = bundleBudgetIssues(evidence.build.report.metrics, webGameBundleLimits);
    }],
    ["criteria", (evidence: EvidenceAggregateInput) => { evidence.criterionResults[0]!.passed = false; }],
    ["versions", (evidence: EvidenceAggregateInput) => { evidence.versions.templateVersion = "2.0.0"; }],
  ] as const)("rejects contradictory present %s proof in a partial incomplete submission", (_proof, corrupt) => {
    const { authority, project, taskId, tasks } = candidateFixture();
    const attempt = authority.startAttempt({ taskId, projectId: project.projectId });
    const evidence = evidenceFor(attempt, false, tasks);
    corrupt(evidence);
    const partial: EvidenceSubmission = evidence;
    delete partial.browserProof;

    expect(() => authority.sealAttemptEvidence(partial)).toThrow("Evidence");
    expect(authority.getAttempt(attempt.attemptId).state).toBe("running");
  });

  it("rejects MCP audit evidence that contradicts the authoritative Run audit event", () => {
    const { authority, project, taskId, tasks } = candidateFixture();
    const attempt = authority.startAttempt({ taskId, projectId: project.projectId });
    const evidence = evidenceFor(attempt, false, tasks);
    evidence.mcpAudit.calls[0]!.tool = "gameforge.generate_project";

    expect(() => authority.sealAttemptEvidence(evidence)).toThrow("authoritative MCP audit");
  });

  it("rejects MCP audit session and timestamp provenance that contradicts the authoritative digest", () => {
    const { authority, project, taskId, tasks } = candidateFixture();
    const attempt = authority.startAttempt({ taskId, projectId: project.projectId });
    const evidence = evidenceFor(attempt, false, tasks);
    evidence.mcpAudit.sessionId = "22222222-2222-4222-8222-222222222222";
    evidence.mcpAudit.startedAt = "2026-07-29T00:00:00.001Z";
    evidence.mcpAudit.context!.boundAt = "2026-07-29T00:00:00.002Z";
    evidence.mcpAudit.calls[0]!.startedAt = "2026-07-29T00:00:00.003Z";

    expect(() => authority.sealAttemptEvidence(evidence)).toThrow("authoritative MCP audit");
  });

  it("rejects authoritative MCP audit publication for an unknown Attempt", () => {
    const { authority, project, taskId, tasks } = candidateFixture();
    const attempt = authority.startAttempt({ taskId, projectId: project.projectId });

    expect(() => evidenceFor(attempt, false, tasks, {
      authoritativeAuditAttemptId: "attempt-99999999-9999-4999-8999-999999999999",
    })).toThrow(expect.objectContaining({ code: "attempt_not_found" }));
    expect(authority.getAttempt(attempt.attemptId).state).toBe("running");
  });

  it("rejects criterion results that contradict authoritative verification", () => {
    const { authority, project, taskId, tasks } = candidateFixture();
    const attempt = authority.startAttempt({ taskId, projectId: project.projectId });
    const evidence = evidenceFor(attempt, false, tasks, { authoritativeCriterionPassed: false });

    expect(() => authority.sealAttemptEvidence(evidence)).toThrow("authoritative verification");
  });

  it("rejects a self-consistent artifact manifest that differs from the authoritative candidate", () => {
    const { authority, project, taskId, tasks } = candidateFixture();
    const attempt = authority.startAttempt({ taskId, projectId: project.projectId });
    const evidence = evidenceFor(attempt, false, tasks);
    evidence.artifacts!.files[0]!.sha256 = "c".repeat(64);
    evidence.artifacts!.aggregateSha256 = createHash("sha256")
      .update(JSON.stringify(evidence.artifacts!.files))
      .digest("hex");

    expect(() => authority.sealAttemptEvidence(evidence)).toThrow("authoritative candidate");
    expect(authority.getAttempt(attempt.attemptId).state).toBe("running");
  });

  it.each(["actions", "diagnostics", "screenshots", "screenshot-digest", "outcome"] as const)(
    "rejects browser Evidence whose %s differ from authoritative verification",
    (field) => {
      const { authority, project, taskId, tasks } = candidateFixture();
      const attempt = authority.startAttempt({ taskId, projectId: project.projectId });
      const evidence = evidenceFor(attempt, false, tasks);
      if (field === "actions") evidence.browserProof.actions = ["click:other"];
      if (field === "diagnostics") evidence.browserProof.diagnostics = ["fabricated diagnostic"];
      if (field === "screenshots") {
        evidence.browserProof.screenshots = [".gameforge/verification/other.png"];
      }
      if (field === "screenshot-digest") evidence.browserProof.screenshotSha256 = "f".repeat(64);
      if (field === "outcome") {
        evidence.browserProof.passed = false;
        evidence.browserProof.outcome = "lost";
      }

      expect(() => authority.sealAttemptEvidence(evidence)).toThrow("authoritative verification");
      expect(authority.getAttempt(attempt.attemptId).state).toBe("running");
    },
  );

  it("binds winning Evidence to its matching verification before a later loss scenario", () => {
    const { authority, project, taskId, tasks } = candidateFixture();
    const attempt = authority.startAttempt({ taskId, projectId: project.projectId });
    const evidence = evidenceFor(attempt, false, tasks, { latestVerificationFailed: true });

    expect(authority.sealAttemptEvidence(evidence)).toMatchObject({ status: "sealed" });
    expect(authority.getAttempt(attempt.attemptId)).toMatchObject({ state: "passed" });
  });

  it("persists a terminal failed verification as immutable incomplete Evidence", () => {
    const { authority, project, taskId, tasks } = candidateFixture();
    const attempt = authority.startAttempt({ taskId, projectId: project.projectId });
    const evidence = evidenceFor(attempt, false, tasks, { latestVerificationFailed: true });
    evidence.browserProof.passed = false;
    evidence.browserProof.outcome = "lost";
    evidence.browserProof.screenshots = [".gameforge/verification/proof-lost.png"];
    evidence.browserProof.screenshotSha256 = "f".repeat(64);

    expect(authority.sealAttemptEvidence(evidence)).toEqual({
      status: "incomplete",
      reasonCode: "evidence.missing-required-proof.v1",
      attemptId: attempt.attemptId,
    });
    const stored = authority.getAttempt(attempt.attemptId);
    expect(stored).toMatchObject({
      state: "incomplete",
      incompleteReasonCode: "evidence.missing-required-proof.v1",
    });
    expect(Object.isFrozen(stored)).toBe(true);
    if (stored.state !== "incomplete") throw new Error("expected incomplete Attempt");
    expect(Object.isFrozen(stored.incompleteEvidence.browserProof)).toBe(true);
  });

  it("does not let a retry inherit an earlier Attempt verification", () => {
    const { authority, project, taskId, tasks } = candidateFixture();
    const first = authority.startAttempt({ taskId, projectId: project.projectId });
    const evidence = evidenceFor(first, true, tasks);
    expect(authority.sealAttemptEvidence(evidence).status).toBe("incomplete");
    expect(tasks.transition(taskId, { status: "in-progress", agentId: "codearts" }).outcome).toBe("accepted");
    const retry = authority.retryAttempt({ attemptId: first.attemptId });
    evidence.attemptId = retry.attemptId;
    evidence.revisionId = retry.revisionId;
    evidence.codeArts.attemptId = retry.attemptId;
    evidence.mcpAudit.attemptId = retry.attemptId;
    evidence.artifacts!.attemptId = retry.attemptId;
    evidence.artifacts!.revisionId = retry.revisionId;
    evidence.build.attemptId = retry.attemptId;
    evidence.browserProof.attemptId = retry.attemptId;
    evidence.browserProof.revisionId = retry.revisionId;
    evidence.versions.attemptId = retry.attemptId;
    for (const event of evidence.authorityEvents) event.attemptId = retry.attemptId;

    expect(() => authority.sealAttemptEvidence(evidence)).toThrow("same Attempt");
  });

  it("rejects CodeArts Evidence for a Task claimed by another client", () => {
    const { authority, project, taskId, tasks } = candidateFixture();
    tasks.claim(taskId, { agentId: "opencode" });
    const attempt = authority.startAttempt({ taskId, projectId: project.projectId });
    const evidence = evidenceFor(attempt, false, tasks);

    expect(() => authority.sealAttemptEvidence(evidence)).toThrow("CodeArts claimant");
  });

  it("rejects Evidence whose contract version is not authoritative for the Task", () => {
    const { authority, project, taskId, tasks } = candidateFixture();
    const attempt = authority.startAttempt({ taskId, projectId: project.projectId });
    const evidence = evidenceFor(attempt, false, tasks);
    evidence.versions.contractVersion = 999;

    expect(() => authority.sealAttemptEvidence(evidence)).toThrow("version proof does not match authoritative verification");
  });

  it("rejects Evidence whose template version is not the authoritative generator version", () => {
    const { authority, project, taskId, tasks } = candidateFixture();
    const attempt = authority.startAttempt({ taskId, projectId: project.projectId });
    const evidence = evidenceFor(attempt, false, tasks, { authoritativeVerificationTemplateVersion: "9.9.9" });

    expect(() => authority.sealAttemptEvidence(evidence)).toThrow("version proof does not match authoritative verification");
  });

  it("rejects build proof that was not emitted by authoritative verification", () => {
    const { authority, project, taskId, tasks } = candidateFixture();
    const attempt = authority.startAttempt({ taskId, projectId: project.projectId });
    const evidence = evidenceFor(attempt, false, tasks);
    evidence.build.report.metrics.files[0]!.raw = 91;
    evidence.build.report.metrics.files[0]!.gzip = 46;
    evidence.build.report.metrics.initial = { raw: 91, gzip: 46 };
    evidence.build.report.metrics.total = { raw: 91, gzip: 46 };

    expect(() => authority.sealAttemptEvidence(evidence)).toThrow("build proof");
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

function restoreWithCurrentRevision(
  currentRevisionId: string,
  revisions: Array<{
    projectId: string;
    revisionId: string;
    state: "candidate";
    acceptanceContractFingerprint: string;
  }>,
): void {
  const tasks = new TaskInbox(new RunStore());
  const projectId = "project-00000000-0000-4000-8000-000000000065";
  const otherProjectId = "project-00000000-0000-4000-8000-000000000066";
  const task = tasks.create({
    runId: "run-restore-current-revision",
    prompt: "Restore only internally consistent Project state.",
    language: "en-US",
    projectId: otherProjectId,
  });
  const authority = new ProjectAuthority(tasks);
  authority.restore({
    projects: [
      { projectId, currentRevisionId },
      { projectId: otherProjectId, currentRevisionId: null },
    ],
    revisions: revisions.map((revision) => ({ ...revision, taskId: task.task.taskId })),
    attempts: [],
    retriedAttemptIds: [],
  });
}

function candidateFixture() {
  const store = new RunStore();
  const tasks = new TaskInbox(store);
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
  return { authority, project, taskId, tasks, store, contract: result.contract };
}

function evidenceFor(
  attempt: { attemptId: string; taskId: string; projectId: string; revisionId: string; baseRevisionId?: string | undefined; acceptanceContractFingerprint: string },
  incomplete: boolean,
  tasks?: TaskInbox,
  options: {
    authoritativeAuditAttemptId?: string;
    authoritativeCriterionPassed?: boolean;
    authoritativeVerificationTemplateVersion?: string;
    latestVerificationFailed?: boolean;
    leaveRunOpen?: boolean;
    includeUnexpectedCriterion?: boolean;
  } = {},
): EvidenceAggregateInput {
  const normalized = "Create a browser game candidate against frozen acceptance criteria.";
  const files = [{ path: "dist/index.js", bytes: 1, sha256: "b".repeat(64) }];
  const metrics = {
    initial: { raw: 90, gzip: 45 },
    async: { raw: 0, gzip: 0 },
    total: { raw: 90, gzip: 45 },
    files: [{ path: "dist/index.js", phase: "initial" as const, raw: 90, gzip: 45 }],
  };
  const build = {
    attemptId: attempt.attemptId,
    command: "vite.build" as const,
    exitCode: 0 as const,
    report: { metrics, limits: webGameBundleLimits, issues: bundleBudgetIssues(metrics, webGameBundleLimits) },
  };
  const versions = {
    attemptId: attempt.attemptId,
    contractVersion: 1,
    templateVersion: options.authoritativeVerificationTemplateVersion ?? "1.0.0",
  };
  const runId = tasks?.get(attempt.taskId).runId ?? "run-project-fixture";
  const mcpAudit = {
    schemaVersion: 1 as const,
    sessionId: "11111111-1111-4111-8111-111111111111",
    startedAt: "2026-07-29T00:00:00.000Z",
    truncated: incomplete,
    context: {
      taskId: attempt.taskId,
      runId,
      attemptId: attempt.attemptId,
      boundAt: "2026-07-29T00:00:00.000Z",
    },
    calls: [{
      sequence: 1,
      tool: "gameforge.verify",
      startedAt: "2026-07-29T00:00:00.000Z",
      durationMs: 1,
      outcome: "success" as const,
    }],
  };
  if (tasks !== undefined) {
    if (tasks.get(attempt.taskId).status === "queued") tasks.claim(attempt.taskId, { agentId: "codearts" });
    tasks.appendRun(runId, {
      runId,
      after: 1,
      events: [{
        type: "project.generated",
        runId,
        sequence: 2,
        emittedAt: "2026-07-29T00:00:01.000Z",
        attemptId: attempt.attemptId,
        revisionId: attempt.revisionId,
        mode: "apply",
        operation: "create",
        plan: {
          generatorVersion: "1.0.0",
          projectId: attempt.projectId,
          target: "web",
          specSha256: "a".repeat(64),
          planSha256: "d".repeat(64),
          files,
        },
        candidate: {
          schemaVersion: 1,
          projectId: attempt.projectId,
          attemptId: attempt.attemptId,
          revisionId: attempt.revisionId,
          totalBytes: 1,
          files,
          aggregateSha256: createHash("sha256").update(JSON.stringify(files)).digest("hex"),
        },
      }, {
        type: "mcp.audit.ready",
        runId,
        sequence: 3,
        emittedAt: "2026-07-29T00:00:01.000Z",
        attemptId: options.authoritativeAuditAttemptId ?? attempt.attemptId,
        auditDigest: mcpToolAuditDigest(mcpAudit),
        truncated: incomplete,
        totalCalls: 1,
        calls: [{ sequence: 1, tool: "gameforge.verify", durationMs: 1, outcome: "success" }],
      }, {
        type: "verification.ready",
        runId,
        sequence: 4,
        emittedAt: "2026-07-29T00:00:01.000Z",
        attemptId: attempt.attemptId,
        revisionId: attempt.revisionId,
        projectId: attempt.projectId,
        passed: true,
        outcome: "won",
        score: 1,
        lives: 1,
        remainingSeconds: 1,
        evidencePath: ".gameforge/verification/proof.png",
        evidenceSha256: "e".repeat(64),
        canvas: { width: 960, height: 540 },
        diagnostics: { consoleErrors: 0, pageErrors: 0, failedRequests: 0 },
        actionsExecuted: 1,
        durationMs: 1,
        actions: ["click:start"],
        diagnosticMessages: [],
        evidencePaths: [".gameforge/verification/proof.png"],
        criteria: [
          { criterionId: "star-goal", passed: options.authoritativeCriterionPassed ?? true },
          ...(options.includeUnexpectedCriterion
            ? [{ criterionId: "unexpected-goal", passed: true }]
            : []),
        ],
        build,
        versions,
      }, ...(options.latestVerificationFailed ? [{
        type: "verification.ready" as const,
        runId,
        sequence: 5,
        emittedAt: "2026-07-29T00:00:02.000Z",
        attemptId: attempt.attemptId,
        revisionId: attempt.revisionId,
        projectId: attempt.projectId,
        passed: false,
        outcome: "lost" as const,
        score: 1,
        lives: 0,
        remainingSeconds: 0,
        evidencePath: ".gameforge/verification/proof-lost.png",
        evidenceSha256: "f".repeat(64),
        canvas: { width: 960, height: 540 },
        diagnostics: { consoleErrors: 0, pageErrors: 0, failedRequests: 0 },
        actionsExecuted: 1,
        durationMs: 1,
        actions: ["click:start"],
        diagnosticMessages: [],
        evidencePaths: [".gameforge/verification/proof-lost.png"],
        criteria: [{ criterionId: "star-goal", passed: true }],
        build,
        versions,
      }] : [])],
    });
    if (options.leaveRunOpen !== true) tasks.finishRun(runId, "run.completed");
  }
  const authorityEvents = tasks === undefined
    ? [{ attemptId: attempt.attemptId, event: { runId: "run-project-fixture", sequence: 1, emittedAt: "2026-07-29T00:00:01.000Z", type: "run.completed" as const } }]
    : tasks.authoritativeRunEvents(runId).map((event) => ({
      attemptId: attempt.attemptId,
      event: structuredClone(event),
    }));
  return {
    attemptId: attempt.attemptId,
    taskId: attempt.taskId,
    runId,
    projectId: attempt.projectId,
    baseRevisionId: attempt.baseRevisionId ?? null,
    revisionId: attempt.revisionId,
    acceptanceContractFingerprint: attempt.acceptanceContractFingerprint,
    criterionResults: [
      { criterionId: "star-goal", passed: true },
      ...(options.includeUnexpectedCriterion
        ? [{ criterionId: "unexpected-goal", passed: true }]
        : []),
    ],
    request: { normalized, fingerprint: createHash("sha256").update(normalized).digest("hex") },
    codeArts: { attemptId: attempt.attemptId, target: "GLM", clientVersion: "1.0.0", durationMs: 1, interventions: [] },
    mcpAudit: { attemptId: attempt.attemptId, ...mcpAudit },
    artifacts: { schemaVersion: 1, projectId: attempt.projectId, attemptId: attempt.attemptId, revisionId: attempt.revisionId, totalBytes: 1, files, aggregateSha256: createHash("sha256").update(JSON.stringify(files)).digest("hex") },
    build,
    browserProof: { attemptId: attempt.attemptId, projectId: attempt.projectId, revisionId: attempt.revisionId, passed: true, actions: ["click:start"], outcome: "won", diagnostics: [], screenshots: [".gameforge/verification/proof.png"], screenshotSha256: "e".repeat(64) },
    authorityEvents,
    versions,
  };
}
