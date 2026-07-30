import type { AddressInfo } from "node:net";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createGameTaskResponseSchema, webGameBundleLimits } from "@gameforge/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { createRunRelayServer, ProjectAuthority } from "./server.js";
import { RunRelayClient } from "./client.js";
import { RelayStatePersistence } from "./persistence.js";
import { RunStore } from "./store.js";
import { TaskInbox } from "./tasks.js";

const servers: ReturnType<typeof createRunRelayServer>[] = [];
const roots: string[] = [];

async function startServer(
  options: Parameters<typeof createRunRelayServer>[0] = {},
): Promise<string> {
  const server = createRunRelayServer({ heartbeatMilliseconds: 1_000, ...options });
  servers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => {
    server.closeAllConnections();
    server.close(() => resolve());
  })));
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("run relay HTTP server", () => {
  it("protects every non-preflight route when bearer authentication is configured", async () => {
    const token = "relay-test-token-0123456789-abcdef";
    const baseUrl = await startServer({ authToken: token });
    const missing = await fetch(`${baseUrl}/tasks?limit=1`);
    expect(missing.status).toBe(401);
    await expect(missing.json()).resolves.toMatchObject({ error: "authentication_required" });
    expect(missing.headers.get("www-authenticate")).toBe("Bearer");
    expect((await fetch(`${baseUrl}/tasks?limit=1`, {
      headers: { Authorization: "Bearer wrong-token-with-enough-characters-000" },
    })).status).toBe(401);
    const authorized = await fetch(`${baseUrl}/tasks?limit=1`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(authorized.status).toBe(200);
    const preflight = await fetch(`${baseUrl}/tasks`, { method: "OPTIONS" });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-headers")).toContain("Authorization");
  });

  it("awaits persistence after mutations but not reads", async () => {
    let saves = 0;
    const baseUrl = await startServer({ persistState: async () => { saves += 1; } });
    const created = await fetch(`${baseUrl}/runs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ runId: "run-persist-hook" }),
    });
    expect(created.status).toBe(201);
    expect(saves).toBe(1);
    const replay = await fetch(`${baseUrl}/runs/run-persist-hook/events?after=0`);
    expect(replay.status).toBe(200);
    expect(saves).toBe(1);
    const stopped = await fetch(`${baseUrl}/runs/run-persist-hook/stop`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    expect(stopped.status).toBe(200);
    expect(saves).toBe(2);
  });

  it("does not copy rollback snapshots when persistence is disabled", async () => {
    const store = new class extends RunStore {
      override snapshot(): never {
        throw new Error("Persistence-only snapshot must not run without persistence.");
      }
    }();
    const taskInbox = new TaskInbox(store);
    const projectAuthority = new ProjectAuthority(taskInbox);
    const baseUrl = await startServer({ store, taskInbox, projectAuthority });

    const response = await fetch(`${baseUrl}/runs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ runId: "run-without-persistence-snapshot" }),
    });

    expect(response.status).toBe(201);
  });

  it("does not expose an in-memory Run when persistence rejects the mutation", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "gameforge-relay-rollback-"));
    roots.push(root);
    const statePath = path.join(root, "relay-state.json");
    await mkdir(statePath);
    const store = new RunStore();
    const taskInbox = new TaskInbox(store);
    const projectAuthority = new ProjectAuthority(taskInbox);
    const persistence = new RelayStatePersistence(statePath);
    const baseUrl = await startServer({
      store,
      taskInbox,
      projectAuthority,
      persistState: () => persistence.save(store, taskInbox, projectAuthority),
    });

    const rejected = await fetch(`${baseUrl}/runs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ runId: "run-persistence-rejected" }),
    });
    expect(rejected.status).toBe(500);

    const replay = await fetch(`${baseUrl}/runs/run-persistence-rejected/events?after=0`);
    expect(replay.status).toBe(404);
    await expect(replay.json()).resolves.toMatchObject({ error: "run_not_found" });
  });

  it("compensates durable state when persistence writes before rejecting", async () => {
    const store = new RunStore();
    const taskInbox = new TaskInbox(store);
    const projectAuthority = new ProjectAuthority(taskInbox);
    let saves = 0;
    let durableRuns = store.snapshot();
    const baseUrl = await startServer({
      store,
      taskInbox,
      projectAuthority,
      persistState: async () => {
        saves += 1;
        durableRuns = store.snapshot();
        if (saves === 1) throw new Error("simulated post-write persistence failure");
      },
    });

    const rejected = await fetch(`${baseUrl}/runs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ runId: "run-post-write-persistence-rejected" }),
    });

    expect(rejected.status).toBe(500);
    expect(saves).toBe(2);
    expect(durableRuns).toEqual({ schemaVersion: 2, runs: [] });
    expect((await fetch(`${baseUrl}/runs/run-post-write-persistence-rejected/events?after=0`)).status).toBe(404);
  });

  it("does not publish an SSE event before its persistence commit succeeds", async () => {
    let saves = 0;
    const baseUrl = await startServer({
      persistState: async () => {
        saves += 1;
        if (saves > 1) throw new Error("simulated persistence failure");
      },
    });
    const created = await fetch(`${baseUrl}/runs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ runId: "run-sse-persistence-rejected" }),
    });
    expect(created.status).toBe(201);

    const controller = new AbortController();
    try {
      const stream = await fetch(`${baseUrl}/runs/run-sse-persistence-rejected/stream?after=0`, {
        signal: controller.signal,
      });
      const reader = stream.body?.getReader();
      const initial = await reader?.read();
      expect(new TextDecoder().decode(initial?.value)).toContain('"type":"run.started"');

      const rejected = await fetch(`${baseUrl}/runs/run-sse-persistence-rejected/events`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          runId: "run-sse-persistence-rejected",
          after: 1,
          events: [{
            type: "log.appended",
            runId: "run-sse-persistence-rejected",
            sequence: 2,
            emittedAt: "2026-07-30T10:00:00+08:00",
            source: "tool",
            level: "success",
            message: "Must not escape a failed persistence commit",
          }],
        }),
      });
      expect(rejected.status).toBe(500);
      const nextChunk = reader === undefined
        ? undefined
        : await Promise.race([
          reader.read().then((chunk) => new TextDecoder().decode(chunk.value)),
          new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), 100)),
        ]);
      expect(nextChunk).toBeUndefined();

      const replay = await fetch(`${baseUrl}/runs/run-sse-persistence-rejected/events?after=1`);
      expect(await replay.json()).toMatchObject({ events: [] });
    } finally {
      controller.abort();
    }
  });

  it("holds new replay and SSE reads at the durable mutation boundary", async () => {
    let saves = 0;
    let persistenceStarted: (() => void) | undefined;
    let rejectPersistence: ((error: Error) => void) | undefined;
    const pendingPersistence = new Promise<void>((_resolve, reject) => {
      rejectPersistence = reject;
    });
    const baseUrl = await startServer({
      persistState: async () => {
        saves += 1;
        if (saves === 2) {
          persistenceStarted?.();
          await pendingPersistence;
        }
      },
    });
    await fetch(`${baseUrl}/runs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ runId: "run-concurrent-durable-read" }),
    });

    const started = new Promise<void>((resolve) => { persistenceStarted = resolve; });
    const append = fetch(`${baseUrl}/runs/run-concurrent-durable-read/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        runId: "run-concurrent-durable-read",
        after: 1,
        events: [{
          type: "log.appended",
          runId: "run-concurrent-durable-read",
          sequence: 2,
          emittedAt: "2026-07-30T10:00:00+08:00",
          source: "tool",
          level: "success",
          message: "Must remain invisible until persistence commits",
        }],
      }),
    });
    await started;

    const replay = fetch(`${baseUrl}/runs/run-concurrent-durable-read/events?after=0`);
    const streamController = new AbortController();
    const stream = fetch(`${baseUrl}/runs/run-concurrent-durable-read/stream?after=0`, {
      signal: streamController.signal,
    });
    const beforeRollback = await Promise.race([
      Promise.all([replay, stream]).then(() => "resolved" as const),
      new Promise<"pending">((resolve) => setTimeout(() => resolve("pending"), 100)),
    ]);
    expect(beforeRollback).toBe("pending");

    rejectPersistence?.(new Error("simulated persistence failure"));
    expect((await append).status).toBe(500);
    const replayResponse = await replay;
    expect(await replayResponse.json()).toMatchObject({
      events: [expect.objectContaining({ sequence: 1, type: "run.started" })],
    });
    const streamResponse = await stream;
    const streamReader = streamResponse.body?.getReader();
    let initialText = "";
    for (let reads = 0; reads < 3 && !initialText.includes('"type":"run.started"'); reads += 1) {
      const chunk = await streamReader?.read();
      initialText += new TextDecoder().decode(chunk?.value);
    }
    expect(initialText).toContain('"type":"run.started"');
    expect(initialText).not.toContain("Must remain invisible until persistence commits");
    streamController.abort();
  });

  it("holds authoritative Task reads until a durable mutation commits or rolls back", async () => {
    let saves = 0;
    let persistenceStarted: (() => void) | undefined;
    let rejectPersistence: ((error: Error) => void) | undefined;
    const pendingPersistence = new Promise<void>((_resolve, reject) => {
      rejectPersistence = reject;
    });
    const baseUrl = await startServer({
      persistState: async () => {
        saves += 1;
        if (saves === 2) {
          persistenceStarted?.();
          await pendingPersistence;
        }
      },
    });
    const createdResponse = await fetch(`${baseUrl}/tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        runId: "run-concurrent-task-read",
        prompt: "Create a game whose claim is durably visible.",
        language: "en-US",
      }),
    });
    const created = createGameTaskResponseSchema.parse(await createdResponse.json());

    const started = new Promise<void>((resolve) => { persistenceStarted = resolve; });
    const claim = fetch(`${baseUrl}/tasks/${created.task.taskId}/claim`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agentId: "codearts" }),
    });
    await started;

    const read = fetch(`${baseUrl}/tasks/${created.task.taskId}`);
    expect(await Promise.race([
      read.then(() => "resolved" as const),
      new Promise<"pending">((resolve) => setTimeout(() => resolve("pending"), 100)),
    ])).toBe("pending");

    rejectPersistence?.(new Error("simulated persistence failure"));
    expect((await claim).status).toBe(500);
    expect(await read.then((response) => response.json())).toMatchObject({
      task: { taskId: created.task.taskId, status: "queued" },
    });
  });

  it("creates, lists, claims, and completes a game task with its run", async () => {
    const baseUrl = await startServer();
    const createdResponse = await fetch(`${baseUrl}/tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "http://localhost:4173" },
      body: JSON.stringify({
        runId: "run-task-1",
        prompt: "制作一个可以收集装备并避开危险的浏览器小游戏。",
        language: "zh-CN",
        projectId: "safety-game",
      }),
    });
    expect(createdResponse.status).toBe(201);
    const created = createGameTaskResponseSchema.parse(await createdResponse.json());
    expect(created).toMatchObject({
      task: { runId: "run-task-1", status: "queued", projectId: "safety-game" },
      event: { type: "run.started", sequence: 1 },
    });

    const retriedResponse = await fetch(`${baseUrl}/tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "http://localhost:4173" },
      body: JSON.stringify({
        runId: "run-task-1",
        prompt: "制作一个可以收集装备并避开危险的浏览器小游戏。",
        language: "zh-CN",
        projectId: "safety-game",
      }),
    });
    expect(retriedResponse.status).toBe(201);
    expect(createGameTaskResponseSchema.parse(await retriedResponse.json())).toEqual(created);

    const conflictingResponse = await fetch(`${baseUrl}/tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "http://localhost:4173" },
      body: JSON.stringify({
        runId: "run-task-1",
        prompt: "制作一个可以收集装备并避开危险的浏览器小游戏。",
        language: "zh-CN",
        projectId: "another-game",
      }),
    });
    expect(conflictingResponse.status).toBe(409);
    await expect(conflictingResponse.json()).resolves.toMatchObject({ error: "task_run_conflict" });

    const relayClient = new RunRelayClient({ baseUrl });
    await expect(relayClient.listTasks({ status: "queued", limit: 10 }))
      .resolves.toEqual([expect.objectContaining({ taskId: created.task.taskId })]);
    await expect(relayClient.claimTask(created.task.taskId, { agentId: "codearts" }))
      .resolves.toMatchObject({ status: "claimed", claimedBy: "codearts" });
    await expect(relayClient.completeRun("run-task-1")).resolves.toMatchObject({ type: "run.completed" });
    await expect(relayClient.getTask(created.task.taskId)).resolves.toMatchObject({ status: "claimed" });
  });

  it("creates a task through the shared client without browser-only APIs", async () => {
    const baseUrl = await startServer();
    const client = new RunRelayClient({ baseUrl });
    const created = await client.createTask({
      runId: "run-client-task",
      prompt: "Create a deterministic browser game from this terminal request.",
      language: "en-US",
    });
    expect(created).toMatchObject({
      task: { runId: "run-client-task", language: "en-US", status: "queued" },
      event: { type: "run.started", language: "en-US", sequence: 1 },
    });
  });

  it("creates and reads Projects and Attempts through the shared client", async () => {
    const baseUrl = await startServer();
    const client = new RunRelayClient({ baseUrl });
    const project = await client.createProject();
    const created = await client.createTask({
      runId: "run-project-attempt-client",
      prompt: "Create a browser game with a reachable win condition.",
      language: "en-US",
      projectId: project.projectId,
    });
    await client.compileTaskAcceptanceContract(created.task.taskId, {
      contractVersion: 1,
      criteria: [{
        criterionId: "win-condition",
        sourceRequirement: "The game has a reachable win condition.",
        expected: "Normal player input reaches won state.",
        verification: { kind: "public-telemetry", path: "$.status" },
      }],
    });

    const attempt = await client.startAttempt({
      taskId: created.task.taskId,
      projectId: project.projectId,
    });
    const recovered = await client.startAttempt({
      taskId: created.task.taskId,
      projectId: project.projectId,
    });

    await expect(client.getProject(project.projectId)).resolves.toEqual(project);
    await expect(client.getAttempt(attempt.attemptId)).resolves.toEqual(attempt);
    expect(recovered).toEqual(attempt);
    expect(attempt).toMatchObject({
      taskId: created.task.taskId,
      projectId: project.projectId,
      state: "running",
    });
  });

  it("rejects retrying a running Attempt through the shared client", async () => {
    const baseUrl = await startServer();
    const client = new RunRelayClient({ baseUrl });
    const project = await client.createProject();
    const created = await client.createTask({
      runId: "run-attempt-retry-client",
      prompt: "Create a browser game that can be retried explicitly.",
      language: "en-US",
      projectId: project.projectId,
    });
    await client.compileTaskAcceptanceContract(created.task.taskId, {
      contractVersion: 1,
      criteria: [{
        criterionId: "retry-proof",
        sourceRequirement: "The game Attempt can be retried explicitly.",
        expected: "A retry creates a new immutable Attempt.",
        verification: { kind: "public-telemetry", path: "$.status" },
      }],
    });
    const first = await client.startAttempt({ taskId: created.task.taskId, projectId: project.projectId });
    await expect(client.retryAttempt(first.attemptId)).rejects.toMatchObject({ relayCode: "attempt_not_incomplete" });
    await expect(client.getAttempt(first.attemptId)).resolves.toEqual(first);
  });

  it("persists bounded incomplete Evidence while rejecting malformed present proof", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "gameforge-large-evidence-"));
    roots.push(root);
    const statePath = path.join(root, "relay-state.json");
    const store = new RunStore();
    const taskInbox = new TaskInbox(store);
    const projectAuthority = new ProjectAuthority(taskInbox);
    const persistence = new RelayStatePersistence(statePath);
    const baseUrl = await startServer({
      store,
      taskInbox,
      projectAuthority,
      persistState: () => persistence.save(store, taskInbox, projectAuthority),
    });
    const client = new RunRelayClient({ baseUrl });
    const project = await client.createProject();
    const prompt = "Create a browser game whose winning state is publicly observable.";
    const created = await client.createTask({
      runId: "run-incomplete-evidence-client",
      prompt,
      language: "en-US",
      projectId: project.projectId,
    });
    await client.compileTaskAcceptanceContract(created.task.taskId, {
      contractVersion: 1,
      criteria: [{
        criterionId: "winning-state",
        sourceRequirement: "The winning state is publicly observable.",
        expected: "Normal player input reaches won state.",
        verification: { kind: "public-telemetry", path: "$.status" },
      }],
    });
    await client.claimTask(created.task.taskId, { agentId: "codearts" });
    await expect(client.transitionTask(created.task.taskId, {
      status: "in-progress",
      agentId: "codearts",
    })).resolves.toMatchObject({ outcome: "accepted" });
    const first = await client.startAttempt({ taskId: created.task.taskId, projectId: project.projectId });
    const identity = {
      attemptId: first.attemptId,
      taskId: first.taskId,
      runId: created.task.runId,
      projectId: first.projectId,
      baseRevisionId: first.baseRevisionId ?? null,
      revisionId: first.revisionId,
      acceptanceContractFingerprint: first.acceptanceContractFingerprint,
      request: {
        normalized: prompt,
        fingerprint: createHash("sha256").update(prompt, "utf8").digest("hex"),
      },
    };

    const largeEvidence = {
      ...identity,
      build: {
        attemptId: first.attemptId,
        command: "vite.build",
        exitCode: 0,
        report: {
          metrics: {
            initial: { raw: 0, gzip: 0 },
            async: { raw: 0, gzip: 0 },
            total: { raw: 0, gzip: 0 },
            files: Array.from({ length: 2_500 }, (_, index) => ({
              path: `assets/${index}-${"x".repeat(490)}.js`,
              phase: "async" as const,
              raw: 0,
              gzip: 0,
            })),
          },
          limits: webGameBundleLimits,
          issues: [],
        },
      },
    };
    const largeEvidenceBody = JSON.stringify(largeEvidence);
    expect(Buffer.byteLength(largeEvidenceBody)).toBeGreaterThan(1024 * 1024);
    const largeEvidenceResponse = await fetch(`${baseUrl}/attempts/${first.attemptId}/evidence`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: largeEvidenceBody,
    });
    expect(largeEvidenceResponse.status).toBe(200);
    await expect(largeEvidenceResponse.json()).resolves.toEqual({
      status: "incomplete",
      reasonCode: "evidence.missing-required-proof.v1",
      attemptId: first.attemptId,
    });
    await expect(client.getAttempt(first.attemptId)).resolves.toMatchObject({
      state: "incomplete",
      incompleteReasonCode: "evidence.missing-required-proof.v1",
      incompleteEvidence: largeEvidence,
    });
    const restored = await new RelayStatePersistence(statePath).load();
    expect(restored.projectAuthority.getAttempt(first.attemptId)).toMatchObject({
      state: "incomplete",
      incompleteReasonCode: "evidence.missing-required-proof.v1",
      incompleteEvidence: largeEvidence,
    });

    const retry = await client.retryAttempt(first.attemptId);
    const retryTask = await client.getTask(retry.taskId);
    await expect(client.submitAttemptEvidence(retry.attemptId, {
      ...identity,
      attemptId: retry.attemptId,
      runId: retryTask.runId,
      revisionId: retry.revisionId,
      codeArts: {
        attemptId: first.attemptId,
        target: "deepseek-v3.2",
        clientVersion: "1.0.0",
        durationMs: 1,
        interventions: [],
      },
    })).rejects.toThrow("Evidence records must belong to the same Attempt");
    await expect(client.getAttempt(retry.attemptId)).resolves.toMatchObject({ state: "running" });
  });

  it("freezes directly traceable acceptance criteria through the public Authority operation", async () => {
    const baseUrl = await startServer();
    const client = new RunRelayClient({ baseUrl });
    const created = await client.createTask({
      runId: "run-freeze-acceptance",
      prompt: "Create a collection game with visible progress and a reviewed final appearance.",
      language: "en-US",
    });

    const result = await client.compileTaskAcceptanceContract(created.task.taskId, {
      contractVersion: 1,
      criteria: [
        {
          criterionId: "movement",
          sourceRequirement: "The player moves with the arrow keys.",
          expected: "Pressing ArrowRight moves the player to the right.",
          verification: { kind: "browser-action", action: "press ArrowRight" },
        },
        {
          criterionId: "score",
          sourceRequirement: "The score is publicly observable.",
          expected: "The collected count becomes 3.",
          verification: { kind: "public-telemetry", path: "$.collectedCount" },
        },
        {
          criterionId: "status",
          sourceRequirement: "The current objective is visible.",
          expected: "The objective text says Collect 3 stars.",
          verification: { kind: "dom-output", selector: "[data-game-status]" },
        },
        {
          criterionId: "final-frame",
          sourceRequirement: "The completed board is captured.",
          expected: "The player and all three collected stars are visible.",
          verification: { kind: "screenshot", checkpoint: "completed-board" },
        },
        {
          criterionId: "visual-review",
          sourceRequirement: "A human confirms the requested visual style.",
          expected: "The reviewer confirms the high-contrast arcade style.",
          verification: { kind: "human-review", prompt: "Review the completed game appearance." },
        },
      ],
    });

    expect(result).toMatchObject({
      schemaVersion: "1.0",
      outcome: "frozen",
      task: { taskId: created.task.taskId, status: "queued" },
      contract: { schemaVersion: "1.0", contractVersion: 1 },
    });
    if (result.outcome !== "frozen") throw new Error("Expected a frozen acceptance contract.");
    expect(result.contract.criteria).toHaveLength(5);
    expect(result.contract.fingerprint).toMatch(/^[a-f0-9]{64}$/);
    await expect(client.getTask(created.task.taskId)).resolves.toMatchObject({
      acceptanceContract: { fingerprint: result.contract.fingerprint },
    });
  });

  it.each([
    "missing",
    "conflicting",
    "unverifiable",
    "assumption-dependent",
  ] as const)("moves %s requirements to needs-info before implementation", async (code) => {
    const baseUrl = await startServer();
    const client = new RunRelayClient({ baseUrl });
    const created = await client.createTask({
      runId: `run-needs-info-${code}`,
      prompt: "Create a browser game only after every requirement is safe to implement.",
      language: "en-US",
    });

    const result = await client.compileTaskAcceptanceContract(created.task.taskId, {
      contractVersion: 1,
      criteria: [],
      requirementIssues: code === "missing" ? [] : [{ code, detail: `Requirement is ${code}.` }],
    });

    expect(result).toMatchObject({
      schemaVersion: "1.0",
      outcome: "needs-info",
      issues: [{ code }],
      task: {
        status: "needs-info",
        reasonCode: { schemaVersion: "1.0", code: "requirements-ambiguous" },
      },
    });
    await expect(client.claimTask(created.task.taskId, { agentId: "codearts" }))
      .rejects.toMatchObject({ relayCode: "task_not_queued" });
  });

  it.each([1, 2])("rejects changed acceptance content at non-advancing version %s", async (contractVersion) => {
    const baseUrl = await startServer();
    const client = new RunRelayClient({ baseUrl });
    const created = await client.createTask({
      runId: `run-contract-version-${contractVersion}`,
      prompt: "Create a game whose frozen acceptance versions advance monotonically.",
      language: "en-US",
    });
    const frozen = await client.compileTaskAcceptanceContract(created.task.taskId, {
      contractVersion: 2,
      criteria: [{
        criterionId: "goal",
        sourceRequirement: "Collect 3 stars.",
        expected: "The collected count becomes 3.",
        verification: { kind: "public-telemetry", path: "$.collectedStars" },
      }],
    });
    if (frozen.outcome !== "frozen") throw new Error("Expected version two to freeze.");

    await expect(client.compileTaskAcceptanceContract(created.task.taskId, {
      contractVersion,
      criteria: [{
        criterionId: "goal",
        sourceRequirement: "Collect 5 stars.",
        expected: "The collected count becomes 5.",
        verification: { kind: "public-telemetry", path: "$.collectedStars" },
      }],
    })).rejects.toMatchObject({ relayCode: "task_acceptance_version_conflict" });
    await expect(client.getTask(created.task.taskId)).resolves.toMatchObject({
      acceptanceContract: {
        contractVersion: 2,
        fingerprint: frozen.contract.fingerprint,
      },
    });
  });

  it("returns a stable invalid result for an unknown reason without changing the public Task bytes", async () => {
    const baseUrl = await startServer();
    const client = new RunRelayClient({ baseUrl });
    const created = await client.createTask({
      runId: "run-unknown-reason",
      prompt: "Create a browser game while preserving fail-closed Task state.",
      language: "en-US",
    });
    const before = JSON.stringify(await client.getTask(created.task.taskId));

    await expect(client.transitionTask(created.task.taskId, {
      status: "completed",
      reasonCode: { schemaVersion: "1.0", code: "unknown-failure" },
    })).resolves.toMatchObject({
      schemaVersion: "1.0",
      outcome: "invalid",
      code: "invalid-transition-request",
      task: { status: "queued" },
    });

    expect(JSON.stringify(await client.getTask(created.task.taskId))).toBe(before);
    await expect(client.transitionTask(created.task.taskId, {
      status: "needs-info",
      reasonCode: { schemaVersion: "1.0", code: "requirements-ambiguous" },
    })).resolves.toMatchObject({ outcome: "accepted", task: { status: "needs-info" } });
    await expect(client.getTask(created.task.taskId)).resolves.toMatchObject({
      status: "needs-info",
      reasonCode: { schemaVersion: "1.0", code: "requirements-ambiguous" },
    });
  });

  it("rejects Run append and completion while a Task needs information", async () => {
    const baseUrl = await startServer();
    const client = new RunRelayClient({ baseUrl });
    const created = await client.createTask({
      runId: "run-needs-info-guard",
      prompt: "Clarify this browser game before publishing any Run evidence.",
      language: "en-US",
    });
    await client.transitionTask(created.task.taskId, {
      status: "needs-info",
      reasonCode: { schemaVersion: "1.0", code: "requirements-ambiguous" },
    });

    await expect(client.publishEvents({
      runId: created.task.runId,
      after: 1,
      events: [],
    })).rejects.toMatchObject({ relayCode: "task_unclaimed" });
    await expect(client.completeRun(created.task.runId))
      .rejects.toMatchObject({ relayCode: "task_unclaimed" });
    await expect(client.getTask(created.task.taskId)).resolves.toMatchObject({ status: "needs-info" });
    await expect(client.replayEvents({ runId: created.task.runId, after: 0 })).resolves.toMatchObject({
      events: [expect.objectContaining({ type: "run.started", sequence: 1 })],
    });
  });

  it("creates a run, appends events, and replays a validated batch", async () => {
    const baseUrl = await startServer();
    const created = await fetch(`${baseUrl}/runs`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "http://localhost:4173" },
      body: JSON.stringify({ runId: "run-1" }),
    });
    expect(created.status).toBe(201);
    expect(created.headers.get("access-control-allow-origin")).toBe("http://localhost:4173");

    const appended = await fetch(`${baseUrl}/runs/run-1/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        runId: "run-1",
        after: 1,
        events: [{
          type: "log.appended",
          runId: "run-1",
          sequence: 2,
          emittedAt: "2026-07-16T06:00:00+08:00",
          source: "tool",
          level: "success",
          message: "Generated project",
        }],
      }),
    });
    expect(appended.status).toBe(202);

    const replay = await fetch(`${baseUrl}/runs/run-1/events?after=1`);
    expect(await replay.json()).toMatchObject({
      runId: "run-1",
      after: 1,
      events: [{ sequence: 2, type: "log.appended" }],
    });
  });

  it("recovers complete authoritative history after the live replay suffix expires", async () => {
    const baseUrl = await startServer({ maxEventsPerRun: 10 });
    const client = new RunRelayClient({ baseUrl });
    await client.createRun("run-authoritative-recovery");
    await client.publishEvents({
      runId: "run-authoritative-recovery",
      after: 1,
      events: Array.from({ length: 10 }, (_, index) => ({
        type: "log.appended" as const,
        runId: "run-authoritative-recovery",
        sequence: index + 2,
        emittedAt: "2026-07-30T10:00:00+08:00",
        source: "tool" as const,
        level: "success" as const,
        message: `Authoritative event ${index + 2}`,
      })),
    });

    await expect(client.replayEvents({ runId: "run-authoritative-recovery", after: 0 }))
      .resolves.toMatchObject({
        after: 0,
        events: Array.from({ length: 11 }, (_, index) => ({ sequence: index + 1 })),
      });
    const ahead = await fetch(`${baseUrl}/runs/run-authoritative-recovery/events?after=12`);
    expect(ahead.status).toBe(409);
    await expect(ahead.json()).resolves.toMatchObject({ error: "cursor_ahead" });
  });

  it("streams retained events over SSE", async () => {
    const baseUrl = await startServer();
    await fetch(`${baseUrl}/runs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ runId: "run-sse" }),
    });
    const controller = new AbortController();
    try {
      const response = await fetch(`${baseUrl}/runs/run-sse/stream?after=0`, { signal: controller.signal });
      expect(response.headers.get("content-type")).toContain("text/event-stream");
      const reader = response.body?.getReader();
      const chunk = await reader?.read();
      const text = new TextDecoder().decode(chunk?.value);
      expect(text).toContain("id: 1");
      expect(text).toContain('"type":"run.started"');
    } finally {
      controller.abort();
    }
  });

  it("rejects untrusted browser origins and stale cursors", async () => {
    const baseUrl = await startServer();
    const forbidden = await fetch(`${baseUrl}/runs`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://attacker.example" },
      body: JSON.stringify({ runId: "run-1" }),
    });
    expect(forbidden.status).toBe(403);

    await fetch(`${baseUrl}/runs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ runId: "run-1" }),
    });
    const stale = await fetch(`${baseUrl}/runs/run-1/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ runId: "run-1", after: 0, events: [] }),
    });
    expect(stale.status).toBe(409);
  });
});
