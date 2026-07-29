import { randomUUID } from "node:crypto";
import { lstat, mkdir, open, realpath, rename, rm } from "node:fs/promises";
import path from "node:path";
import {
  attemptIdSchema,
  gameTaskIdSchema,
  mcpToolAuditDigest,
  mcpToolAuditSchema,
  runIdSchema,
  type McpToolAudit,
  type McpToolAuditCall,
  type McpToolAuditContext,
} from "@gameforge/contracts";

const MAX_AUDIT_BYTES = 4 * 1024 * 1024;
const MAX_CALLS = 10_000;

export type ToolAuditToken = {
  sequence: number;
  tool: string;
  startedAt: string;
  monotonicStart: number;
};

export interface ToolAuditRecorder {
  begin(tool: string): ToolAuditToken;
  finish(token: ToolAuditToken, outcome: "success" | "error"): Promise<void>;
}

export interface ToolAuditContextBinder {
  bindContext(taskId: string, runId: string, attemptId?: string): Promise<McpToolAuditContext>;
}

export type ToolAuditSummary = {
  runId: string;
  attemptId: string;
  audit: McpToolAudit;
  auditDigest: string;
  truncated: boolean;
  totalCalls: number;
  calls: ReadonlyArray<Pick<McpToolAuditCall, "sequence" | "tool" | "durationMs" | "outcome">>;
};

export interface ToolAuditSummaryProvider {
  getSummary(): Promise<ToolAuditSummary>;
}

export class McpToolAuditRecorder implements ToolAuditRecorder, ToolAuditContextBinder, ToolAuditSummaryProvider {
  readonly #auditPath: string;
  #audit: McpToolAudit;
  #nextSequence = 1;
  readonly #pending = new Map<number, McpToolAuditCall>();
  readonly #activeSequences = new Set<string>();
  readonly #tokenEpochs = new WeakMap<ToolAuditToken, string>();
  #queue: Promise<void> = Promise.resolve();
  #failed = false;
  #finalized = false;

  private constructor(auditPath: string, audit: McpToolAudit) {
    this.#auditPath = auditPath;
    this.#audit = audit;
  }

  static async create(auditPathInput: string): Promise<McpToolAuditRecorder> {
    const auditPath = validateAuditPath(auditPathInput);
    const parent = path.dirname(auditPath);
    await mkdir(parent, { recursive: true, mode: 0o700 });
    const parentStats = await lstat(parent);
    if (!parentStats.isDirectory() || parentStats.isSymbolicLink()) {
      throw new Error("MCP audit parent must be a real directory.");
    }
    await realpath(parent);
    const audit = mcpToolAuditSchema.parse({
      schemaVersion: 1,
      sessionId: randomUUID(),
      startedAt: new Date().toISOString(),
      truncated: false,
      calls: [],
    });
    await writeNewFile(auditPath, audit);
    return new McpToolAuditRecorder(auditPath, audit);
  }

  static async createInDirectory(directoryInput: string): Promise<McpToolAuditRecorder> {
    if (!path.isAbsolute(directoryInput)) {
      throw new Error("GAMEFORGE_MCP_AUDIT_DIR must be an absolute directory path.");
    }
    const directory = path.resolve(directoryInput);
    const timestamp = new Date().toISOString().replaceAll(":", "-");
    return McpToolAuditRecorder.create(path.join(directory, `mcp-audit-${timestamp}-${randomUUID()}.json`));
  }

  begin(tool: string): ToolAuditToken {
    const validated = mcpToolAuditCallSchemaTool(tool);
    const token = {
      sequence: this.#nextSequence++,
      tool: validated,
      startedAt: new Date().toISOString(),
      monotonicStart: performance.now(),
    };
    this.#tokenEpochs.set(token, this.#audit.sessionId);
    if (!this.#finalized) this.#activeSequences.add(tokenKey(this.#audit.sessionId, token.sequence));
    return token;
  }

  async finish(token: ToolAuditToken, outcome: "success" | "error"): Promise<void> {
    const tokenEpoch = this.#tokenEpochs.get(token);
    if (tokenEpoch !== undefined) this.#activeSequences.delete(tokenKey(tokenEpoch, token.sequence));
    if (this.#failed || this.#finalized || tokenEpoch !== this.#audit.sessionId) return;
    const call: McpToolAuditCall = {
      sequence: token.sequence,
      tool: token.tool,
      startedAt: token.startedAt,
      durationMs: Math.max(0, Math.round(performance.now() - token.monotonicStart)),
      outcome,
    };
    this.#queue = this.#queue.then(async () => {
      if (call.sequence > MAX_CALLS) {
        this.#audit.truncated = true;
      } else {
        this.#pending.set(call.sequence, call);
        let next = this.#audit.calls.length + 1;
        while (this.#pending.has(next)) {
          this.#audit.calls.push(this.#pending.get(next)!);
          this.#pending.delete(next);
          next += 1;
        }
      }
      await replaceAudit(this.#auditPath, this.#audit);
    }).catch(() => {
      if (!this.#failed) process.stderr.write("GameForge MCP tool audit write failed; tool execution continues.\n");
      this.#failed = true;
    });
    await this.#queue;
  }

  async bindContext(taskIdInput: string, runIdInput: string, attemptIdInput?: string): Promise<McpToolAuditContext> {
    if (this.#failed) throw new Error("MCP tool audit is unavailable.");
    const taskId = gameTaskIdSchema.parse(taskIdInput);
    const runId = runIdSchema.parse(runIdInput);
    const attemptId = attemptIdInput === undefined ? undefined : attemptIdSchema.parse(attemptIdInput);
    let conflict = false;
    let bound: McpToolAuditContext | undefined;
    this.#queue = this.#queue.then(async () => {
      const current = this.#audit.context;
      if (current !== undefined) {
        const exactBinding = current.taskId === taskId && current.runId === runId &&
          (attemptId === undefined || current.attemptId === undefined || current.attemptId === attemptId);
        const retryEpoch = this.#finalized && this.#activeSequences.size === 0 &&
          current.taskId === taskId && attemptId !== undefined && current.attemptId !== undefined &&
          current.runId !== runId && current.attemptId !== attemptId;
        if (retryEpoch) {
          const boundAt = new Date().toISOString();
          bound = { taskId, runId, attemptId, boundAt };
          this.#audit = mcpToolAuditSchema.parse({
            schemaVersion: 1,
            sessionId: randomUUID(),
            startedAt: boundAt,
            truncated: false,
            context: bound,
            calls: [],
          });
          this.#nextSequence = 1;
          this.#pending.clear();
          this.#finalized = false;
          await replaceAudit(this.#auditPath, this.#audit);
        } else if (!exactBinding) {
          conflict = true;
        } else if (attemptId !== undefined && current.attemptId === undefined) {
          current.attemptId = attemptId;
          bound = current;
          await replaceAudit(this.#auditPath, this.#audit);
        } else {
          bound = current;
        }
        return;
      }
      bound = {
        taskId,
        runId,
        ...(attemptId === undefined ? {} : { attemptId }),
        boundAt: new Date().toISOString(),
      };
      this.#audit.context = bound;
      await replaceAudit(this.#auditPath, this.#audit);
    }).catch(() => {
      if (!this.#failed) process.stderr.write("GameForge MCP tool audit write failed; tool execution continues.\n");
      this.#failed = true;
    });
    await this.#queue;
    if (conflict) throw new Error("MCP tool audit is already bound to another Task, Run, or Attempt.");
    if (this.#failed || bound === undefined) throw new Error("MCP tool audit context could not be persisted.");
    return bound;
  }

  async getSummary(): Promise<ToolAuditSummary> {
    await this.#queue;
    if (this.#failed) throw new Error("MCP tool audit is unavailable.");
    if (this.#audit.context?.attemptId === undefined) throw new Error("MCP tool audit is not bound to a Task, Run, and Attempt.");
    if (this.#activeSequences.size > 1) {
      throw new Error("MCP tool audit cannot finalize while another tool call is active.");
    }
    this.#finalized = true;
    const calls = this.#audit.calls.slice(-10_000).map(({ sequence, tool, durationMs, outcome }) => ({
      sequence,
      tool,
      durationMs,
      outcome,
    }));
    const audit = mcpToolAuditSchema.parse(structuredClone(this.#audit));
    return {
      runId: this.#audit.context.runId,
      attemptId: this.#audit.context.attemptId,
      audit,
      auditDigest: mcpToolAuditDigest(audit),
      truncated: this.#audit.truncated || this.#audit.calls.length > calls.length,
      totalCalls: this.#audit.calls.length,
      calls,
    };
  }
}

function mcpToolAuditCallSchemaTool(tool: string): string {
  return mcpToolAuditSchema.shape.calls.element.shape.tool.parse(tool);
}

function tokenKey(epochId: string, sequence: number): string {
  return `${epochId}:${sequence}`;
}

function validateAuditPath(value: string): string {
  const auditPath = path.resolve(value);
  if (!path.isAbsolute(value) || path.extname(auditPath).toLowerCase() !== ".json") {
    throw new Error("GAMEFORGE_MCP_AUDIT_FILE must be an absolute JSON file path.");
  }
  return auditPath;
}

async function writeNewFile(auditPath: string, audit: McpToolAudit): Promise<void> {
  const bytes = serialize(audit);
  const handle = await open(auditPath, "wx", 0o600);
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function replaceAudit(auditPath: string, audit: McpToolAudit): Promise<void> {
  const bytes = serialize(mcpToolAuditSchema.parse(audit));
  const temporaryPath = `${auditPath}.${randomUUID()}.tmp`;
  const handle = await open(temporaryPath, "wx", 0o600);
  try {
    await handle.writeFile(bytes);
    await handle.sync();
    await handle.close();
    await rename(temporaryPath, auditPath);
  } catch (error) {
    await handle.close().catch(() => undefined);
    await rm(temporaryPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

function serialize(audit: McpToolAudit): string {
  const value = `${JSON.stringify(audit, null, 2)}\n`;
  if (Buffer.byteLength(value) > MAX_AUDIT_BYTES) throw new Error("MCP tool audit exceeded its byte limit.");
  return value;
}
