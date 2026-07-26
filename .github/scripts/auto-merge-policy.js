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
 * The agent-config surface the gh-aw workflows sparse-checkout and restore from
 * the base branch (see GH_AW_AGENT_FOLDERS / GH_AW_AGENT_FILES in the compiled
 * lock workflows), plus this repository's own skill and agent directories. Keep
 * in sync with that restoration list when gh-aw is upgraded.
 */
const AGENT_CONFIG_DIRECTORIES = [
  ".github/",
  ".agents/",
  ".antigravity/",
  ".claude/",
  ".codex/",
  ".crush/",
  ".gemini/",
  ".opencode/",
  ".pi/",
  ".codeartsdoer/skills/",
  ".codeartsdoer/agents/",
];

const AGENT_CONFIG_BASENAMES = [
  "AGENTS.md",
  "ANTIGRAVITY.md",
  "CLAUDE.md",
  "GEMINI.md",
  "PI.md",
  ".crush.json",
  "opencode.jsonc",
];

/**
 * Paths that define how this repository governs itself: workflow sources plus
 * every file an agent engine loads as executable instructions. A change here can
 * widen permissions, relax a gate, or steer future reviews, so it never
 * qualifies for any reduced-scrutiny path regardless of file extension.
 *
 * @param {string} path
 */
export function isPolicyBoundaryPath(path) {
  const basename = path.slice(path.lastIndexOf("/") + 1);
  return (
    AGENT_CONFIG_BASENAMES.includes(basename) ||
    AGENT_CONFIG_DIRECTORIES.some((directory) => path.startsWith(directory))
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
