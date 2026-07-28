import { gameTaskSchema, type GameTask, type RunEventBatch, type WireRunEvent } from "@gameforge/contracts";
import { describe, expect, it } from "vitest";
import { captureBenchmarkEvidence, type EvidenceRelayClient } from "./capture.js";

const prompt = "Create a complete browser collection game with deterministic verification.";
const definition = {
  benchmarkId: "capture-evidence",
  prompt,
  language: "en-US" as const,
  target: {
    genre: "collect" as const,
    durationSeconds: 90,
    collectibleCount: 5,
    hazardCount: 3,
    startingLives: 3,
    movementSpeed: 220,
    mediaEnabled: false,
  },
};
const metadata = {
  client: { name: "codearts" as const, version: "26.6.2" },
  tools: { count: null, names: [], errors: null },
  humanInterventions: ["Started the OAuth TUI manually."],
  failure: "none" as const,
  evidence: ["experiments/capture/result.md"],
};
describe("benchmark evidence capture", () => {
  it("paginates a complete run and exports only allowlisted summaries", async () => {
    const events = completeEvents();
    const calls: number[] = [];
    const relay = relayFixture(events, calls);
    const record = await captureBenchmarkEvidence({
      definition,
      metadata,
      taskId: "task-00000000-0000-0000-0000-000000000000",
      relay,
      mcpAudit: auditFixture(),
    });

    expect(calls).toEqual([0, 1000]);
    expect(record).toMatchObject({
      benchmarkId: "capture-evidence",
      terminalStatus: "completed",
      events: { count: 1001, types: { "run.started": 1, "log.appended": 998, "verification.ready": 1, "run.completed": 1 } },
      verification: { passed: true, outcome: "won", diagnostics: 0 },
      tools: { count: 2, names: ["validate_game_spec", "generate_game_project"], errors: 1 },
    });
    expect(record.evidence).toContain(".gameforge/verification/capture.png");
    expect(record.toolAudit).toMatchObject({ sessionId: "00000000-0000-4000-8000-000000000001" });
    const serialized = JSON.stringify(record);
    expect(serialized).not.toContain("DASHSCOPE_API_KEY");
    expect(serialized).not.toContain("super-secret");
    expect(serialized).not.toContain(prompt);
  });

  it("refuses a definition mismatch and incomplete completed evidence", async () => {
    const events = completeEvents();
    await expect(captureBenchmarkEvidence({
      definition: { ...definition, prompt: "Create a different complete browser collection game." },
      metadata,
      taskId: "task-00000000-0000-0000-0000-000000000000",
      relay: relayFixture(events),
    })).rejects.toThrow("does not match");

    await expect(captureBenchmarkEvidence({
      definition,
      metadata,
      taskId: "task-00000000-0000-0000-0000-000000000000",
      relay: relayFixture(events.filter((event) => event.type !== "verification.ready").map((event, index) => ({
        ...event,
        sequence: index + 1,
      })) as WireRunEvent[]),
    })).rejects.toThrow("Completed records require");

    await expect(captureBenchmarkEvidence({
      definition,
      metadata,
      taskId: "task-00000000-0000-0000-0000-000000000000",
      relay: relayFixture(events.slice(0, -1)),
    })).rejects.toThrow("Completed Task evidence must end with run.completed");
  });

  it("rejects sensitive metadata instead of attempting lossy redaction", async () => {
    await expect(captureBenchmarkEvidence({
      definition,
      metadata: {
        ...metadata,
        humanInterventions: ["token=super-secret"],
        evidence: ["D:\\private\\capture.png"],
      },
      taskId: "task-00000000-0000-0000-0000-000000000000",
      relay: relayFixture(completeEvents()),
    })).rejects.toThrow();
  });

  it("rejects truncated audits and conflicts with manual tool counts", async () => {
    await expect(captureBenchmarkEvidence({
      definition,
      metadata,
      taskId: "task-00000000-0000-0000-0000-000000000000",
      relay: relayFixture(completeEvents()),
      mcpAudit: { ...auditFixture(), truncated: true },
    })).rejects.toThrow("Truncated");
    await expect(captureBenchmarkEvidence({
      definition,
      metadata: { ...metadata, tools: { count: 1, names: ["validate_game_spec"], errors: 0 } },
      taskId: "task-00000000-0000-0000-0000-000000000000",
      relay: relayFixture(completeEvents()),
      mcpAudit: auditFixture(),
    })).rejects.toThrow("requires unknown tools");
    const { context: _context, ...unboundAudit } = auditFixture();
    await expect(captureBenchmarkEvidence({
      definition,
      metadata,
      taskId: "task-00000000-0000-0000-0000-000000000000",
      relay: relayFixture(completeEvents()),
      mcpAudit: unboundAudit,
    })).rejects.toThrow("not bound");
    await expect(captureBenchmarkEvidence({
      definition,
      metadata,
      taskId: "task-00000000-0000-0000-0000-000000000000",
      relay: relayFixture(completeEvents()),
      mcpAudit: { ...auditFixture(), context: { ...auditFixture().context, runId: "another-run" } },
    })).rejects.toThrow("not bound");
  });

  it("uses the authoritative Task reason instead of legacy failure metadata", async () => {
    const task = gameTaskSchema.parse({
      taskId: "task-00000000-0000-0000-0000-000000000000",
      runId: "capture-run",
      prompt,
      language: "en-US",
      status: "failed",
      reasonCode: { schemaVersion: "1.0", code: "security-violation" },
      createdAt: time(1),
      claimedAt: time(2),
      claimedBy: "codearts",
      completedAt: time(1001),
    });

    const record = await captureBenchmarkEvidence({
      definition,
      metadata: { ...metadata, failure: "rate-limit" },
      taskId: task.taskId,
      relay: relayFixture(completeEvents(), [], task),
    });

    expect(record).toMatchObject({
      terminalStatus: "failed",
      reasonCode: { schemaVersion: "1.0", code: "security-violation" },
      failure: "unknown",
    });
  });

});

function relayFixture(events: WireRunEvent[], calls: number[] = [], taskInput?: GameTask): EvidenceRelayClient {
  const task = taskInput ?? gameTaskSchema.parse({
    taskId: "task-00000000-0000-0000-0000-000000000000",
    runId: "capture-run",
    prompt,
    language: "en-US",
    status: "completed",
    createdAt: time(1),
    claimedAt: time(2),
    claimedBy: "codearts",
    completedAt: time(1001),
  });
  return {
    async getTask() { return task; },
    async replayEvents(input): Promise<RunEventBatch> {
      calls.push(input.after);
      return { runId: input.runId, after: input.after, events: events.slice(input.after, input.after + 1000) };
    },
  };
}

function completeEvents(): WireRunEvent[] {
  const events: WireRunEvent[] = [{
    type: "run.started",
    runId: "capture-run",
    sequence: 1,
    emittedAt: time(1),
    language: "en-US",
  }];
  for (let sequence = 2; sequence <= 999; sequence += 1) {
    events.push({
      type: "log.appended",
      runId: "capture-run",
      sequence,
      emittedAt: time(sequence),
      source: "agent",
      level: "info",
      message: "DASHSCOPE_API_KEY=super-secret D:\\private\\workspace",
    });
  }
  events.push({
    type: "verification.ready",
    runId: "capture-run",
    sequence: 1000,
    emittedAt: time(1000),
    projectId: "capture-game",
    passed: true,
    outcome: "won",
    score: 5,
    lives: 3,
    remainingSeconds: 12,
    evidencePath: ".gameforge/verification/capture.png",
    canvas: { width: 960, height: 540 },
    diagnostics: { consoleErrors: 0, pageErrors: 0, failedRequests: 0 },
    actionsExecuted: 6,
    durationMs: 2_000,
  });
  events.push({ type: "run.completed", runId: "capture-run", sequence: 1001, emittedAt: time(1001) });
  return events;
}

function time(sequence: number): string {
  return new Date(Date.UTC(2026, 6, 18, 0, 0, 0, sequence)).toISOString();
}

function auditFixture() {
  return {
    schemaVersion: 1 as const,
    sessionId: "00000000-0000-4000-8000-000000000001",
    startedAt: time(1),
    truncated: false,
    context: {
      taskId: "task-00000000-0000-0000-0000-000000000000",
      runId: "capture-run",
      boundAt: time(2),
    },
    calls: [
      { sequence: 1, tool: "validate_game_spec", startedAt: time(2), durationMs: 4, outcome: "success" as const },
      { sequence: 2, tool: "generate_game_project", startedAt: time(3), durationMs: 8, outcome: "error" as const },
    ],
  };
}
