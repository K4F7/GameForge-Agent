/**
 * @typedef {object} MergeDecisionInput
 * @property {string} mergeStateStatus
 * @property {string} mergeable
 * @property {string} reviewDecision
 * @property {number} unresolvedThreads
 * @property {boolean} hasAutoMergeRequest
 */

/**
 * @param {MergeDecisionInput} input
 * @returns {{ kind: "merge-now" } | { kind: "enable-auto-merge" } | { kind: "wait", reason: string }}
 */
export function decideMergeAction(input) {
  if (
    input.mergeable === "MERGEABLE" &&
    input.reviewDecision === "APPROVED" &&
    input.unresolvedThreads === 0 &&
    !input.hasAutoMergeRequest
  ) {
    if (input.mergeStateStatus === "CLEAN") {
      return { kind: "merge-now" };
    }
    if (input.mergeStateStatus === "BLOCKED") {
      return { kind: "enable-auto-merge" };
    }
  }

  return { kind: "wait", reason: `merge state is ${input.mergeStateStatus}` };
}

/**
 * @param {string} path
 */
export function isOrdinaryDocumentationPath(path) {
  if (
    path === "AGENTS.md" ||
    path.endsWith("/AGENTS.md") ||
    path.startsWith(".github/") ||
    path.startsWith(".codeartsdoer/skills/") ||
    path.startsWith(".codeartsdoer/agents/")
  ) {
    return false;
  }

  return path.endsWith(".md");
}

/**
 * @param {string[]} paths
 */
export function isOrdinaryDocumentationChange(paths) {
  return paths.length > 0 && paths.every(isOrdinaryDocumentationPath);
}
