import {
  attemptIdSchema,
  attemptSchema,
  candidateRevisionSchema,
  candidateAcceptanceValiditySchema,
  createCandidateRevisionInputSchema,
  createProjectInputSchema,
  projectIdSchema,
  projectSchema,
  revisionIdSchema,
  retryAttemptInputSchema,
  startAttemptInputSchema,
  type Attempt,
  type CandidateRevision,
  type CandidateAcceptanceValidity,
  type CreateCandidateRevisionInput,
  type CreateProjectInput,
  type Project,
  type RetryAttemptInput,
  type StartAttemptInput,
} from "@gameforge/contracts";
import { randomUUID } from "node:crypto";
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
      | "attempt_already_started",
    message: string,
  ) {
    super(message);
    this.name = "ProjectAuthorityError";
  }
}

export class ProjectAuthority {
  readonly #projects = new Map<string, Project>();
  readonly #revisions = new Map<string, CandidateRevision>();
  readonly #attempts = new Map<string, Attempt>();
  readonly #startedTaskIds = new Set<string>();

  constructor(
    readonly taskAuthority: Pick<
      TaskInbox,
      "get" | "acceptanceContract" | "isAcceptanceFingerprintCurrent"
    >,
  ) {}

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
    if (this.#startedTaskIds.has(request.taskId)) {
      throw new ProjectAuthorityError(
        "attempt_already_started",
        `Task ${request.taskId} already has an Attempt; use explicit retry.`,
      );
    }
    const project = this.getProject(request.projectId);
    const contract = this.#currentTaskContract(request.taskId, request.projectId);
    const attempt = this.#createAttempt({
      ...request,
      ...(project.currentRevisionId === null ? {} : { baseRevisionId: project.currentRevisionId }),
      acceptanceContractFingerprint: contract.fingerprint,
    });
    this.#startedTaskIds.add(request.taskId);
    return attempt;
  }

  #createAttempt(request: Omit<Attempt, "attemptId" | "revisionId" | "state">): Attempt {
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
    return attemptSchema.parse(attempt);
  }

  retryAttempt(input: RetryAttemptInput): Attempt {
    const request = retryAttemptInputSchema.parse(input);
    const previous = this.getAttempt(request.attemptId);
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
    return this.#createAttempt({
      taskId: previous.taskId,
      projectId: previous.projectId,
      ...(previous.baseRevisionId === undefined ? {} : { baseRevisionId: previous.baseRevisionId }),
      acceptanceContractFingerprint: previous.acceptanceContractFingerprint,
    });
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
}
