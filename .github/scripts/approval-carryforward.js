import { isOrdinaryDocumentationPath, isPolicyBoundaryPath } from "./auto-merge-policy.js";

/**
 * A test file that is not itself part of the governance boundary. Tests under
 * `.github/` verify the merge gate, so relaxing scrutiny on them would let the
 * gate's own coverage be edited without review.
 *
 * @param {string} path
 */
export function isTestPath(path) {
  if (isPolicyBoundaryPath(path)) {
    return false;
  }

  return /\.(test|spec)\.[cm]?[jt]sx?$/.test(path);
}

/**
 * @typedef {object} ChangedFile
 * @property {string} filename
 * @property {string} status GitHub compare status, e.g. "added", "modified", "removed", "renamed"
 * @property {number} additions
 * @property {number} deletions
 */

/**
 * @typedef {object} CarryForwardInput
 * @property {string | null} reviewedSha head SHA the reviewer agent itself last approved
 * @property {string} headSha current head SHA
 * @property {boolean} hasNewerChangesRequested reviewer requested changes after that approval
 * @property {ChangedFile[]} changedFiles files between reviewedSha and headSha
 */

/**
 * Decide whether an existing GameForge PR Reviewer approval may be re-issued
 * against a new head SHA without a fresh review.
 *
 * `reviewedSha` must always come from a review the reviewer agent produced, never
 * from a previous carry-forward. Measuring each delta against the last real review
 * stops a chain of individually-trivial pushes from ratcheting the PR away from
 * anything a reviewer actually read.
 *
 * @param {CarryForwardInput} input
 * @returns {{ kind: "carry-forward", rule: "documentation" | "tests" } | { kind: "skip", reason: string }}
 */
export function decideApprovalCarryForward(input) {
  if (!input.reviewedSha) {
    return { kind: "skip", reason: "no GameForge PR Reviewer approval exists to carry forward" };
  }
  if (input.reviewedSha === input.headSha) {
    return { kind: "skip", reason: "the reviewed approval already covers this head SHA" };
  }
  if (input.hasNewerChangesRequested) {
    return { kind: "skip", reason: "the reviewer requested changes after its last approval" };
  }

  const changedFiles = input.changedFiles;
  if (changedFiles.length === 0) {
    return { kind: "skip", reason: "no file-level delta was reported, so the change cannot be classified" };
  }

  const ineligible = changedFiles.find(
    (file) => !isOrdinaryDocumentationPath(file.filename) && !isTestPath(file.filename),
  );
  if (ineligible !== undefined) {
    return { kind: "skip", reason: `${ineligible.filename} is neither ordinary documentation nor a test` };
  }

  if (changedFiles.every((file) => isOrdinaryDocumentationPath(file.filename))) {
    return { kind: "carry-forward", rule: "documentation" };
  }

  const removed = changedFiles.find((file) => file.status === "removed");
  if (removed !== undefined) {
    return { kind: "skip", reason: `${removed.filename} was deleted` };
  }

  const additions = changedFiles.reduce((total, file) => total + file.additions, 0);
  const deletions = changedFiles.reduce((total, file) => total + file.deletions, 0);
  if (deletions > additions) {
    return {
      kind: "skip",
      reason: `test delta removes more than it adds (+${additions} / -${deletions})`,
    };
  }

  return { kind: "carry-forward", rule: "tests" };
}
