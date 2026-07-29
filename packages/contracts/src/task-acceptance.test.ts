import { describe, expect, it } from "vitest";
import { taskAcceptanceContractSchema } from "./task-acceptance.js";

describe("task acceptance contracts", () => {
  it("requires versioned machine assertions for objective browser proof", () => {
    const base = {
      schemaVersion: "1.0" as const,
      contractVersion: 1,
      fingerprint: "a".repeat(64),
    };
    expect(taskAcceptanceContractSchema.parse({
      ...base,
      criteria: [{
        criterionId: "activate-objective",
        sourceRequirement: "Press Space to activate the objective.",
        expected: "The objective becomes active.",
        applicableScenarios: ["won"],
        verification: {
          kind: "browser-action",
          action: "press Space",
          observableEffect: {
            kind: "public-telemetry",
            path: "$.objectiveActive",
            assertion: { schemaVersion: 1, comparator: "changed-to", value: true },
          },
        },
      }],
    }).criteria[0]).toMatchObject({
      applicableScenarios: ["won"],
      verification: { observableEffect: { assertion: { comparator: "changed-to", value: true } } },
    });

    expect(taskAcceptanceContractSchema.safeParse({
      ...base,
      criteria: [{
        criterionId: "dispatch-only",
        sourceRequirement: "Press Space to activate the objective.",
        expected: "press Space",
        verification: { kind: "browser-action", action: "press Space" },
      }],
    }).success).toBe(false);
  });

  it("keeps prose separate from machine-readable telemetry expectations", () => {
    const result = taskAcceptanceContractSchema.parse({
      schemaVersion: "1.0",
      contractVersion: 1,
      fingerprint: "b".repeat(64),
      criteria: [{
        criterionId: "collected-count",
        sourceRequirement: "Collect all three items.",
        expected: "The collected count becomes 3.",
        applicableScenarios: ["won"],
        verification: {
          kind: "public-telemetry",
          path: "$.score",
          assertion: { schemaVersion: 1, comparator: "equals", value: 3 },
        },
      }],
    });
    expect(result.criteria[0]?.expected).toBe("The collected count becomes 3.");
    expect(result.criteria[0]?.verification).toMatchObject({
      assertion: { comparator: "equals", value: 3 },
    });
  });

  it("rejects an includes assertion with an empty value", () => {
    expect(taskAcceptanceContractSchema.safeParse({
      schemaVersion: "1.0",
      contractVersion: 1,
      fingerprint: "c".repeat(64),
      criteria: [{
        criterionId: "visible-message",
        sourceRequirement: "Show the completion message.",
        expected: "The completion message is visible.",
        verification: {
          kind: "dom-output",
          selector: "[data-status]",
          assertion: { schemaVersion: 1, comparator: "includes", value: "" },
        },
      }],
    }).success).toBe(false);
  });
});
