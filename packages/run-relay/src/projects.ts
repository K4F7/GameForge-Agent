import {
  attemptIdSchema,
  attemptSchema,
  candidateRevisionSchema,
  candidateAcceptanceValiditySchema,
  evidenceAggregateInputSchema,
  evidenceSubmissionSchema,
  mcpToolAuditDigest,
  createCandidateRevisionInputSchema,
  createProjectInputSchema,
  projectIdSchema,
  projectSchema,
  revisionIdSchema,
  retryAttemptInputSchema,
  runEventBatchSchema,
  startAttemptInputSchema,
  type Attempt,
  type CandidateRevision,
  type CandidateAcceptanceValidity,
  type CreateCandidateRevisionInput,
  type CreateProjectInput,
  type Project,
  type RetryAttemptInput,
  type StartAttemptInput,
  type EvidenceAggregateInput,
  type EvidenceSubmission,
  type EvidenceSealResult,
  type GameTask,
  type WireRunEvent,
  sealEvidence,
} from "@gameforge/contracts";
import { createHash, randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type { TaskInbox } from "./tasks.js";

export class ProjectAuthorityError extends Error {
  constructor(
    readonly code:
      | "project_not_found"
      | "revision_not_found"
      | "acceptance_contract_not_frozen"
      | "task_project_mismatch"
      | "revision_project_mismatch"
      | "attempt_not_found"
      | "stale_base_revision"
      | "acceptance_contract_changed"
      | "attempt_already_started"
      | "attempt_already_retried"
      | "attempt_not_incomplete"
      | "task_not_retryable"
      | "attempt_already_sealed"
      | "evidence_attempt_mismatch",
    message: string,
  ) {
    super(message);
    this.name = "ProjectAuthorityError";
  }
}

export type ProjectAuthoritySnapshot = {
  projects: Project[];
  revisions: CandidateRevision[];
  attempts: Attempt[];
  retriedAttemptIds: string[];
};

export class ProjectAuthority {
  readonly #projects = new Map<string, Project>();
  readonly #revisions = new Map<string, CandidateRevision>();
  readonly #attempts = new Map<string, Attempt>();
  readonly #retriedAttemptIds = new Set<string>();

  constructor(
    readonly taskAuthority: Pick<
      TaskInbox,
      "get" | "acceptanceContract" | "isAcceptanceFingerprintCurrent" | "authoritativeRunEvents" |
      "prepareRetryRun" | "registerRunEventAppendGuard"
      | "registerTaskCompletionGuard"
    >,
  ) {
    this.taskAuthority.registerRunEventAppendGuard((batch) => this.#assertProducerEvidenceWritable(batch));
    this.taskAuthority.registerTaskCompletionGuard((task) => this.#hasPassedAttemptForTask(task));
  }

  createProject(input: CreateProjectInput): Project {
    createProjectInputSchema.parse(input);
    const project = projectSchema.parse({
      projectId: `project-${randomUUID()}`,
      currentRevisionId: null,
    });
    this.#projects.set(project.projectId, project);
    return projectSchema.parse(project);
  }

  getProject(projectIdInput: string): Project {
    const projectId = projectIdSchema.parse(projectIdInput);
    const project = this.#projects.get(projectId);
    if (project === undefined) {
      throw new ProjectAuthorityError("project_not_found", `Unknown Project: ${projectId}`);
    }
    return projectSchema.parse(project);
  }

  createCandidateRevision(input: CreateCandidateRevisionInput): CandidateRevision {
    const request = createCandidateRevisionInputSchema.parse(input);
    this.getProject(request.projectId);
    const task = this.taskAuthority.get(request.taskId);
    if (task.projectId !== undefined && task.projectId !== request.projectId) {
      throw new ProjectAuthorityError(
        "task_project_mismatch",
        `Task ${task.taskId} belongs to Project ${task.projectId}, not ${request.projectId}.`,
      );
    }
    const contract = this.taskAuthority.acceptanceContract(request.taskId);
    if (contract === undefined) {
      throw new ProjectAuthorityError(
        "acceptance_contract_not_frozen",
        "Candidate Revision requires a frozen acceptance contract.",
      );
    }
    const revision = candidateRevisionSchema.parse({
      projectId: request.projectId,
      taskId: request.taskId,
      revisionId: `revision-${randomUUID()}`,
      state: "candidate",
      acceptanceContractFingerprint: contract.fingerprint,
    });
    this.#revisions.set(revision.revisionId, revision);
    return candidateRevisionSchema.parse(revision);
  }

  getRevision(revisionIdInput: string): CandidateRevision {
    const revisionId = revisionIdSchema.parse(revisionIdInput);
    const revision = this.#revisions.get(revisionId);
    if (revision === undefined) {
      throw new ProjectAuthorityError("revision_not_found", `Unknown Revision: ${revisionId}`);
    }
    return candidateRevisionSchema.parse(revision);
  }

  getCandidateAcceptanceValidity(revisionIdInput: string): CandidateAcceptanceValidity {
    const revision = this.getRevision(revisionIdInput);
    return candidateAcceptanceValiditySchema.parse({
      revisionId: revision.revisionId,
      taskId: revision.taskId,
      acceptanceContractFingerprint: revision.acceptanceContractFingerprint,
      valid: this.taskAuthority.isAcceptanceFingerprintCurrent(
        revision.taskId,
        revision.acceptanceContractFingerprint,
      ),
    });
  }

  startAttempt(input: StartAttemptInput): Attempt {
    const request = startAttemptInputSchema.parse(input);
    const project = this.getProject(request.projectId);
    const contract = this.#currentTaskContract(request.taskId, request.projectId);
    const previous = this.#attemptForTask(request.taskId);
    if (previous !== undefined &&
      project.currentRevisionId === (previous.baseRevisionId ?? null) &&
      contract.fingerprint === previous.acceptanceContractFingerprint) {
      if (previous.projectId === request.projectId && previous.state === "running") {
        return this.getAttempt(previous.attemptId);
      }
      throw new ProjectAuthorityError(
        "attempt_already_started",
        `Task ${request.taskId} already has an Attempt; use explicit retry.`,
      );
    }
    if (previous !== undefined) this.taskAuthority.prepareRetryRun(request.taskId);
    const attempt = this.#createAttempt({
      ...request,
      ...(project.currentRevisionId === null ? {} : { baseRevisionId: project.currentRevisionId }),
      acceptanceContractFingerprint: contract.fingerprint,
    });
    return attempt;
  }

  #createAttempt(request: Omit<Attempt, "attemptId" | "runId" | "revisionId" | "state">): Attempt {
    this.getProject(request.projectId);
    if (request.baseRevisionId !== undefined) {
      const baseRevision = this.getRevision(request.baseRevisionId);
      if (baseRevision.projectId !== request.projectId) {
        throw new ProjectAuthorityError(
          "revision_project_mismatch",
          `Revision ${baseRevision.revisionId} does not belong to Project ${request.projectId}.`,
        );
      }
    }
    const candidate = this.createCandidateRevision({
      projectId: request.projectId,
      taskId: request.taskId,
    });
    const attempt = attemptSchema.parse({
      attemptId: `attempt-${randomUUID()}`,
      ...request,
      runId: this.taskAuthority.get(request.taskId).runId,
      revisionId: candidate.revisionId,
      state: "running",
    });
    this.#attempts.set(attempt.attemptId, attempt);
    return attemptSchema.parse(attempt);
  }

  getAttempt(attemptIdInput: string): Attempt {
    const attemptId = attemptIdSchema.parse(attemptIdInput);
    const attempt = this.#attempts.get(attemptId);
    if (attempt === undefined) {
      throw new ProjectAuthorityError("attempt_not_found", `Unknown Attempt: ${attemptId}`);
    }
    return freezeEvidence(attemptSchema.parse(attempt));
  }

  sealAttemptEvidence(input: EvidenceSubmission): EvidenceSealResult {
    input = evidenceSubmissionSchema.parse(input);
    const attempt = this.getAttempt(input.attemptId);
    const task = this.taskAuthority.get(attempt.taskId);
    if (attempt.state !== "running") {
      throw new ProjectAuthorityError(
        "attempt_already_sealed",
        `Attempt ${attempt.attemptId} is already sealed in authoritative state (${attempt.state}).`,
      );
    }
    if (this.#retriedAttemptIds.has(attempt.attemptId)) {
      throw new ProjectAuthorityError(
        "attempt_already_retried",
        `Attempt ${attempt.attemptId} was superseded by an explicit retry.`,
      );
    }
    if (!this.taskAuthority.isAcceptanceFingerprintCurrent(
      attempt.taskId,
      attempt.acceptanceContractFingerprint,
    )) {
      throw new ProjectAuthorityError(
        "acceptance_contract_changed",
        `Attempt ${attempt.attemptId} is not bound to the current acceptance contract.`,
      );
    }
    this.#validateEvidenceAuthority(input, attempt, task);
    const expectedCriterionIds = task.acceptanceContract?.criteria.map((criterion) => criterion.criterionId) ?? [];
    const actualCriterionIds = input.criterionResults?.map((result) => result.criterionId) ?? [];
    const unexpectedCriterionIds = actualCriterionIds.filter((criterionId) => !expectedCriterionIds.includes(criterionId));
    if (unexpectedCriterionIds.length > 0) {
      throw new ProjectAuthorityError(
        "evidence_attempt_mismatch",
        `Evidence contains criteria outside the authoritative contract for Attempt ${attempt.attemptId}.`,
      );
    }
    const missingTopLevelProof = [
      input.criterionResults,
      input.codeArts,
      input.mcpAudit,
      input.artifacts,
      input.build,
      input.browserProof,
      input.authorityEvents,
      input.versions,
    ].some((value) => value === undefined);
    if (missingTopLevelProof) {
      const missingCriterionIds = expectedCriterionIds.filter((criterionId) => !actualCriterionIds.includes(criterionId));
      const incomplete = attemptSchema.parse({
        ...attempt,
        state: "incomplete",
        incompleteReasonCode: "evidence.missing-required-proof.v1",
        incompleteEvidence: input,
        ...(missingCriterionIds.length === 0 ? {} : { missingCriterionIds }),
      });
      this.#attempts.set(attempt.attemptId, freezeEvidence(incomplete));
      return {
        status: "incomplete",
        reasonCode: "evidence.missing-required-proof.v1",
        attemptId: attempt.attemptId,
      };
    }
    const parsedEvidence = evidenceAggregateInputSchema.parse(input);
    const result = sealEvidence(parsedEvidence);
    if (parsedEvidence.versions.contractVersion !== task.acceptanceContract?.contractVersion) {
      throw new ProjectAuthorityError(
        "evidence_attempt_mismatch",
        `Evidence contract version does not match the authoritative Task contract for Attempt ${attempt.attemptId}.`,
      );
    }
    const missingCriterionIds = expectedCriterionIds.filter((criterionId) => !actualCriterionIds.includes(criterionId));
    if (
      expectedCriterionIds.length !== actualCriterionIds.length ||
      missingCriterionIds.length > 0
    ) {
      const incomplete = attemptSchema.parse({
        ...attempt,
        state: "incomplete",
        incompleteReasonCode: "evidence.missing-required-proof.v1",
        incompleteEvidence: parsedEvidence,
        ...(missingCriterionIds.length === 0 ? {} : { missingCriterionIds }),
      });
      this.#attempts.set(attempt.attemptId, freezeEvidence(incomplete));
      return {
        status: "incomplete",
        reasonCode: "evidence.missing-required-proof.v1",
        attemptId: attempt.attemptId,
      };
    }
    if (result.status === "incomplete") {
      const updated = attemptSchema.parse({
        ...attempt,
        state: "incomplete",
        incompleteReasonCode: result.reasonCode,
        incompleteEvidence: parsedEvidence,
      });
      this.#attempts.set(attempt.attemptId, freezeEvidence(updated));
      return result;
    }
    const updated = attemptSchema.parse({
      ...attempt,
      state: "passed",
      sealedDigest: result.evidence.digest,
      sealedEvidence: result.evidence,
    });
    this.#attempts.set(attempt.attemptId, freezeEvidence(updated));
    return result;
  }

  #validateSubmittedEvidence(
    input: EvidenceSubmission,
    attempt: Attempt,
    allowedTerminalSuffix?: "run.completed" | "run.stopped",
  ): void {
    const mismatch = (detail: string): never => {
      throw new ProjectAuthorityError(
        "evidence_attempt_mismatch",
        `${detail} for Attempt ${attempt.attemptId}.`,
      );
    };
    const expectedFingerprint = createHash("sha256").update(input.request.normalized, "utf8").digest("hex");
    if (input.request.fingerprint !== expectedFingerprint) mismatch("Evidence request fingerprint does not match");
    const nestedAttemptIds = [
      input.codeArts?.attemptId,
      input.mcpAudit?.attemptId,
      input.artifacts?.attemptId,
      input.build?.attemptId,
      input.browserProof?.attemptId,
      input.versions?.attemptId,
      ...(input.authorityEvents ?? []).flatMap(({ attemptId, event }) => [
        attemptId,
        ...(isProducerEvent(event)
          ? producerAttemptIds(event)
          : ["attemptId" in event ? event.attemptId : undefined]),
      ]),
    ].filter((value): value is string => value !== undefined);
    if (nestedAttemptIds.some((attemptId) => attemptId !== attempt.attemptId)) {
      mismatch("Evidence proof does not belong to the same Attempt");
    }
    if (input.mcpAudit !== undefined && (
      input.mcpAudit.context?.taskId !== attempt.taskId ||
      input.mcpAudit.context.runId !== input.runId
    )) mismatch("MCP Audit does not belong to the same Task and Run");
    if (input.artifacts !== undefined && (
      input.artifacts.projectId !== attempt.projectId || input.artifacts.revisionId !== attempt.revisionId
    )) mismatch("Artifact proof does not belong to the same Project and Revision");
    if (input.browserProof !== undefined && (
      input.browserProof.projectId !== attempt.projectId || input.browserProof.revisionId !== attempt.revisionId
    )) mismatch("Browser proof does not belong to the same Project and Revision");
    const submittedEvents = input.authorityEvents?.map(({ event }) => event);
    if (submittedEvents?.some((event) =>
      isProducerEvent(event) && !producerEventBelongsToAttempt(event, attempt)) === true) {
      mismatch("Authority producer event identities do not belong to the same Attempt");
    }
    if (submittedEvents !== undefined && submittedEvents.some((event, index) =>
      event.runId !== input.runId || event.sequence !== index + 1)) {
      mismatch("Authority proof does not belong to the same Run");
    }
    if (submittedEvents !== undefined && submittedEvents.length > 0 &&
        !matchesAuthoritativeHistory(
          submittedEvents,
          this.taskAuthority.authoritativeRunEvents(input.runId),
          allowedTerminalSuffix,
        )) {
      mismatch("Evidence does not match the authoritative Run history");
    }

    const authoritativeEvents = this.taskAuthority.authoritativeRunEvents(input.runId);
    const authoritativeVerifications = authoritativeEvents
      .filter((event): event is Extract<WireRunEvent, { type: "verification.ready" }> =>
        event.type === "verification.ready" &&
        event.attemptId === attempt.attemptId && event.revisionId === attempt.revisionId &&
        event.projectId === attempt.projectId);
    const browserProof = input.browserProof;
    const authoritativeVerification = browserProof === undefined
      ? authoritativeVerifications.at(-1)
      : [...authoritativeVerifications].reverse()
        .find((event) => verificationMatchesBrowserProof(event, browserProof));
    if (browserProof !== undefined) {
      if (authoritativeVerification === undefined ||
          !verificationMatchesBrowserProof(authoritativeVerification, browserProof)) {
        mismatch("Evidence browser proof does not match authoritative verification");
      }
    }
    if (input.build !== undefined && input.build.report.metrics.files.length > 0 &&
        input.build.report.metrics.total.raw > 0 &&
        (authoritativeVerification === undefined || !isDeepStrictEqual(authoritativeVerification.build, input.build))) {
      mismatch("Evidence build proof does not match authoritative verification");
    }
    if (input.versions !== undefined) {
      const contract = this.taskAuthority.acceptanceContract(attempt.taskId);
      const authoritativeCandidate = [...authoritativeEvents].reverse()
        .find((event): event is Extract<WireRunEvent, { type: "project.generated" }> =>
          event.type === "project.generated" && event.mode === "apply" &&
          event.attemptId === attempt.attemptId && event.revisionId === attempt.revisionId &&
          event.candidate?.projectId === attempt.projectId);
      if (input.versions.contractVersion !== contract?.contractVersion ||
          authoritativeVerification === undefined ||
          !isDeepStrictEqual(authoritativeVerification.versions, input.versions) ||
          authoritativeCandidate?.plan.generatorVersion !== input.versions.templateVersion) {
        mismatch("Evidence version proof does not match authoritative verification and generator");
      }
    }
    if (input.artifacts !== undefined) {
      const authoritativeCandidate = [...authoritativeEvents].reverse()
        .find((event): event is Extract<WireRunEvent, { type: "project.generated" }> =>
          event.type === "project.generated" && event.mode === "apply" &&
          event.attemptId === attempt.attemptId && event.revisionId === attempt.revisionId &&
          event.candidate?.projectId === attempt.projectId);
      if (authoritativeCandidate?.candidate === undefined ||
          !isDeepStrictEqual(authoritativeCandidate.candidate, input.artifacts)) {
        mismatch("Evidence artifacts do not match the authoritative candidate");
      }
    }
    if (input.mcpAudit !== undefined && input.mcpAudit.calls.length > 0) {
      const authoritativeAudit = [...authoritativeEvents].reverse()
        .find((event): event is Extract<WireRunEvent, { type: "mcp.audit.ready" }> =>
          event.type === "mcp.audit.ready" && event.attemptId === attempt.attemptId);
      const submittedAuditCalls = input.mcpAudit.calls.map(({ sequence, tool, durationMs, outcome }) => ({
        sequence,
        tool,
        durationMs,
        outcome,
      }));
      const { attemptId: _submittedAuditAttemptId, ...submittedAudit } = input.mcpAudit;
      if (authoritativeAudit === undefined ||
          authoritativeAudit.auditDigest !== mcpToolAuditDigest(submittedAudit) ||
          authoritativeAudit.truncated !== input.mcpAudit.truncated ||
          authoritativeAudit.totalCalls !== input.mcpAudit.calls.length ||
          !isDeepStrictEqual(authoritativeAudit.calls, submittedAuditCalls)) {
        mismatch("Evidence does not match the authoritative MCP audit");
      }
    }
    if (input.criterionResults !== undefined && input.criterionResults.length > 0 &&
        (authoritativeVerification?.criteria === undefined ||
          !isDeepStrictEqual(authoritativeVerification.criteria, input.criterionResults))) {
      mismatch("Evidence criterion results do not match authoritative verification");
    }
  }

  #validateEvidenceAuthority(
    input: unknown,
    attempt: Attempt,
    task = this.taskAuthority.get(attempt.taskId),
    allowedTerminalSuffix?: "run.completed" | "run.stopped",
  ): void {
    const submission = evidenceSubmissionSchema.parse(input);
    if (
      submission.taskId !== attempt.taskId ||
      submission.projectId !== attempt.projectId ||
      submission.revisionId !== attempt.revisionId ||
      submission.baseRevisionId !== (attempt.baseRevisionId ?? null) ||
      submission.acceptanceContractFingerprint !== attempt.acceptanceContractFingerprint ||
      submission.runId !== attempt.runId
    ) {
      throw new ProjectAuthorityError(
        "evidence_attempt_mismatch",
        `Evidence does not belong to Attempt ${attempt.attemptId}.`,
      );
    }
    if (submission.request.normalized !== task.prompt) {
      throw new ProjectAuthorityError(
        "evidence_attempt_mismatch",
        `Evidence request does not match the authoritative Task prompt for Attempt ${attempt.attemptId}.`,
      );
    }
    if (task.claimedBy !== "codearts") {
      throw new ProjectAuthorityError(
        "evidence_attempt_mismatch",
        `Attempt ${attempt.attemptId} requires an authoritative CodeArts claimant.`,
      );
    }
    this.#validateSubmittedEvidence(submission, attempt, allowedTerminalSuffix);
  }

  retryAttempt(input: RetryAttemptInput): Attempt {
    const request = retryAttemptInputSchema.parse(input);
    const previous = this.getAttempt(request.attemptId);
    if (this.#retriedAttemptIds.has(previous.attemptId)) {
      throw new ProjectAuthorityError(
        "attempt_already_retried",
        `Attempt ${previous.attemptId} already has an explicit retry.`,
      );
    }
    if (previous.state !== "incomplete") {
      throw new ProjectAuthorityError(
        "attempt_not_incomplete",
        `Attempt ${previous.attemptId} must be incomplete before retry.`,
      );
    }
    const task = this.taskAuthority.get(previous.taskId);
    if (task.status !== "in-progress" || task.claimedBy !== "codearts") {
      throw new ProjectAuthorityError(
        "task_not_retryable",
        `Task ${task.taskId} must be active under CodeArts before retry.`,
      );
    }
    const project = this.getProject(previous.projectId);
    if (project.currentRevisionId !== (previous.baseRevisionId ?? null)) {
      throw new ProjectAuthorityError(
        "stale_base_revision",
        `Attempt ${previous.attemptId} is not based on the current Project Revision.`,
      );
    }
    const contract = this.#currentTaskContract(previous.taskId, previous.projectId);
    if (contract.fingerprint !== previous.acceptanceContractFingerprint) {
      throw new ProjectAuthorityError(
        "acceptance_contract_changed",
        `Attempt ${previous.attemptId} is not bound to the current acceptance contract.`,
      );
    }
    this.taskAuthority.prepareRetryRun(previous.taskId);
    const retry = this.#createAttempt({
      taskId: previous.taskId,
      projectId: previous.projectId,
      ...(previous.baseRevisionId === undefined ? {} : { baseRevisionId: previous.baseRevisionId }),
      acceptanceContractFingerprint: previous.acceptanceContractFingerprint,
    });
    this.#retriedAttemptIds.add(previous.attemptId);
    return retry;
  }

  snapshot(): ProjectAuthoritySnapshot {
    return {
      projects: [...this.#projects.values()].map((project) => projectSchema.parse(project)),
      revisions: [...this.#revisions.values()].map((revision) => candidateRevisionSchema.parse(revision)),
      attempts: [...this.#attempts.values()].map((attempt) => attemptSchema.parse(attempt)),
      retriedAttemptIds: [...this.#retriedAttemptIds],
    };
  }

  restore(snapshot: ProjectAuthoritySnapshot): void {
    if (this.#projects.size > 0 || this.#revisions.size > 0 || this.#attempts.size > 0 ||
        this.#retriedAttemptIds.size > 0) {
      throw new Error("Project Authority can only restore into an empty instance.");
    }
    for (const input of snapshot.projects) {
      const project = projectSchema.parse(input);
      if (this.#projects.has(project.projectId)) throw new Error(`Project snapshot contains a duplicate Project: ${project.projectId}`);
      this.#projects.set(project.projectId, project);
    }
    for (const input of snapshot.revisions) {
      const revision = candidateRevisionSchema.parse(input);
      if (this.#revisions.has(revision.revisionId)) throw new Error(`Project snapshot contains a duplicate Revision: ${revision.revisionId}`);
      const project = this.#projects.get(revision.projectId);
      if (project === undefined) throw new Error(`Project snapshot Revision references an unknown Project: ${revision.projectId}`);
      const task = this.taskAuthority.get(revision.taskId);
      if (task.projectId !== undefined && task.projectId !== revision.projectId) {
        throw new Error(`Project snapshot Revision references a Task from another Project: ${revision.taskId}`);
      }
      this.#revisions.set(revision.revisionId, revision);
    }
    for (const project of this.#projects.values()) {
      if (project.currentRevisionId === null) continue;
      const currentRevision = this.#revisions.get(project.currentRevisionId);
      if (currentRevision === undefined) {
        throw new Error(`Project snapshot current Revision is missing: ${project.currentRevisionId}`);
      }
      if (currentRevision.projectId !== project.projectId) {
        throw new Error(`Project snapshot current Revision belongs to another Project: ${project.currentRevisionId}`);
      }
    }
    for (const input of snapshot.attempts) {
      const attempt = attemptSchema.parse(input);
      if (this.#attempts.has(attempt.attemptId)) throw new Error(`Project snapshot contains a duplicate Attempt: ${attempt.attemptId}`);
      if (!this.#projects.has(attempt.projectId)) throw new Error(`Project snapshot Attempt references an unknown Project: ${attempt.projectId}`);
      const revision = this.#revisions.get(attempt.revisionId);
      if (revision === undefined || revision.projectId !== attempt.projectId || revision.taskId !== attempt.taskId ||
          revision.acceptanceContractFingerprint !== attempt.acceptanceContractFingerprint) {
        throw new Error(`Project snapshot Attempt references an inconsistent candidate Revision: ${attempt.revisionId}`);
      }
      if (attempt.baseRevisionId !== undefined) {
        const base = this.#revisions.get(attempt.baseRevisionId);
        if (base === undefined || base.projectId !== attempt.projectId) {
          throw new Error(`Project snapshot Attempt references an invalid base Revision: ${attempt.baseRevisionId}`);
        }
      }
      const task = this.taskAuthority.get(attempt.taskId);
      if (attempt.state === "passed") {
        const { digest: _digest, status: _status, ...submission } = attempt.sealedEvidence;
        this.#validateEvidenceAuthority(submission, attempt, task, "run.completed");
      } else if (attempt.state === "incomplete") {
        this.#validateEvidenceAuthority(attempt.incompleteEvidence, attempt, task, "run.stopped");
      }
      this.#attempts.set(attempt.attemptId, freezeEvidence(attempt));
    }
    for (const attemptIdInput of snapshot.retriedAttemptIds) {
      const attemptId = attemptIdSchema.parse(attemptIdInput);
      if (!this.#attempts.has(attemptId)) throw new Error(`Project snapshot retry references an unknown Attempt: ${attemptId}`);
      if (this.#retriedAttemptIds.has(attemptId)) throw new Error(`Project snapshot contains a duplicate retry: ${attemptId}`);
      this.#retriedAttemptIds.add(attemptId);
    }
  }

  replace(snapshot: ProjectAuthoritySnapshot): void {
    this.#projects.clear();
    this.#revisions.clear();
    this.#attempts.clear();
    this.#retriedAttemptIds.clear();
    this.restore(snapshot);
  }

  #currentTaskContract(taskId: string, projectId: string) {
    const task = this.taskAuthority.get(taskId);
    if (task.projectId !== undefined && task.projectId !== projectId) {
      throw new ProjectAuthorityError(
        "task_project_mismatch",
        `Task ${task.taskId} belongs to Project ${task.projectId}, not ${projectId}.`,
      );
    }
    const contract = this.taskAuthority.acceptanceContract(taskId);
    if (contract === undefined) {
      throw new ProjectAuthorityError(
        "acceptance_contract_not_frozen",
        "Attempt requires a frozen acceptance contract.",
      );
    }
    return contract;
  }

  #assertProducerEvidenceWritable(batchInput: unknown): void {
    const batch = runEventBatchSchema.parse(batchInput);
    for (const event of batch.events) {
      if (event.type !== "project.generated" && event.type !== "mcp.audit.ready" &&
          event.type !== "verification.ready") continue;
      const attemptIds = producerAttemptIds(event);
      if (attemptIds.length > 1) {
        throw new ProjectAuthorityError(
          "evidence_attempt_mismatch",
          "Producer Evidence cannot combine multiple Attempt identities.",
        );
      }
      const attempt = attemptIds.length === 0 ? undefined : this.#attempts.get(attemptIds[0]!);
      if (attemptIds.length > 0 && attempt === undefined) {
        throw new ProjectAuthorityError("attempt_not_found", `Unknown Attempt: ${attemptIds[0]}`);
      }
      if (attempt !== undefined && !producerEventBelongsToAttempt(event, attempt)) {
        throw new ProjectAuthorityError(
          "evidence_attempt_mismatch",
          `Producer Evidence identities do not belong to Attempt ${attempt.attemptId}.`,
        );
      }
      const terminalAttempt = attemptIds.map((attemptId) => this.#attempts.get(attemptId))
        .find((candidate) => candidate?.state === "passed" || candidate?.state === "incomplete");
      if (terminalAttempt !== undefined) {
        throw new ProjectAuthorityError(
          "attempt_already_sealed",
          `Attempt ${terminalAttempt.attemptId} has sealed producer Evidence.`,
        );
      }
    }
  }

  #attemptForTask(taskId: string): Attempt | undefined {
    let latest: Attempt | undefined;
    for (const attempt of this.#attempts.values()) {
      if (attempt.taskId === taskId) latest = attempt;
    }
    return latest;
  }

  #hasPassedAttemptForTask(task: GameTask): boolean {
    const attempts = [...this.#attempts.values()].filter((attempt) => attempt.taskId === task.taskId);
    return attempts.some((attempt) =>
      attempt.state === "passed" &&
      attempt.runId === task.runId &&
      attempt.acceptanceContractFingerprint === task.acceptanceContract?.fingerprint);
  }
}

function matchesAuthoritativeHistory(
  submitted: ReadonlyArray<WireRunEvent>,
  authoritative: ReadonlyArray<WireRunEvent>,
  allowedTerminalSuffix?: "run.completed" | "run.stopped",
): boolean {
  if (isDeepStrictEqual(submitted, authoritative)) return true;
  if (allowedTerminalSuffix === undefined || authoritative.length !== submitted.length + 1 ||
      !isDeepStrictEqual(submitted, authoritative.slice(0, submitted.length))) return false;
  const suffix = authoritative.at(-1);
  return suffix?.type === allowedTerminalSuffix && suffix.sequence === submitted.length + 1 &&
    suffix.runId === submitted[0]?.runId;
}

function verificationMatchesBrowserProof(
  event: Extract<WireRunEvent, { type: "verification.ready" }>,
  browserProof: NonNullable<EvidenceSubmission["browserProof"]>,
): boolean {
  const hasScreenshots = browserProof.screenshots.length > 0;
  return event.passed === browserProof.passed &&
    event.outcome === browserProof.outcome &&
    event.actionsExecuted === browserProof.actions.length &&
    event.evidenceSha256 === browserProof.screenshotSha256 &&
    isDeepStrictEqual(event.actions, browserProof.actions) &&
    isDeepStrictEqual(event.diagnosticMessages, browserProof.diagnostics) &&
    (!hasScreenshots || (
      isDeepStrictEqual(event.evidencePaths, browserProof.screenshots) &&
      browserProof.screenshots.includes(event.evidencePath)
    ));
}

function producerAttemptIds(
  event: Extract<WireRunEvent, { type: "project.generated" | "mcp.audit.ready" | "verification.ready" }>,
): string[] {
  const nested = event.type === "project.generated"
    ? [event.attemptId, event.candidate?.attemptId]
    : event.type === "verification.ready"
      ? [event.attemptId, event.build?.attemptId, event.versions?.attemptId]
      : [event.attemptId];
  return [...new Set(nested.filter((attemptId): attemptId is string => attemptId !== undefined))];
}

function isProducerEvent(
  event: WireRunEvent,
): event is Extract<WireRunEvent, { type: "project.generated" | "mcp.audit.ready" | "verification.ready" }> {
  return event.type === "project.generated" || event.type === "mcp.audit.ready" || event.type === "verification.ready";
}

function producerEventBelongsToAttempt(
  event: Extract<WireRunEvent, { type: "project.generated" | "mcp.audit.ready" | "verification.ready" }>,
  attempt: Attempt,
): boolean {
  if (producerAttemptIds(event).some((attemptId) => attemptId !== attempt.attemptId) ||
      event.runId !== attempt.runId) return false;
  if (event.type === "project.generated") {
    return event.revisionId === attempt.revisionId && event.plan.projectId === attempt.projectId &&
      (event.candidate === undefined || (
        event.candidate.projectId === attempt.projectId &&
        event.candidate.revisionId === attempt.revisionId
      ));
  }
  if (event.type === "verification.ready") {
    return event.projectId === attempt.projectId && event.revisionId === attempt.revisionId;
  }
  return true;
}

function freezeEvidence<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.values(value as Record<string, unknown>).forEach(freezeEvidence);
    if (!Object.isFrozen(value)) Object.freeze(value);
  }
  return value;
}
