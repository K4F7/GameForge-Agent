/**
 * @typedef {{ id: number, name: string, conclusion: string | null }} CheckRun
 * @typedef {{
 *   requiredChecks: string[],
 *   maxAttempts: number,
 *   delayMs: number,
 *   listCheckRuns: () => Promise<CheckRun[]>,
 *   sleep: (delayMs: number) => Promise<void>,
 * }} RequiredCheckOptions
 */

/**
 * Wait for GitHub's check-runs API to expose successful required checks, while
 * keeping the workflow runtime strictly bounded.
 *
 * @param {RequiredCheckOptions} options
 */
export async function waitForRequiredChecks(options) {
  let missingChecks = [...options.requiredChecks];

  for (let attempt = 1; attempt <= options.maxAttempts; attempt += 1) {
    const checkRuns = await options.listCheckRuns();
    const latestByName = new Map();
    for (const check of checkRuns) {
      const latest = latestByName.get(check.name);
      if (!latest || check.id > latest.id) {
        latestByName.set(check.name, check);
      }
    }
    missingChecks = options.requiredChecks.filter((name) => latestByName.get(name)?.conclusion !== "success");
    if (missingChecks.length === 0) {
      return { kind: "ready", attempts: attempt };
    }
    if (attempt < options.maxAttempts) {
      await options.sleep(options.delayMs);
    }
  }

  return { kind: "not-ready", attempts: options.maxAttempts, missingChecks };
}

/**
 * @typedef {{
 *   id: number,
 *   name: string,
 *   head_sha: string,
 *   status: string | null,
 *   run_number: number,
 *   created_at: string,
 * }} WorkflowRun
 */

/**
 * @param {WorkflowRun[]} workflowRuns
 * @param {string} headSha
 */
export function selectLatestReviewerRun(workflowRuns, headSha) {
  return [...workflowRuns]
    .filter(
      (workflowRun) =>
        workflowRun.name === "GameForge PR Reviewer" &&
        workflowRun.head_sha === headSha &&
        workflowRun.status === "completed",
    )
    .sort(
      (left, right) =>
        right.run_number - left.run_number ||
        Date.parse(right.created_at) - Date.parse(left.created_at) ||
        right.id - left.id,
    )[0];
}
