import { describe, expect, test } from "bun:test";

import { COMPARE_FILE_LIMIT, decideApprovalCarryForward, isTestPath } from "./approval-carryforward.js";

type ChangedFile = {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  previousFilename?: string;
};

function file(filename: string, additions = 10, deletions = 0, status = "modified"): ChangedFile {
  return { filename, status, additions, deletions };
}

function renamed(previousFilename: string, filename: string, additions = 2, deletions = 2): ChangedFile {
  return { filename, previousFilename, status: "renamed", additions, deletions };
}

function decide(changedFiles: ChangedFile[], overrides: Record<string, unknown> = {}) {
  return decideApprovalCarryForward({
    reviewedSha: "a".repeat(40),
    headSha: "b".repeat(40),
    hasNewerChangesRequested: false,
    changedFiles,
    ...overrides,
  });
}

describe("isTestPath", () => {
  test("accepts colocated test and spec files across supported extensions", () => {
    expect(isTestPath("packages/run-relay/src/store.test.ts")).toBe(true);
    expect(isTestPath("integrations/opencode/observer.spec.tsx")).toBe(true);
    expect(isTestPath("packages/game-verifier/src/preview.test.mjs")).toBe(true);
  });

  test("rejects production sources and fixtures that merely mention test", () => {
    expect(isTestPath("packages/run-relay/src/store.ts")).toBe(false);
    expect(isTestPath("packages/ui-test-harness/src/controller.ts")).toBe(false);
    expect(isTestPath("docs/testing.md")).toBe(false);
  });

  test("rejects tests that guard the governance boundary itself", () => {
    expect(isTestPath(".github/scripts/auto-merge-policy.test.ts")).toBe(false);
    expect(isTestPath(".codeartsdoer/skills/build/run.test.ts")).toBe(false);
  });
});

describe("decideApprovalCarryForward", () => {
  test("carries a documentation-only follow-up", () => {
    expect(decide([file("docs/guide.md"), file("README.md")])).toEqual({
      kind: "carry-forward",
      rule: "documentation",
    });
  });

  test("carries an additive test-only follow-up that rewrites some lines", () => {
    expect(decide([file("packages/ui-test-harness/src/adapters/mvp-adapters.test.ts", 15, 7)])).toEqual({
      kind: "carry-forward",
      rule: "tests",
    });
  });

  test("carries a mixed documentation and test follow-up under the test rule", () => {
    expect(decide([file("docs/guide.md"), file("packages/run-relay/src/store.test.ts", 8, 2)])).toEqual({
      kind: "carry-forward",
      rule: "tests",
    });
  });

  test("refuses when any production source is touched", () => {
    expect(decide([file("packages/run-relay/src/store.test.ts"), file("packages/run-relay/src/store.ts")])).toEqual({
      kind: "skip",
      reason: "packages/run-relay/src/store.ts is neither ordinary documentation nor a test",
    });
  });

  test("refuses when a governance boundary file is touched", () => {
    expect(decide([file(".github/workflows/ci.yml")])).toEqual({
      kind: "skip",
      reason: ".github/workflows/ci.yml is neither ordinary documentation nor a test",
    });
    expect(decide([file("AGENTS.md")])).toEqual({
      kind: "skip",
      reason: "AGENTS.md is neither ordinary documentation nor a test",
    });
  });

  test("refuses when a test file is deleted outright", () => {
    expect(decide([file("packages/run-relay/src/store.test.ts", 0, 40, "removed")])).toEqual({
      kind: "skip",
      reason: "packages/run-relay/src/store.test.ts was deleted",
    });
  });

  test("refuses when the test delta removes more than it adds", () => {
    expect(decide([file("packages/run-relay/src/store.test.ts", 2, 30)])).toEqual({
      kind: "skip",
      reason: "test delta removes more than it adds (+2 / -30)",
    });
  });

  test("refuses when documentation additions mask a subtractive test delta", () => {
    expect(decide([file("docs/guide.md", 100, 0), file("packages/run-relay/src/store.test.ts", 0, 80)])).toEqual({
      kind: "skip",
      reason: "test delta removes more than it adds (+0 / -80)",
    });
  });

  test("refuses after the reviewer requested changes", () => {
    expect(decide([file("docs/guide.md")], { hasNewerChangesRequested: true })).toEqual({
      kind: "skip",
      reason: "the reviewer requested changes after its last approval",
    });
  });

  test("refuses when no reviewer approval exists to carry", () => {
    expect(decide([file("docs/guide.md")], { reviewedSha: null })).toEqual({
      kind: "skip",
      reason: "no GameForge PR Reviewer approval exists to carry forward",
    });
  });

  test("refuses when the delta cannot be classified", () => {
    expect(decide([])).toEqual({
      kind: "skip",
      reason: "no file-level delta was reported, so the change cannot be classified",
    });
  });

  test("refuses when the comparison is at the API file cap and may be truncated", () => {
    const many = Array.from({ length: COMPARE_FILE_LIMIT }, (_unused, index) => file(`docs/page-${index}.md`));
    expect(decide(many)).toEqual({
      kind: "skip",
      reason: `the comparison reports ${COMPARE_FILE_LIMIT} files, at the API cap of ${COMPARE_FILE_LIMIT}, so the delta may be truncated`,
    });
  });

  test("carries a large-but-sub-cap documentation follow-up", () => {
    const many = Array.from({ length: COMPARE_FILE_LIMIT - 1 }, (_unused, index) => file(`docs/page-${index}.md`));
    expect(decide(many)).toEqual({ kind: "carry-forward", rule: "documentation" });
  });

  test("carries a rename that stays within documentation on both sides", () => {
    expect(decide([renamed("docs/old-guide.md", "docs/new-guide.md")])).toEqual({
      kind: "carry-forward",
      rule: "documentation",
    });
  });

  test("refuses a rename that moves production source onto a docs path", () => {
    expect(decide([renamed("packages/run-relay/src/store.ts", "docs/store.md")])).toEqual({
      kind: "skip",
      reason: "docs/store.md is neither ordinary documentation nor a test",
    });
  });

  test("refuses a rename that moves production source onto a test path", () => {
    expect(decide([renamed("packages/run-relay/src/store.ts", "packages/run-relay/src/store.test.ts")])).toEqual({
      kind: "skip",
      reason: "packages/run-relay/src/store.test.ts is neither ordinary documentation nor a test",
    });
  });

  test("refuses a rename that lacks its origin path", () => {
    expect(decide([{ filename: "docs/new-guide.md", status: "renamed", additions: 1, deletions: 1 }])).toEqual({
      kind: "skip",
      reason: "docs/new-guide.md is neither ordinary documentation nor a test",
    });
  });

  test("refuses when the reviewed approval already covers the head", () => {
    expect(decide([file("docs/guide.md")], { headSha: "a".repeat(40) })).toEqual({
      kind: "skip",
      reason: "the reviewed approval already covers this head SHA",
    });
  });
});
