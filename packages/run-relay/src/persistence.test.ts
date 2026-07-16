import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { RelayStatePersistence } from "./persistence.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("RelayStatePersistence", () => {
  it("atomically restores claimed tasks, run events, and terminal state", async () => {
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
            },
            engineering: { generator: true, verifier: true, preview: true, runRelay: true, taskInbox: true },
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
          emittedAt: "2026-07-16T13:00:02Z",
          projectId: "persisted-game",
          passed: true,
          outcome: "won",
          score: 5,
          lives: 2,
          remainingSeconds: 20,
          evidencePath: ".gameforge/verification/proof.png",
          canvas: { width: 960, height: 540 },
          diagnostics: { consoleErrors: 0, pageErrors: 0, failedRequests: 0 },
          actionsExecuted: 10,
          durationMs: 2_000,
        },
      ],
    });
    await persistence.save(first.store, first.taskInbox);

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
    second.taskInbox.finishRun("run-persisted", "run.completed");
    await new RelayStatePersistence(file).save(second.store, second.taskInbox);

    const third = await new RelayStatePersistence(file).load();
    expect(third.taskInbox.get(created.task.taskId)).toMatchObject({ status: "completed" });
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
    const firstSave = persistence.save(state.store, state.taskInbox);
    state.taskInbox.claim(created.task.taskId, { agentId: "codearts" });
    const secondSave = persistence.save(state.store, state.taskInbox);
    await Promise.all([firstSave, secondSave]);

    const restored = await new RelayStatePersistence(file).load();
    expect(restored.taskInbox.get(created.task.taskId)).toMatchObject({ status: "claimed" });
  });

  it("rejects relative paths and invalid snapshots", async () => {
    expect(() => new RelayStatePersistence("relay-state.json")).toThrow("absolute");
    const file = await stateFile();
    await writeFile(file, JSON.stringify({ schemaVersion: "1.0", savedAt: new Date().toISOString(), runs: [] }));
    await expect(new RelayStatePersistence(file).load()).rejects.toThrow();
    expect(await readFile(file, "utf8")).toContain("schemaVersion");
  });

  it("rejects snapshots whose task and run terminal states disagree", async () => {
    const file = await stateFile();
    const persistence = new RelayStatePersistence(file);
    const state = await persistence.load();
    state.taskInbox.create({
      runId: "run-inconsistent",
      prompt: "Create a browser game with consistent durable state.",
      language: "en-US",
    });
    await persistence.save(state.store, state.taskInbox);
    const corrupted = JSON.parse(await readFile(file, "utf8")) as {
      tasks: Array<Record<string, unknown>>;
    };
    const task = corrupted.tasks[0];
    if (task === undefined) throw new Error("Expected one persisted task.");
    task.status = "completed";
    task.completedAt = "2026-07-16T13:00:00Z";
    await writeFile(file, JSON.stringify(corrupted));

    await expect(new RelayStatePersistence(file).load()).rejects.toThrow("terminal states");
  });
});

async function stateFile(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "gameforge-relay-state-"));
  roots.push(root);
  const nested = path.join(root, "nested");
  await mkdir(nested);
  return path.join(nested, "relay-state.json");
}
