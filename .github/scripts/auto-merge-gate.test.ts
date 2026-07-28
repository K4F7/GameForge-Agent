import { describe, expect, test } from "bun:test";

import { selectLatestReviewerRun, waitForRequiredChecks } from "./auto-merge-gate.js";

describe("waitForRequiredChecks", () => {
  test("waits for a required check that has not propagated yet", async () => {
    const responses = [
      [{ id: 1, name: "bun", conclusion: "success" }],
      [
        { id: 1, name: "bun", conclusion: "success" },
        { id: 2, name: "PR Gate", conclusion: "success" },
      ],
    ];
    const delays: number[] = [];

    const result = await waitForRequiredChecks({
      requiredChecks: ["PR Gate"],
      maxAttempts: 3,
      delayMs: 25,
      listCheckRuns: async () => responses.shift() ?? [],
      sleep: async (delayMs) => {
        delays.push(delayMs);
      },
    });

    expect(result).toEqual({ kind: "ready", attempts: 2 });
    expect(delays).toEqual([25]);
  });

  test("stops after the configured number of attempts", async () => {
    let calls = 0;

    const result = await waitForRequiredChecks({
      requiredChecks: ["PR Gate"],
      maxAttempts: 3,
      delayMs: 25,
      listCheckRuns: async () => {
        calls += 1;
        return [];
      },
      sleep: async () => {},
    });

    expect(result).toEqual({ kind: "not-ready", attempts: 3, missingChecks: ["PR Gate"] });
    expect(calls).toBe(3);
  });

  test("accepts a current success when an older run has the same check name", async () => {
    const result = await waitForRequiredChecks({
      requiredChecks: ["PR Gate"],
      maxAttempts: 1,
      delayMs: 25,
      listCheckRuns: async () => [
        { id: 2, name: "PR Gate", conclusion: "success" },
        { id: 1, name: "PR Gate", conclusion: "failure" },
      ],
      sleep: async () => {},
    });

    expect(result).toEqual({ kind: "ready", attempts: 1 });
  });

  test("rejects an older success when the newest check failed", async () => {
    const result = await waitForRequiredChecks({
      requiredChecks: ["PR Gate"],
      maxAttempts: 1,
      delayMs: 25,
      listCheckRuns: async () => [
        { id: 2, name: "PR Gate", conclusion: "failure" },
        { id: 1, name: "PR Gate", conclusion: "success" },
      ],
      sleep: async () => {},
    });

    expect(result).toEqual({ kind: "not-ready", attempts: 1, missingChecks: ["PR Gate"] });
  });
});

describe("selectLatestReviewerRun", () => {
  test("selects the newest completed reviewer run for the current head", () => {
    const currentHead = "current-head";
    const selected = selectLatestReviewerRun(
      [
        {
          id: 10,
          name: "GameForge PR Reviewer",
          head_sha: currentHead,
          status: "completed",
          run_number: 40,
          created_at: "2026-07-28T10:00:00Z",
        },
        {
          id: 12,
          name: "GameForge PR Reviewer",
          head_sha: "old-head",
          status: "completed",
          run_number: 99,
          created_at: "2026-07-28T12:00:00Z",
        },
        {
          id: 11,
          name: "GameForge PR Reviewer",
          head_sha: currentHead,
          status: "completed",
          run_number: 41,
          created_at: "2026-07-28T11:00:00Z",
        },
      ],
      currentHead,
    );

    expect(selected?.id).toBe(11);
  });

  test("uses the run id as a deterministic final ordering key", () => {
    const currentHead = "current-head";
    const selected = selectLatestReviewerRun(
      [
        {
          id: 20,
          name: "GameForge PR Reviewer",
          head_sha: currentHead,
          status: "completed",
          run_number: 41,
          created_at: "2026-07-28T11:00:00Z",
        },
        {
          id: 21,
          name: "GameForge PR Reviewer",
          head_sha: currentHead,
          status: "completed",
          run_number: 41,
          created_at: "2026-07-28T11:00:00Z",
        },
      ],
      currentHead,
    );

    expect(selected?.id).toBe(21);
  });
});
