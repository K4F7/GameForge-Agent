import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import {
  bundleBudgetIssues,
  mcpToolAuditDigest,
  webGameBundleLimits,
  type Attempt,
  type EvidenceAggregateInput,
} from "@gameforge/contracts";
import { RelayStatePersistence } from "./persistence.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("RelayStatePersistence", () => {
  it("atomically restores independent Task and Run lifecycle state", async () => {
    const file = await stateFile();
    const persistence = new RelayStatePersistence(file);
    const first = await persistence.load();
    const created = first.taskInbox.create({
      runId: "run-persisted",
      prompt: "Create a browser game whose task survives a relay restart.",
      language: "en-US",
    });
    first.taskInbox.claim(created.task.taskId, { agentId: "codearts" });
    first.taskInbox.appendRun("run-persisted", {
      runId: "run-persisted",
      after: 1,
      events: [
        {
          type: "capabilities.ready",
          runId: "run-persisted",
          sequence: 2,
          emittedAt: "2026-07-16T12:59:59Z",
          snapshot: {
            providers: {
              spec: { provider: "bailian-qwen", ready: true },
              image: { provider: "volcengine-ark", ready: true },
              tts: { provider: "volcengine-speech", ready: false },
              sound: { provider: "freesound", ready: false },
              music: { provider: "minimax", ready: false },
            },
            engineering: { assetStore: true, generator: true, verifier: true, preview: true, runRelay: true, taskInbox: true },
          },
        },
        {
          type: "phase.started",
          runId: "run-persisted",
          sequence: 3,
          emittedAt: "2026-07-16T13:00:00Z",
          phase: "spec",
          detail: "Restored after restart",
        },
        {
          type: "voice.job.updated",
          runId: "run-persisted",
          sequence: 4,
          emittedAt: "2026-07-16T13:00:01Z",
          projectId: "persisted-game",
          assetId: "voices/guide",
          jobHandle: `${"a".repeat(80)}.${"b".repeat(43)}`,
          status: "processing",
        },
        {
          type: "verification.ready",
          runId: "run-persisted",
          sequence: 5,
          emittedAt: "2026-07-16T13:00:03Z",
          projectId: "persisted-game",
          passed: true,
          outcome: "won",
          score: 5,
          lives: 2,
          remainingSeconds: 20,
          evidencePath: ".gameforge/verification/proof.png",
          evidenceSha256: "e".repeat(64),
          canvas: { width: 960, height: 540 },
          diagnostics: { consoleErrors: 0, pageErrors: 0, failedRequests: 0 },
          actionsExecuted: 10,
          durationMs: 2_000,
        },
      ],
    });
    await persistence.save(first.store, first.taskInbox, first.projectAuthority);

    const second = await new RelayStatePersistence(file).load();
    expect(second.taskInbox.get(created.task.taskId)).toMatchObject({
      status: "claimed",
      claimedBy: "codearts",
    });
    expect(second.store.replay("run-persisted", 0).events.map((event) => event.type)).toEqual([
      "run.started",
      "capabilities.ready",
      "phase.started",
      "voice.job.updated",
      "verification.ready",
    ]);
    expect(second.taskInbox.create({
      runId: "run-persisted",
      prompt: "Create a browser game whose task survives a relay restart.",
      language: "en-US",
    })).toMatchObject({
      task: { taskId: created.task.taskId, status: "claimed" },
      event: { type: "run.started", sequence: 1 },
    });
    second.taskInbox.compileAcceptanceContract(created.task.taskId, {
      contractVersion: 1,
      criteria: [{
        criterionId: "restart-goal",
        sourceRequirement: "Complete the game after restart.",
        expected: "Complete the game after restart.",
        verification: { kind: "public-telemetry", path: "$.completed" },
      }],
    });
    second.taskInbox.transition(created.task.taskId, { status: "in-progress", agentId: "codearts" });
    second.taskInbox.finishRun("run-persisted", "run.completed");
    expect(second.taskInbox.transition(created.task.taskId, { status: "completed", agentId: "codearts" }))
      .toMatchObject({ outcome: "rejected", code: "missing-passed-attempt" });
    await new RelayStatePersistence(file).save(second.store, second.taskInbox, second.projectAuthority);

    const third = await new RelayStatePersistence(file).load();
    expect(third.taskInbox.get(created.task.taskId)).toMatchObject({ status: "in-progress" });
    expect(third.store.replay("run-persisted", 5).events).toEqual([
      expect.objectContaining({ type: "run.completed", sequence: 6 }),
    ]);
  });

  it("serializes concurrent save requests so the newest state wins", async () => {
    const file = await stateFile();
    const persistence = new RelayStatePersistence(file);
    const state = await persistence.load();
    const created = state.taskInbox.create({
      runId: "run-queue",
      prompt: "Create a complete browser game with durable state.",
      language: "en-US",
    });
    const firstSave = persistence.save(state.store, state.taskInbox, state.projectAuthority);
    state.taskInbox.claim(created.task.taskId, { agentId: "codearts" });
    const secondSave = persistence.save(state.store, state.taskInbox, state.projectAuthority);
    await Promise.all([firstSave, secondSave]);

    const restored = await new RelayStatePersistence(file).load();
    expect(restored.taskInbox.get(created.task.taskId)).toMatchObject({ status: "claimed" });
  });

  it("restores ProjectAuthority revisions, Attempts, sealed Evidence, incomplete Evidence, and retry consumption", async () => {
    const file = await stateFile();
    const persistence = new RelayStatePersistence(file);
    const first = await persistence.load();

    const sealed = createAuthorityAttempt(first, "sealed");
    const sealedEvidence = persistenceEvidence(sealed.attempt, sealed.taskId, first.taskInbox, false);
    expect(first.projectAuthority.sealAttemptEvidence(sealedEvidence).status).toBe("sealed");
    const incomplete = createAuthorityAttempt(first, "incomplete");
    const incompleteEvidence = persistenceEvidence(incomplete.attempt, incomplete.taskId, first.taskInbox, true, {
      leaveRunOpen: true,
    });
    expect(first.projectAuthority.sealAttemptEvidence(incompleteEvidence).status).toBe("incomplete");
    expect(first.taskInbox.transition(incomplete.taskId, {
      status: "in-progress",
      agentId: "codearts",
    }).outcome).toBe("accepted");
    const retry = first.projectAuthority.retryAttempt({ attemptId: incomplete.attempt.attemptId });

    await persistence.save(first.store, first.taskInbox, first.projectAuthority);
    const restored = await new RelayStatePersistence(file).load();

    expect(restored.projectAuthority.getProject(sealed.projectId)).toEqual(
      first.projectAuthority.getProject(sealed.projectId),
    );
    expect(restored.projectAuthority.getRevision(sealed.attempt.revisionId)).toEqual(
      first.projectAuthority.getRevision(sealed.attempt.revisionId),
    );
    expect(restored.projectAuthority.getAttempt(sealed.attempt.attemptId)).toMatchObject({ state: "passed" });
    expect(restored.projectAuthority.getAttempt(retry.attemptId)).toMatchObject({ state: "running" });
    expect(restored.projectAuthority.getAttempt(incomplete.attempt.attemptId)).toMatchObject({
      state: "incomplete",
      incompleteReasonCode: "evidence.missing-required-proof.v1",
    });
    expect(() => restored.projectAuthority.retryAttempt({ attemptId: incomplete.attempt.attemptId }))
      .toThrow(expect.objectContaining({ code: "attempt_already_retried" }));
  });

  it("rejects a legacy two-argument save without erasing durable ProjectAuthority state", async () => {
    const file = await stateFile();
    const persistence = new RelayStatePersistence(file);
    const state = await persistence.load();
    const sealed = createAuthorityAttempt(state, "legacy-save");
    expect(state.projectAuthority.sealAttemptEvidence(
      persistenceEvidence(sealed.attempt, sealed.taskId, state.taskInbox, false),
    ).status).toBe("sealed");
    await persistence.save(state.store, state.taskInbox, state.projectAuthority);

    await expect(Reflect.apply(persistence.save, persistence, [state.store, state.taskInbox]))
      .rejects.toThrow("ProjectAuthority is required");

    const restored = await new RelayStatePersistence(file).load();
    expect(restored.projectAuthority.getProject(sealed.projectId)).toEqual(
      state.projectAuthority.getProject(sealed.projectId),
    );
    expect(restored.projectAuthority.getAttempt(sealed.attempt.attemptId)).toMatchObject({ state: "passed" });
  });

  it("migrates legacy Task project identities into ProjectAuthority", async () => {
    const file = await stateFile();
    const persistence = new RelayStatePersistence(file);
    const state = await persistence.load();
    const created = state.taskInbox.create({
      runId: "run-legacy-project",
      prompt: "Restore a legacy project-backed Task.",
      language: "en-US",
      projectId: "legacy-project",
    });
    state.taskInbox.compileAcceptanceContract(created.task.taskId, {
      contractVersion: 1,
      criteria: [{
        criterionId: "legacy-project-goal",
        sourceRequirement: "Restore the project identity.",
        expected: "Restore the project identity.",
        verification: { kind: "public-telemetry", path: "$.restored" },
      }],
    });
    await persistence.save(state.store, state.taskInbox, state.projectAuthority);
    const legacy = JSON.parse(await readFile(file, "utf8")) as Record<string, unknown>;
    delete legacy.projectAuthority;
    await writeFile(file, JSON.stringify(legacy));

    const restored = await new RelayStatePersistence(file).load();
    expect(restored.projectAuthority.getProject("legacy-project")).toEqual({
      projectId: "legacy-project",
      currentRevisionId: null,
    });
    expect(restored.projectAuthority.startAttempt({
      taskId: created.task.taskId,
      projectId: "legacy-project",
    })).toMatchObject({ state: "running", projectId: "legacy-project" });
  });

  it("rejects relative paths and invalid snapshots", async () => {
    expect(() => new RelayStatePersistence("relay-state.json")).toThrow("absolute");
    const file = await stateFile();
    await writeFile(file, JSON.stringify({ schemaVersion: "1.0", savedAt: new Date().toISOString(), runs: [] }));
    await expect(new RelayStatePersistence(file).load()).rejects.toThrow();
    expect(await readFile(file, "utf8")).toContain("schemaVersion");
  });

  it("restores Task terminal state independently from its transport Run", async () => {
    const file = await stateFile();
    const persistence = new RelayStatePersistence(file);
    const state = await persistence.load();
    const created = state.taskInbox.create({
      runId: "run-inconsistent",
      prompt: "Create a browser game with consistent durable state.",
      language: "en-US",
    });
    state.taskInbox.claim(created.task.taskId, { agentId: "codearts" });
    await persistence.save(state.store, state.taskInbox, state.projectAuthority);
    const corrupted = JSON.parse(await readFile(file, "utf8")) as {
      tasks: Array<Record<string, unknown>>;
    };
    const task = corrupted.tasks[0];
    if (task === undefined) throw new Error("Expected one persisted task.");
    task.status = "completed";
    task.completedAt = "2026-07-16T13:00:00Z";
    await writeFile(file, JSON.stringify(corrupted));

    const restored = await new RelayStatePersistence(file).load();
    expect(restored.taskInbox.get(created.task.taskId)).toMatchObject({ status: "completed" });
    expect(restored.store.replay("run-inconsistent", 0).events.at(-1)).toMatchObject({ type: "run.started" });
  });

  it("loads a schema 1.0 stopped Task as a canceled public Task", async () => {
    const file = await stateFile();
    const persistence = new RelayStatePersistence(file);
    const state = await persistence.load();
    const created = state.taskInbox.create({
      runId: "run-legacy-stopped",
      prompt: "Restore a stopped Task from the previous Relay lifecycle.",
      language: "en-US",
    });
    await persistence.save(state.store, state.taskInbox, state.projectAuthority);
    const legacy = JSON.parse(await readFile(file, "utf8")) as {
      tasks: Array<Record<string, unknown>>;
    };
    const task = legacy.tasks[0];
    if (task === undefined) throw new Error("Expected one persisted task.");
    task.status = "stopped";
    task.completedAt = "2026-07-16T13:00:00Z";
    await writeFile(file, JSON.stringify(legacy));

    const restored = await new RelayStatePersistence(file).load();
    expect(restored.taskInbox.get(created.task.taskId)).toMatchObject({
      status: "canceled",
      reasonCode: { schemaVersion: "1.0", code: "cancellation" },
      completedAt: "2026-07-16T13:00:00Z",
    });
  });

  it("loads a schema 1.0 failed Task without a reason as an explicitly unclassified failure", async () => {
    const file = await stateFile();
    const persistence = new RelayStatePersistence(file);
    const state = await persistence.load();
    const created = state.taskInbox.create({
      runId: "run-legacy-failed",
      prompt: "Restore a failed Task from the previous Relay lifecycle.",
      language: "en-US",
    });
    await persistence.save(state.store, state.taskInbox, state.projectAuthority);
    const legacy = JSON.parse(await readFile(file, "utf8")) as { tasks: Array<Record<string, unknown>> };
    const task = legacy.tasks[0];
    if (task === undefined) throw new Error("Expected one persisted task.");
    task.status = "failed";
    task.claimedAt = "2026-07-16T12:00:00Z";
    task.claimedBy = "legacy-agent";
    task.completedAt = "2026-07-16T13:00:00Z";
    await writeFile(file, JSON.stringify(legacy));

    const restored = await new RelayStatePersistence(file).load();
    expect(restored.taskInbox.get(created.task.taskId)).toMatchObject({
      status: "failed",
      reasonCode: { schemaVersion: "1.0", code: "legacy-unclassified-failure" },
    });
  });
});

function createAuthorityAttempt(
  state: Awaited<ReturnType<RelayStatePersistence["load"]>>,
  suffix: string,
): { projectId: string; taskId: string; attempt: Attempt } {
  const project = state.projectAuthority.createProject({});
  const task = state.taskInbox.create({
    runId: `run-persistence-authority-${suffix}`,
    prompt: `Create a browser game whose ${suffix} Attempt survives restart.`,
    language: "en-US",
    projectId: project.projectId,
  }).task;
  const frozen = state.taskInbox.compileAcceptanceContract(task.taskId, {
    contractVersion: 1,
    criteria: [{
      criterionId: "win-game",
      sourceRequirement: "Win the game.",
      expected: "The public outcome is won.",
      verification: { kind: "public-telemetry", path: "$.status" },
    }],
  });
  if (frozen.outcome !== "frozen") throw new Error("Expected persistence acceptance to freeze.");
  return {
    projectId: project.projectId,
    taskId: task.taskId,
    attempt: state.projectAuthority.startAttempt({ taskId: task.taskId, projectId: project.projectId }),
  };
}

function persistenceEvidence(
  attempt: Attempt,
  taskId: string,
  tasks: Awaited<ReturnType<RelayStatePersistence["load"]>>["taskInbox"],
  incomplete: boolean,
  options: { leaveRunOpen?: boolean } = {},
): EvidenceAggregateInput {
  const task = tasks.get(taskId);
  if (task.status === "queued") tasks.claim(taskId, { agentId: "codearts" });
  const files = [{ path: "dist/index.js", bytes: 1, sha256: "b".repeat(64) }];
  const candidate = {
    schemaVersion: 1 as const,
    projectId: attempt.projectId,
    attemptId: attempt.attemptId,
    revisionId: attempt.revisionId,
    totalBytes: 1,
    files,
    aggregateSha256: createHash("sha256").update(JSON.stringify(files)).digest("hex"),
  };
  const metrics = {
    initial: { raw: 90, gzip: 45 },
    async: { raw: 0, gzip: 0 },
    total: { raw: 90, gzip: 45 },
    files: [{ path: "dist/index.js", phase: "initial" as const, raw: 90, gzip: 45 }],
  };
  const build = { attemptId: attempt.attemptId, command: "vite.build" as const, exitCode: 0 as const, report: { metrics, limits: webGameBundleLimits, issues: bundleBudgetIssues(metrics, webGameBundleLimits) } };
  const versions = { attemptId: attempt.attemptId, contractVersion: 1, templateVersion: "1.0.0" };
  const mcpAudit = {
    schemaVersion: 1 as const,
    sessionId: "11111111-1111-4111-8111-111111111111",
    startedAt: "2026-07-30T10:00:00.000Z",
    truncated: incomplete,
    context: {
      taskId,
      runId: task.runId,
      attemptId: attempt.attemptId,
      boundAt: "2026-07-30T10:00:00.000Z",
    },
    calls: [{
      sequence: 1,
      tool: "gameforge.verify",
      startedAt: "2026-07-30T10:00:00.000Z",
      durationMs: 1,
      outcome: "success" as const,
    }],
  };
  tasks.appendRun(task.runId, {
    runId: task.runId,
    after: 1,
    events: [{
      type: "project.generated",
      runId: task.runId,
      sequence: 2,
      emittedAt: "2026-07-30T10:00:00.000Z",
      attemptId: attempt.attemptId,
      revisionId: attempt.revisionId,
      mode: "apply",
      operation: "create",
      plan: {
        generatorVersion: "1.0.0",
        projectId: attempt.projectId,
        target: "web",
        specSha256: "a".repeat(64),
        planSha256: "d".repeat(64),
        files,
      },
      candidate,
    }, {
      type: "mcp.audit.ready",
      runId: task.runId,
      sequence: 3,
      emittedAt: "2026-07-30T10:00:01.000Z",
      attemptId: attempt.attemptId,
      auditDigest: mcpToolAuditDigest(mcpAudit),
      truncated: incomplete,
      totalCalls: 1,
      calls: [{ sequence: 1, tool: "gameforge.verify", durationMs: 1, outcome: "success" }],
    }, {
      type: "verification.ready",
      runId: task.runId,
      sequence: 4,
      emittedAt: "2026-07-30T10:00:02.000Z",
      attemptId: attempt.attemptId,
      revisionId: attempt.revisionId,
      projectId: attempt.projectId,
      passed: true,
      outcome: "won",
      score: 1,
      lives: 1,
      remainingSeconds: 1,
      evidencePath: ".gameforge/verification/proof.png",
      evidenceSha256: "e".repeat(64),
      canvas: { width: 960, height: 540 },
      diagnostics: { consoleErrors: 0, pageErrors: 0, failedRequests: 0 },
      actionsExecuted: 1,
      durationMs: 1,
      actions: ["click:start"],
      diagnosticMessages: [],
      evidencePaths: [".gameforge/verification/proof.png"],
      criteria: [{ criterionId: "win-game", passed: true }],
      build,
      versions,
    }],
  });
  if (options.leaveRunOpen !== true) tasks.finishRun(task.runId, "run.completed");
  const normalized = task.prompt;
  return {
    attemptId: attempt.attemptId,
    taskId,
    runId: task.runId,
    projectId: attempt.projectId,
    baseRevisionId: attempt.baseRevisionId ?? null,
    revisionId: attempt.revisionId,
    acceptanceContractFingerprint: attempt.acceptanceContractFingerprint,
    criterionResults: [{ criterionId: "win-game", passed: true }],
    request: { normalized, fingerprint: createHash("sha256").update(normalized).digest("hex") },
    codeArts: { attemptId: attempt.attemptId, target: "GLM", clientVersion: "1.0.0", durationMs: 1, interventions: [] },
    mcpAudit: { attemptId: attempt.attemptId, ...mcpAudit },
    artifacts: candidate,
    build,
    browserProof: { attemptId: attempt.attemptId, projectId: attempt.projectId, revisionId: attempt.revisionId, passed: true, actions: ["click:start"], outcome: "won", diagnostics: [], screenshots: [".gameforge/verification/proof.png"], screenshotSha256: "e".repeat(64) },
    authorityEvents: tasks.authoritativeRunEvents(task.runId).map((event) => ({ attemptId: attempt.attemptId, event })),
    versions,
  };
}

async function stateFile(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "gameforge-relay-state-"));
  roots.push(root);
  const nested = path.join(root, "nested");
  await mkdir(nested);
  return path.join(nested, "relay-state.json");
}
