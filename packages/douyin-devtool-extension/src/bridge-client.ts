import { createConnection, type Socket } from "node:net";
import {
  BRIDGE_PROTOCOL_VERSION,
  encodeMessage,
  parseControllerRequest,
  type BridgeRuntimeStatus,
  type BridgeRuntimeActionResult,
  type RuntimeActionRequest,
  type BridgeStatus,
} from "./protocol.js";

export interface BridgeClientOptions {
  port: number;
  token: string;
  extensionVersion: string;
  getStatus: (requestId?: string) => Omit<BridgeStatus, "type" | "protocolVersion" | "connected">;
  getRuntimeStatus: (requestId: string) => Promise<Omit<BridgeRuntimeStatus, "type" | "protocolVersion">>;
  runRuntimeAction: (request: RuntimeActionRequest) => Promise<Omit<BridgeRuntimeActionResult, "type" | "protocolVersion">>;
  onStateChange?: (state: BridgeConnectionState) => void;
}

export type BridgeConnectionState = "disconnected" | "connecting" | "connected";

export class BridgeClient {
  private socket: Socket | undefined;
  private buffer = "";
  private state: BridgeConnectionState = "disconnected";

  constructor(private readonly options: BridgeClientOptions) {}

  get connectionState(): BridgeConnectionState {
    return this.state;
  }

  connect(): void {
    if (this.state !== "disconnected") return;
    this.setState("connecting");
    const socket = createConnection({ host: "127.0.0.1", port: this.options.port });
    this.socket = socket;
    socket.setEncoding("utf8");
    socket.on("connect", () => {
      if (this.socket !== socket) return;
      this.setState("connected");
      socket.write(
        encodeMessage({
          type: "hello",
          protocolVersion: BRIDGE_PROTOCOL_VERSION,
          token: this.options.token,
          extensionVersion: this.options.extensionVersion,
          devtool: "douyin",
        }),
      );
      this.writeStatus();
    });
    socket.on("data", (chunk: string) => this.handleData(socket, chunk));
    socket.on("error", () => this.finish(socket));
    socket.on("close", () => this.finish(socket));
  }

  disconnect(): void {
    const socket = this.socket;
    this.socket = undefined;
    this.buffer = "";
    this.setState("disconnected");
    socket?.destroy();
  }

  writeStatus(requestId?: string): void {
    if (this.socket === undefined || this.state !== "connected") return;
    this.socket.write(
      encodeMessage({
        type: "status",
        protocolVersion: BRIDGE_PROTOCOL_VERSION,
        connected: true,
        ...this.options.getStatus(requestId),
      }),
    );
  }

  async writeRuntimeStatus(requestId: string): Promise<void> {
    const socket = this.socket;
    if (socket === undefined || this.state !== "connected") return;
    const status = await this.options.getRuntimeStatus(requestId).catch(() => ({
      requestId,
      available: false,
      error: "Runtime probe failed.",
      remoteOperations: "forbidden" as const,
    }));
    if (this.socket !== socket || this.state !== "connected") return;
    socket.write(encodeMessage({ type: "runtimeStatus", protocolVersion: BRIDGE_PROTOCOL_VERSION, ...status }));
  }

  async writeRuntimeAction(request: RuntimeActionRequest): Promise<void> {
    const socket = this.socket;
    if (socket === undefined || this.state !== "connected") return;
    const result = await this.options.runRuntimeAction(request).catch(() => ({
      requestId: request.requestId,
      action: request.action,
      ok: false,
      error: "Runtime action failed.",
      remoteOperations: "forbidden" as const,
    }));
    if (this.socket !== socket || this.state !== "connected") return;
    socket.write(encodeMessage({ type: "runtimeActionResult", protocolVersion: BRIDGE_PROTOCOL_VERSION, ...result }));
  }

  private handleData(socket: Socket, chunk: string): void {
    if (this.socket !== socket) return;
    this.buffer += chunk;
    if (Buffer.byteLength(this.buffer, "utf8") > 16_384) {
      this.disconnect();
      return;
    }
    const lines = this.buffer.split("\n");
    this.buffer = lines.pop() ?? "";
    for (const line of lines) {
      const request = parseControllerRequest(line);
      if (request?.type === "getStatus") this.writeStatus(request.requestId);
      if (request?.type === "getRuntimeStatus") void this.writeRuntimeStatus(request.requestId);
      if (request?.type === "runtimeAction") void this.writeRuntimeAction(request);
    }
  }

  private finish(socket: Socket): void {
    if (this.socket !== socket) return;
    this.socket = undefined;
    this.buffer = "";
    this.setState("disconnected");
  }

  private setState(state: BridgeConnectionState): void {
    if (this.state === state) return;
    this.state = state;
    this.options.onStateChange?.(state);
  }
}
