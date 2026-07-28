import {
  candidateRevisionSchema,
  candidateAcceptanceValiditySchema,
  createCandidateRevisionInputSchema,
  createProjectInputSchema,
  projectIdSchema,
  projectSchema,
  revisionIdSchema,
  type CandidateRevision,
  type CandidateAcceptanceValidity,
  type CreateCandidateRevisionInput,
  type CreateProjectInput,
  type Project,
} from "@gameforge/contracts";
import { randomUUID } from "node:crypto";
import type { TaskInbox } from "./tasks.js";

export class ProjectAuthorityError extends Error {
  constructor(
    readonly code:
      | "project_not_found"
      | "revision_not_found"
      | "acceptance_contract_not_frozen"
      | "task_project_mismatch",
    message: string,
  ) {
    super(message);
    this.name = "ProjectAuthorityError";
  }
}

export class ProjectAuthority {
  readonly #projects = new Map<string, Project>();
  readonly #revisions = new Map<string, CandidateRevision>();

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
}
