import { randomBytes, timingSafeEqual } from "node:crypto";
import { lstat, rename, rm, writeFile } from "node:fs/promises";
import { createServer, type Server, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const PROTOCOL_VERSION = 1;
const MAX_BUFFER_BYTES = 16_384;
const DEFAULT_REQUEST_TIMEOUT_MS = 45_000;

export type DouyinRuntimeAction =
  | { action: "reload" | "screenshot" }
  | { action: "tap"; x: number; y: number }
  | { action: "collectConsole"; durationMs: number };

export interface DouyinBridgeControllerStatus {
  listening: boolean;
  connected: boolean;
  extensionVersion?: string;
  workspaceStatus?: Record<string, unknown>;
}

export interface DouyinBridgePort {
  getStatus(): DouyinBridgeControllerStatus;
  getRuntimeStatus(): Promise<Record<string, unknown>>;
  runRuntimeAction(action: DouyinRuntimeAction): Promise<Record<string, unknown>>;
}

export class DouyinBridgeController implements DouyinBridgePort {
  private server: Server | undefined;
  private socket: Socket | undefined;
  private token: string | undefined;
  private buffer = "";
  private authenticated = false;
  private extensionVersion: string | undefined;
  private workspaceStatus: Record<string, unknown> | undefined;
  private requestSequence = 0;
  private readonly pending = new Map<string, { resolve: (value: Record<string, unknown>) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }>();

  constructor(
    private readonly rendezvousPath = resolve(tmpdir(), "gameforge-douyin-bridge.json"),
    private readonly requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
  ) {
    if (!Number.isInteger(requestTimeoutMs) || requestTimeoutMs < 1_000 || requestTimeoutMs > 60_000) {
      throw new Error("Douyin bridge request timeout must be between 1000 and 60000 milliseconds.");
    }
  }

  async start(): Promise<void> {
    if (this.server !== undefined) return;
    const token = randomBytes(32).toString("base64url");
    const server = createServer((socket) => this.accept(socket));
    await new Promise<void>((resolveListen, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolveListen);
    });
    const address = server.address();
    if (address === null || typeof address === "string") {
      server.close();
      throw new Error("Failed to allocate the Douyin bridge loopback port.");
    }
    this.server = server;
    this.token = token;
    await this.writeRendezvous(address.port, token).catch(async (error) => {
      await this.stop();
      throw error;
    });
  }

  async stop(): Promise<void> {
    this.socket?.destroy();
    this.socket = undefined;
    this.authenticated = false;
    this.rejectPending(new Error("Douyin bridge disconnected."));
    const server = this.server;
    this.server = undefined;
    if (server !== undefined) await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
    await rm(this.rendezvousPath, { force: true }).catch(() => undefined);
  }

  getStatus(): DouyinBridgeControllerStatus {
    return {
      listening: this.server !== undefined,
      connected: this.authenticated && this.socket !== undefined,
      ...(this.extensionVersion === undefined ? {} : { extensionVersion: this.extensionVersion }),
      ...(this.workspaceStatus === undefined ? {} : { workspaceStatus: this.workspaceStatus }),
    };
  }

  async getRuntimeStatus(): Promise<Record<string, unknown>> {
    return this.request({ type: "getRuntimeStatus" });
  }

  async runRuntimeAction(action: DouyinRuntimeAction): Promise<Record<string, unknown>> {
    return this.request({ type: "runtimeAction", ...action });
  }

  private accept(socket: Socket): void {
    if (this.socket !== undefined) {
      socket.destroy();
      return;
    }
    this.socket = socket;
    socket.setEncoding("utf8");
    socket.on("data", (chunk: string) => this.handleData(socket, chunk));
    socket.on("error", () => this.finish(socket));
    socket.on("close", () => this.finish(socket));
  }

  private handleData(socket: Socket, chunk: string): void {
    if (this.socket !== socket) return;
    this.buffer += chunk;
    if (Buffer.byteLength(this.buffer, "utf8") > MAX_BUFFER_BYTES) {
      socket.destroy();
      return;
    }
    const lines = this.buffer.split("\n");
    this.buffer = lines.pop() ?? "";
    for (const line of lines) {
      let message: unknown;
      try { message = JSON.parse(line); } catch { socket.destroy(); return; }
      if (!isRecord(message)) { socket.destroy(); return; }
      if (!this.authenticated) {
        if (!this.authenticate(message)) { socket.destroy(); return; }
        this.authenticated = true;
        continue;
      }
      if (message.type === "status" && message.protocolVersion === PROTOCOL_VERSION && message.remoteOperations === "forbidden") {
        this.workspaceStatus = message;
        continue;
      }
      const requestId = typeof message.requestId === "string" ? message.requestId : undefined;
      if (requestId === undefined) continue;
      const waiter = this.pending.get(requestId);
      if (waiter === undefined) continue;
      this.pending.delete(requestId);
      clearTimeout(waiter.timer);
      waiter.resolve(message);
    }
  }

  private authenticate(message: Record<string, unknown>): boolean {
    if (message.type !== "hello" || message.protocolVersion !== PROTOCOL_VERSION || message.devtool !== "douyin" ||
        typeof message.token !== "string" || typeof message.extensionVersion !== "string" || this.token === undefined) return false;
    const expected = Buffer.from(this.token);
    const actual = Buffer.from(message.token);
    if (expected.byteLength !== actual.byteLength || !timingSafeEqual(expected, actual)) return false;
    this.extensionVersion = message.extensionVersion.slice(0, 64);
    return true;
  }

  private request(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    const socket = this.socket;
    if (socket === undefined || !this.authenticated) return Promise.reject(new Error("Douyin DevTool bridge is not connected."));
    const requestId = `mcp-${++this.requestSequence}`;
    const result = new Promise<Record<string, unknown>>((resolveRequest, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error("Timed out waiting for the Douyin DevTool bridge."));
      }, this.requestTimeoutMs);
      this.pending.set(requestId, { resolve: resolveRequest, reject, timer });
    });
    socket.write(`${JSON.stringify({ ...payload, requestId })}\n`);
    return result;
  }

  private finish(socket: Socket): void {
    if (this.socket !== socket) return;
    this.socket = undefined;
    this.buffer = "";
    this.authenticated = false;
    this.rejectPending(new Error("Douyin DevTool bridge disconnected."));
  }

  private rejectPending(error: Error): void {
    for (const waiter of this.pending.values()) {
      clearTimeout(waiter.timer);
      waiter.reject(error);
    }
    this.pending.clear();
  }

  private async writeRendezvous(port: number, token: string): Promise<void> {
    try {
      const metadata = await lstat(this.rendezvousPath);
      if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error("The Douyin bridge rendezvous path is unsafe.");
      await rm(this.rendezvousPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const temporaryPath = `${this.rendezvousPath}.${process.pid}.tmp`;
    await writeFile(temporaryPath, JSON.stringify({ port, token, expiresAt: Date.now() + 60_000 }), { encoding: "utf8", mode: 0o600, flag: "wx" });
    await rename(temporaryPath, this.rendezvousPath);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
