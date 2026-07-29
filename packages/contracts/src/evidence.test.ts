import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { attemptSchema, bundleBudgetIssues, evidenceSealResultSchema, sealEvidence, webGameBundleLimits, type EvidenceAggregateInput } from "./index.js";

const attemptId = "attempt-11111111-1111-4111-8111-111111111111";

describe("Evidence aggregate", () => {
  const completeInput = (): EvidenceAggregateInput => {
    const files = [{ path: "dist/index.js", bytes: 10, sha256: "b".repeat(64) }];
    const metrics = {
      initial: { raw: 9_000, gzip: 4_000 },
      async: { raw: 80_000, gzip: 20_000 },
      total: { raw: 89_000, gzip: 24_000 },
      files: [
        { path: "dist/index.js", phase: "initial" as const, raw: 9_000, gzip: 4_000 },
        { path: "dist/chunk.js", phase: "async" as const, raw: 80_000, gzip: 20_000 },
      ],
    };
    return ({
      attemptId,
      taskId: "task-00000000-0000-0000-0000-000000000000",
      runId: "run-1",
      projectId: "demo-project",
      baseRevisionId: null,
      revisionId: "revision-22222222-2222-4222-8222-222222222222",
      acceptanceContractFingerprint: "d".repeat(64),
      criterionResults: [{ criterionId: "criterion-one", passed: true }],
      request: { normalized: "Create a demo game", fingerprint: "f63942f83ddd7d47cc4f448a2fbe016cd6ed8dbabe7f1e9b497ad448e28a28d9" },
      codeArts: { attemptId, target: "GLM", clientVersion: "1.0.0", durationMs: 1200, interventions: [] },
      mcpAudit: { attemptId, schemaVersion: 1, sessionId: "11111111-1111-4111-8111-111111111111", startedAt: "2026-07-29T00:00:00.000Z", truncated: false, context: { taskId: "task-00000000-0000-0000-0000-000000000000", runId: "run-1", attemptId, boundAt: "2026-07-29T00:00:00.000Z" }, calls: [{ sequence: 1, tool: "gameforge.verify", startedAt: "2026-07-29T00:00:00.000Z", durationMs: 1, outcome: "success" }] },
      artifacts: { schemaVersion: 1, projectId: "demo-project", attemptId, revisionId: "revision-22222222-2222-4222-8222-222222222222", totalBytes: 10, files, aggregateSha256: createHash("sha256").update(JSON.stringify(files)).digest("hex") },
      build: { attemptId, command: "vite.build", exitCode: 0, report: { metrics, limits: webGameBundleLimits, issues: bundleBudgetIssues(metrics, webGameBundleLimits) } },
      browserProof: { attemptId, projectId: "demo-project", revisionId: "revision-22222222-2222-4222-8222-222222222222", passed: true, actions: ["click:start"], outcome: "won", diagnostics: [], screenshots: [".gameforge/verification/won.png"], screenshotSha256: "e".repeat(64) },
      authorityEvents: [{ attemptId, event: { runId: "run-1", sequence: 1, emittedAt: "2026-07-29T00:00:01.000Z", type: "run.completed" } }],
      versions: { attemptId, contractVersion: 1, templateVersion: "1.0.0" },
    });
  };

  it("seals one complete Attempt into an immutable aggregate with a digest", () => {
    const result = sealEvidence(completeInput());

    expect(result.status).toBe("sealed");
    if (result.status !== "sealed") throw new Error("expected sealed evidence");
    expect(result.evidence.digest).toMatch(/^[a-f0-9]{64}$/);
    expect(Object.isFrozen(result.evidence)).toBe(true);
    expect(() => { (result.evidence as { attemptId: string }).attemptId = "other"; }).toThrow();
  });

  it("classifies missing proof as incomplete with a stable reason code", () => {
    const input = completeInput();
    input.mcpAudit.truncated = true;
    expect(sealEvidence(input)).toEqual({
      status: "incomplete",
      reasonCode: "evidence.missing-required-proof.v1",
      attemptId,
    });
  });

  it("fails closed when required artifacts or MCP calls are empty", () => {
    const noArtifacts = completeInput();
    noArtifacts.artifacts = undefined;
    expect(sealEvidence(noArtifacts)).toMatchObject({ status: "incomplete", reasonCode: "evidence.missing-required-proof.v1" });
    const noCalls = completeInput();
    noCalls.mcpAudit.calls = [];
    expect(sealEvidence(noCalls)).toMatchObject({ status: "incomplete", reasonCode: "evidence.missing-required-proof.v1" });
  });

  it("classifies empty screenshots as incomplete instead of rejecting the aggregate", () => {
    const input = completeInput();
    input.browserProof.screenshots = [];

    expect(sealEvidence(input)).toMatchObject({
      status: "incomplete",
      reasonCode: "evidence.missing-required-proof.v1",
    });
  });

  it("classifies empty Authority history as incomplete instead of rejecting the aggregate", () => {
    const input = completeInput();
    input.authorityEvents = [];

    expect(sealEvidence(input)).toMatchObject({
      status: "incomplete",
      reasonCode: "evidence.missing-required-proof.v1",
    });
  });

  it("classifies missing acceptance criterion results as incomplete", () => {
    const input = {
      ...completeInput(),
      criterionResults: [],
    };

    expect(sealEvidence(input as EvidenceAggregateInput)).toMatchObject({
      status: "incomplete",
      reasonCode: "evidence.missing-required-proof.v1",
    });
  });

  it("rejects duplicate acceptance criterion result IDs", () => {
    const input = completeInput();
    input.criterionResults.push({ criterionId: "criterion-one", passed: true });

    expect(() => sealEvidence(input)).toThrow("unique");
  });

  it("fails closed when the build exceeds the authoritative bundle budget", () => {
    const input = completeInput();
    input.build.report.metrics.initial.raw = webGameBundleLimits.initialRaw + 1;
    input.build.report.metrics.files[0]!.raw = webGameBundleLimits.initialRaw + 1;
    input.build.report.metrics.total.raw = webGameBundleLimits.initialRaw + 1 + input.build.report.metrics.async.raw;
    input.build.report.issues = bundleBudgetIssues(input.build.report.metrics, webGameBundleLimits);
    expect(sealEvidence(input)).toMatchObject({ status: "incomplete", reasonCode: "evidence.missing-required-proof.v1" });
  });

  it("classifies an empty bundle measurement as missing build proof", () => {
    const input = completeInput();
    input.build.report.metrics = {
      initial: { raw: 0, gzip: 0 },
      async: { raw: 0, gzip: 0 },
      total: { raw: 0, gzip: 0 },
      files: [],
    };
    input.build.report.issues = [];

    expect(sealEvidence(input)).toEqual({
      status: "incomplete",
      reasonCode: "evidence.missing-required-proof.v1",
      attemptId,
    });
  });

  it("fails closed when caller-selected limits hide an over-budget report", () => {
    const input = completeInput();
    const limits = {
      initialRaw: 10_000_000,
      initialGzip: 10_000_000,
      asyncRaw: 10_000_000,
      asyncGzip: 10_000_000,
      totalRaw: 10_000_000,
      totalGzip: 10_000_000,
    };
    input.build = {
      attemptId,
        command: "vite.build",
      exitCode: 0,
      report: {
        metrics: {
          initial: { raw: 10_001, gzip: 1 },
          async: { raw: 1, gzip: 1 },
          total: { raw: 10_002, gzip: 2 },
          files: [
            { path: "dist/index.js", phase: "initial", raw: 10_001, gzip: 1 },
            { path: "dist/chunk.js", phase: "async", raw: 1, gzip: 1 },
          ],
        },
        limits,
        issues: [],
      },
    } as EvidenceAggregateInput["build"];

    expect(() => sealEvidence(input)).toThrow("authoritative limits and measurements");
  });

  it("rejects bundle aggregates that contradict their per-file measurements", () => {
    const input = completeInput();
    input.build.report.metrics.total.raw += 1;

    expect(() => sealEvidence(input)).toThrow("file measurements");
  });

  it("fails closed when browser verification completed without passing", () => {
    const input = completeInput();
    input.browserProof.passed = false;
    expect(sealEvidence(input)).toMatchObject({ status: "incomplete", reasonCode: "evidence.missing-required-proof.v1" });
  });

  it("fails closed when browser proof claims passed but reports a lost outcome", () => {
    const input = completeInput();
    input.browserProof.outcome = "lost";

    expect(sealEvidence(input)).toMatchObject({
      status: "incomplete",
      reasonCode: "evidence.missing-required-proof.v1",
    });
  });

  it("fails closed when browser proof claims passed with diagnostics", () => {
    const input = completeInput();
    input.browserProof.diagnostics = ["console exploded"];

    expect(sealEvidence(input)).toMatchObject({
      status: "incomplete",
      reasonCode: "evidence.missing-required-proof.v1",
    });
  });

  it("rejects browser proof issued for another candidate Revision", () => {
    const input = completeInput();
    (input.browserProof as EvidenceAggregateInput["browserProof"] & { revisionId: string }).revisionId =
      "revision-99999999-9999-4999-8999-999999999999";

    expect(() => sealEvidence(input)).toThrow("same Attempt, Project, and Revision");
  });

  it("rejects screenshots outside the bounded verification evidence directory", () => {
    const input = completeInput();
    input.browserProof.screenshots = ["C:/screenshots/untrusted.png"];
    expect(() => sealEvidence(input)).toThrow();
  });

  it("binds the sealed screenshot path to its captured content digest", () => {
    const first = sealEvidence(completeInput());
    const changed = completeInput();
    changed.browserProof.screenshotSha256 = "f".repeat(64);
    const second = sealEvidence(changed);
    expect(first.status).toBe("sealed");
    expect(second.status).toBe("sealed");
    if (first.status !== "sealed" || second.status !== "sealed") throw new Error("expected sealed evidence");
    expect(second.evidence.digest).not.toBe(first.evidence.digest);
  });

  it("rejects an artifact aggregate that does not describe its file records", () => {
    const input = completeInput();
    input.artifacts!.aggregateSha256 = "a".repeat(64);
    expect(() => sealEvidence(input)).toThrow("Artifact aggregate");
  });

  it("rejects corrupt artifact integrity even when another proof is incomplete", () => {
    const input = completeInput();
    input.mcpAudit.truncated = true;
    input.artifacts!.aggregateSha256 = "a".repeat(64);

    expect(() => sealEvidence(input)).toThrow("Artifact aggregate");
  });

  it("accepts the authoritative candidate content manifest without reshaping it", () => {
    const input = completeInput();
    const files = [{ path: "dist/index.js", bytes: 10, sha256: "b".repeat(64) }];
    const canonical = {
      ...input,
      artifacts: {
        schemaVersion: 1,
        projectId: input.projectId,
        attemptId: input.attemptId,
        revisionId: input.revisionId,
        totalBytes: 10,
        aggregateSha256: createHash("sha256").update(JSON.stringify(files)).digest("hex"),
        files,
      },
    };

    expect(sealEvidence(canonical as EvidenceAggregateInput).status).toBe("sealed");
  });

  it("rejects candidate artifact paths outside the project", () => {
    const input = completeInput();
    input.artifacts!.files[0]!.path = "C:/outside/index.js";

    expect(() => sealEvidence(input)).toThrow("normalized and relative");
  });

  it("rejects evidence records belonging to another Attempt", () => {
    const input = completeInput();
    input.authorityEvents[0]!.attemptId = "attempt-33333333-3333-4333-8333-333333333333";
    expect(() => sealEvidence(input)).toThrow("same Attempt");
  });

  it("rejects an Authority event whose internal Attempt differs from its wrapper", () => {
    const input = completeInput();
    input.authorityEvents = [{
      attemptId: input.attemptId,
      event: {
        runId: input.runId,
        sequence: 1,
        emittedAt: "2026-07-29T00:00:01.000Z",
        type: "mcp.audit.ready",
        attemptId: "attempt-99999999-9999-4999-8999-999999999999",
        truncated: false,
        totalCalls: 1,
        calls: [{ sequence: 1, tool: "gameforge.verify", durationMs: 1, outcome: "success" }],
      },
    }];

    expect(() => sealEvidence(input)).toThrow("same Attempt");
  });

  it("rejects an MCP audit bound to another Task", () => {
    const input = completeInput();
    const uniqueAttemptId = "attempt-44444444-4444-4444-8444-444444444444";
    input.attemptId = uniqueAttemptId;
    input.codeArts.attemptId = uniqueAttemptId;
    input.mcpAudit.attemptId = uniqueAttemptId;
    input.artifacts!.attemptId = uniqueAttemptId;
    input.build.attemptId = uniqueAttemptId;
    input.browserProof.attemptId = uniqueAttemptId;
    input.versions.attemptId = uniqueAttemptId;
    input.authorityEvents[0]!.attemptId = uniqueAttemptId;
    input.mcpAudit.context = { taskId: "task-99999999-9999-4999-8999-999999999999", runId: "run-1", attemptId: input.attemptId, boundAt: "2026-07-29T00:00:00.000Z" };
    expect(() => sealEvidence(input)).toThrow("same Task");
  });

  it("rejects arbitrary Authority event types", () => {
    const input = completeInput();
    input.authorityEvents[0]!.event = { ...input.authorityEvents[0]!.event, type: "bogus.event" } as never;
    expect(() => sealEvidence(input)).toThrow();
  });

  it("rejects a request fingerprint that does not describe the normalized request", () => {
    const input = completeInput();
    input.request.fingerprint = "a".repeat(64);
    expect(() => sealEvidence(input)).toThrow("fingerprint");
  });

  it("rejects conflicting digests at the serialized passed Attempt boundary", () => {
    const sealed = sealEvidence(completeInput());
    if (sealed.status !== "sealed") throw new Error("expected sealed evidence");

    expect(() => attemptSchema.parse({
      attemptId: sealed.evidence.attemptId,
      taskId: sealed.evidence.taskId,
      runId: sealed.evidence.runId,
      projectId: sealed.evidence.projectId,
      revisionId: sealed.evidence.revisionId,
      acceptanceContractFingerprint: sealed.evidence.acceptanceContractFingerprint,
      state: "passed",
      sealedDigest: "a".repeat(64),
      sealedEvidence: sealed.evidence,
    })).toThrow("digests must match");
  });

  it("rejects sealed evidence whose identities differ from its enclosing Attempt", () => {
    const sealed = sealEvidence(completeInput());
    if (sealed.status !== "sealed") throw new Error("expected sealed evidence");

    expect(() => attemptSchema.parse({
      attemptId: "attempt-99999999-9999-4999-8999-999999999999",
      taskId: sealed.evidence.taskId,
      runId: sealed.evidence.runId,
      projectId: sealed.evidence.projectId,
      revisionId: sealed.evidence.revisionId,
      acceptanceContractFingerprint: sealed.evidence.acceptanceContractFingerprint,
      state: "passed",
      sealedDigest: sealed.evidence.digest,
      sealedEvidence: sealed.evidence,
    })).toThrow("identities must match");
  });

  it.each(["passed", "incomplete"] as const)(
    "deeply freezes wire-parsed %s Attempt Evidence without breaking serialization",
    (state) => {
      const input = completeInput();
      if (state === "incomplete") input.mcpAudit.truncated = true;
      const sealed = sealEvidence(completeInput());
      if (sealed.status !== "sealed") throw new Error("expected sealed evidence");
      const parsed = attemptSchema.parse(state === "passed" ? {
        attemptId: sealed.evidence.attemptId,
        taskId: sealed.evidence.taskId,
        runId: sealed.evidence.runId,
        projectId: sealed.evidence.projectId,
        revisionId: sealed.evidence.revisionId,
        acceptanceContractFingerprint: sealed.evidence.acceptanceContractFingerprint,
        state,
        sealedDigest: sealed.evidence.digest,
        sealedEvidence: sealed.evidence,
      } : {
        attemptId: input.attemptId,
        taskId: input.taskId,
        runId: input.runId,
        projectId: input.projectId,
        revisionId: input.revisionId,
        acceptanceContractFingerprint: input.acceptanceContractFingerprint,
        state,
        incompleteReasonCode: "evidence.missing-required-proof.v1",
        incompleteEvidence: input,
      });
      if (parsed.state === "running") throw new Error("expected terminal Attempt");
      const evidence = parsed.state === "passed" ? parsed.sealedEvidence : parsed.incompleteEvidence;
      if (evidence.browserProof === undefined || evidence.mcpAudit === undefined) {
        throw new Error("expected complete fixture proof");
      }
      const { browserProof, mcpAudit } = evidence;

      expect(Object.isFrozen(browserProof.actions)).toBe(true);
      expect(Object.isFrozen(mcpAudit.calls[0])).toBe(true);
      expect(() => {
        (browserProof.actions as string[]).push("click:mutated");
      }).toThrow(TypeError);
      expect(JSON.parse(JSON.stringify(parsed))).toMatchObject({ state, attemptId: input.attemptId });
    },
  );

  it("validates and deeply freezes a sealed Evidence result parsed from the wire", () => {
    const sealed = sealEvidence(completeInput());
    if (sealed.status !== "sealed") throw new Error("expected sealed evidence");
    const wire = JSON.parse(JSON.stringify(sealed)) as {
      status: "sealed";
      evidence: { digest: string; browserProof: { actions: string[] } };
    };
    const tampered = structuredClone(wire);
    tampered.evidence.browserProof.actions[0] = "tampered after sealing";

    expect(() => evidenceSealResultSchema.parse(tampered)).toThrow("digest");
    const parsed = evidenceSealResultSchema.parse(wire);
    if (parsed.status !== "sealed") throw new Error("expected parsed sealed evidence");
    expect(Object.isFrozen(parsed)).toBe(true);
    expect(Object.isFrozen(parsed.evidence.browserProof.actions)).toBe(true);
  });

  it("rejects serialized passed Attempts whose sealed proof is incomplete", () => {
    const sealed = sealEvidence(completeInput());
    if (sealed.status !== "sealed") throw new Error("expected sealed evidence");
    const incompleteEvidence = structuredClone(sealed.evidence) as EvidenceAggregateInput & {
      digest: string;
      status: "sealed";
    };
    incompleteEvidence.mcpAudit.truncated = true;

    expect(() => attemptSchema.parse({
      attemptId: incompleteEvidence.attemptId,
      taskId: incompleteEvidence.taskId,
      runId: incompleteEvidence.runId,
      projectId: incompleteEvidence.projectId,
      revisionId: incompleteEvidence.revisionId,
      acceptanceContractFingerprint: incompleteEvidence.acceptanceContractFingerprint,
      state: "passed",
      sealedDigest: incompleteEvidence.digest,
      sealedEvidence: incompleteEvidence,
    })).toThrow("complete sealed proof");
  });

  it("rejects serialized incomplete Attempts with invalid Evidence associations or integrity", () => {
    const incompleteInput = completeInput();
    incompleteInput.mcpAudit.truncated = true;
    const serializedAttempt = (evidence: EvidenceAggregateInput, overrides: Record<string, unknown> = {}) => ({
      attemptId: evidence.attemptId,
      taskId: evidence.taskId,
      runId: evidence.runId,
      projectId: evidence.projectId,
      revisionId: evidence.revisionId,
      baseRevisionId: evidence.baseRevisionId ?? undefined,
      acceptanceContractFingerprint: evidence.acceptanceContractFingerprint,
      state: "incomplete",
      incompleteReasonCode: "evidence.missing-required-proof.v1",
      incompleteEvidence: evidence,
      ...overrides,
    });
    const otherAttemptId = "attempt-99999999-9999-4999-8999-999999999999";
    const otherTaskId = "task-99999999-9999-4999-8999-999999999999";
    const otherRevisionId = "revision-99999999-9999-4999-8999-999999999999";

    const corruptions: Array<(evidence: EvidenceAggregateInput) => Record<string, unknown> | void> = [
      () => ({ attemptId: otherAttemptId }),
      () => ({ taskId: otherTaskId }),
      () => ({ projectId: "other-project" }),
      () => ({ revisionId: otherRevisionId }),
      () => ({ baseRevisionId: otherRevisionId }),
      () => ({ acceptanceContractFingerprint: "a".repeat(64) }),
      (evidence) => { evidence.codeArts.attemptId = otherAttemptId; },
      (evidence) => { evidence.mcpAudit.context!.taskId = otherTaskId; },
      (evidence) => { evidence.mcpAudit.context!.runId = "other-run"; },
      (evidence) => { evidence.browserProof.projectId = "other-project"; },
      (evidence) => { evidence.browserProof.revisionId = otherRevisionId; },
      (evidence) => { evidence.request.fingerprint = "a".repeat(64); },
      (evidence) => { evidence.artifacts!.aggregateSha256 = "a".repeat(64); },
    ];

    for (const corrupt of corruptions) {
      const evidence = structuredClone(incompleteInput);
      const overrides = corrupt(evidence) ?? {};
      expect(attemptSchema.safeParse(serializedAttempt(evidence, overrides)).success).toBe(false);
    }
  });

  it("rejects malformed present proof in a partial serialized incomplete Attempt", () => {
    const serializedAttempt = (evidence: Record<string, unknown>) => ({
      attemptId,
      taskId: "task-00000000-0000-0000-0000-000000000000",
      runId: "run-1",
      projectId: "demo-project",
      revisionId: "revision-22222222-2222-4222-8222-222222222222",
      acceptanceContractFingerprint: "d".repeat(64),
      state: "incomplete",
      incompleteReasonCode: "evidence.missing-required-proof.v1",
      incompleteEvidence: evidence,
    });
    const corruptions: Array<(evidence: Record<string, any>) => void> = [
      (evidence) => { evidence.request.fingerprint = "a".repeat(64); },
      (evidence) => { evidence.codeArts.attemptId = "attempt-99999999-9999-4999-8999-999999999999"; },
      (evidence) => { evidence.mcpAudit.context.taskId = "task-99999999-9999-4999-8999-999999999999"; },
      (evidence) => { evidence.mcpAudit.context.runId = "other-run"; },
      (evidence) => { evidence.artifacts.projectId = "other-project"; },
      (evidence) => { evidence.artifacts.aggregateSha256 = "a".repeat(64); },
      (evidence) => { evidence.build.attemptId = "attempt-99999999-9999-4999-8999-999999999999"; },
      (evidence) => { evidence.authorityEvents[0].attemptId = "attempt-99999999-9999-4999-8999-999999999999"; },
      (evidence) => { evidence.authorityEvents[0].event.runId = "other-run"; },
      (evidence) => { evidence.versions.attemptId = "attempt-99999999-9999-4999-8999-999999999999"; },
    ];

    for (const corrupt of corruptions) {
      const evidence = structuredClone(completeInput()) as unknown as Record<string, any>;
      delete evidence.browserProof;
      corrupt(evidence);
      expect(attemptSchema.safeParse(serializedAttempt(evidence)).success).toBe(false);
    }
  });

  it("requires explicit missing criterion IDs when complete Evidence is contract-relative incomplete", () => {
    const complete = completeInput();
    const serialized = {
      attemptId: complete.attemptId,
      taskId: complete.taskId,
      runId: complete.runId,
      projectId: complete.projectId,
      revisionId: complete.revisionId,
      acceptanceContractFingerprint: complete.acceptanceContractFingerprint,
      state: "incomplete",
      incompleteReasonCode: "evidence.missing-required-proof.v1",
      incompleteEvidence: complete,
    } as const;

    expect(attemptSchema.safeParse(serialized).success).toBe(false);
    expect(attemptSchema.safeParse({
      ...serialized,
      missingCriterionIds: ["visual-review"],
    }).success).toBe(true);
    expect(attemptSchema.safeParse({
      ...serialized,
      missingCriterionIds: [complete.criterionResults[0]!.criterionId],
    }).success).toBe(false);
  });

});
