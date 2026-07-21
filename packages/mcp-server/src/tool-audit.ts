import { randomUUID } from "node:crypto";
import { lstat, mkdir, open, realpath, rename, rm } from "node:fs/promises";
import path from "node:path";
import {
  gameTaskIdSchema,
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
  bindContext(taskId: string, runId: string): Promise<McpToolAuditContext>;
}

export type ToolAuditSummary = {
  runId: string;
  truncated: boolean;
  totalCalls: number;
  calls: ReadonlyArray<Pick<McpToolAuditCall, "sequence" | "tool" | "durationMs" | "outcome">>;
};

export interface ToolAuditSummaryProvider {
  getSummary(): Promise<ToolAuditSummary>;
}

export class McpToolAuditRecorder implements ToolAuditRecorder, ToolAuditContextBinder, ToolAuditSummaryProvider {
  readonly #auditPath: string;
  readonly #audit: McpToolAudit;
  #nextSequence = 1;
  readonly #pending = new Map<number, McpToolAuditCall>();
  #queue: Promise<void> = Promise.resolve();
  #failed = false;

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
    return {
      sequence: this.#nextSequence++,
      tool: validated,
      startedAt: new Date().toISOString(),
      monotonicStart: performance.now(),
    };
  }

  async finish(token: ToolAuditToken, outcome: "success" | "error"): Promise<void> {
    if (this.#failed) return;
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

  async bindContext(taskIdInput: string, runIdInput: string): Promise<McpToolAuditContext> {
    if (this.#failed) throw new Error("MCP tool audit is unavailable.");
    const taskId = gameTaskIdSchema.parse(taskIdInput);
    const runId = runIdSchema.parse(runIdInput);
    let conflict = false;
    let bound: McpToolAuditContext | undefined;
    this.#queue = this.#queue.then(async () => {
      const current = this.#audit.context;
      if (current !== undefined) {
        if (current.taskId !== taskId || current.runId !== runId) conflict = true;
        else bound = current;
        return;
      }
      bound = { taskId, runId, boundAt: new Date().toISOString() };
      this.#audit.context = bound;
      await replaceAudit(this.#auditPath, this.#audit);
    }).catch(() => {
      if (!this.#failed) process.stderr.write("GameForge MCP tool audit write failed; tool execution continues.\n");
      this.#failed = true;
    });
    await this.#queue;
    if (conflict) throw new Error("MCP tool audit is already bound to another Task or Run.");
    if (this.#failed || bound === undefined) throw new Error("MCP tool audit context could not be persisted.");
    return bound;
  }

  async getSummary(): Promise<ToolAuditSummary> {
    await this.#queue;
    if (this.#failed) throw new Error("MCP tool audit is unavailable.");
    if (this.#audit.context === undefined) throw new Error("MCP tool audit is not bound to a Task and Run.");
    const calls = this.#audit.calls.slice(-200).map(({ sequence, tool, durationMs, outcome }) => ({
      sequence,
      tool,
      durationMs,
      outcome,
    }));
    return {
      runId: this.#audit.context.runId,
      truncated: this.#audit.truncated || this.#audit.calls.length > calls.length,
      totalCalls: this.#audit.calls.length,
      calls,
    };
  }
}

function mcpToolAuditCallSchemaTool(tool: string): string {
  return mcpToolAuditSchema.shape.calls.element.shape.tool.parse(tool);
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
