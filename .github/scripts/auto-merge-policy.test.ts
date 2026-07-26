import { describe, expect, test } from "bun:test";

import {
  decideMergeAction,
  isOrdinaryDocumentationChange,
  isOrdinaryDocumentationPath,
} from "./auto-merge-policy.js";

describe("decideMergeAction", () => {
  test("merges immediately when every gate passed and GitHub reports a clean PR", () => {
    expect(
      decideMergeAction({
        mergeStateStatus: "CLEAN",
        mergeable: "MERGEABLE",
        reviewDecision: "APPROVED",
        unresolvedThreads: 0,
        hasAutoMergeRequest: false,
      }),
    ).toEqual({ kind: "merge-now" });
  });

  test("enables auto-merge while an otherwise eligible PR is blocked by branch protection", () => {
    expect(
      decideMergeAction({
        mergeStateStatus: "BLOCKED",
        mergeable: "MERGEABLE",
        reviewDecision: "APPROVED",
        unresolvedThreads: 0,
        hasAutoMergeRequest: false,
      }),
    ).toEqual({ kind: "enable-auto-merge" });
  });

  test("waits while GitHub still reports an unstable PR", () => {
    expect(
      decideMergeAction({
        mergeStateStatus: "UNSTABLE",
        mergeable: "MERGEABLE",
        reviewDecision: "APPROVED",
        unresolvedThreads: 0,
        hasAutoMergeRequest: false,
      }),
    ).toEqual({ kind: "wait", reason: "merge state is UNSTABLE" });
  });
});

describe("isOrdinaryDocumentationPath", () => {
  test("only treats non-policy Markdown files as ordinary documentation", () => {
    expect(isOrdinaryDocumentationPath("docs/guide.md")).toBe(true);
    expect(isOrdinaryDocumentationPath("README.md")).toBe(true);
    expect(isOrdinaryDocumentationPath("AGENTS.md")).toBe(false);
    expect(isOrdinaryDocumentationPath("packages/game/AGENTS.md")).toBe(false);
    expect(isOrdinaryDocumentationPath(".github/pull_request_template.md")).toBe(false);
    expect(isOrdinaryDocumentationPath(".codeartsdoer/skills/build/SKILL.md")).toBe(false);
    expect(isOrdinaryDocumentationPath(".codeartsdoer/agents/reviewer.md")).toBe(false);
    expect(isOrdinaryDocumentationPath("docs/example.ts")).toBe(false);
  });

  test("treats every agent-config surface the workflows restore as policy boundary", () => {
    for (const path of [
      "CLAUDE.md",
      "packages/game/CLAUDE.md",
      "GEMINI.md",
      "ANTIGRAVITY.md",
      "PI.md",
      "docs/nested/GEMINI.md",
      ".claude/skills/deploy/SKILL.md",
      ".codex/config.md",
      ".agents/reviewer.md",
      ".antigravity/notes.md",
      ".crush/setup.md",
      ".gemini/styleguide.md",
      ".opencode/plugin.md",
      ".pi/prompt.md",
    ]) {
      expect(isOrdinaryDocumentationPath(path)).toBe(false);
    }
  });

  test("rejects a mixed change when any policy boundary file is present", () => {
    expect(isOrdinaryDocumentationChange(["docs/guide.md", ".github/scripts/policy.js"])).toBe(false);
  });
});
