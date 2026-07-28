import {
  candidateRevisionSchema,
  createCandidateRevisionInputSchema,
  createProjectInputSchema,
  projectIdSchema,
  projectSchema,
  revisionIdSchema,
  type CandidateRevision,
  type CreateCandidateRevisionInput,
  type CreateProjectInput,
  type Project,
} from "@gameforge/contracts";
import { randomUUID } from "node:crypto";

export class ProjectAuthorityError extends Error {
  constructor(readonly code: "project_not_found" | "revision_not_found", message: string) {
    super(message);
    this.name = "ProjectAuthorityError";
  }
}

export class ProjectAuthority {
  readonly #projects = new Map<string, Project>();
  readonly #revisions = new Map<string, CandidateRevision>();

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
    const revision = candidateRevisionSchema.parse({
      projectId: request.projectId,
      revisionId: `revision-${randomUUID()}`,
      state: "candidate",
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
}
