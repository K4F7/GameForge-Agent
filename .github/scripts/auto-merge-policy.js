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
 * Paths that define how this repository governs itself. A change here can widen
 * permissions or relax a gate, so it never qualifies for any reduced-scrutiny
 * path regardless of file extension.
 *
 * @param {string} path
 */
export function isPolicyBoundaryPath(path) {
  return (
    path === "AGENTS.md" ||
    path.endsWith("/AGENTS.md") ||
    path === "CLAUDE.md" ||
    path.endsWith("/CLAUDE.md") ||
    path.startsWith(".github/") ||
    path.startsWith(".claude/") ||
    path.startsWith(".codex/") ||
    path.startsWith(".agents/") ||
    path.startsWith(".opencode/") ||
    path.startsWith(".codeartsdoer/skills/") ||
    path.startsWith(".codeartsdoer/agents/")
  );
}

/**
 * @param {string} path
 */
export function isOrdinaryDocumentationPath(path) {
  if (isPolicyBoundaryPath(path)) {
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
