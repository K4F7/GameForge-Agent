export const BRIDGE_PROTOCOL_VERSION = 1 as const;
export const DEFAULT_BRIDGE_PORT = 47_653;
export const MIN_TOKEN_LENGTH = 32;

export interface BridgeHello {
  type: "hello";
  protocolVersion: typeof BRIDGE_PROTOCOL_VERSION;
  token: string;
  extensionVersion: string;
  devtool: "douyin";
}

export interface BridgeStatus {
  type: "status";
  requestId?: string;
  protocolVersion: typeof BRIDGE_PROTOCOL_VERSION;
  connected: true;
  workspaceFolders: string[];
  activeFile?: string;
  capabilities: readonly ["workspace-status", "runtime-status", "runtime-actions"];
  remoteOperations: "forbidden";
}

export interface BridgeRuntimeStatus {
  type: "runtimeStatus";
  requestId: string;
  protocolVersion: typeof BRIDGE_PROTOCOL_VERSION;
  available: boolean;
  target?: { id: string; type: string; title: string };
  contextCount?: number;
  gameContext?: {
    readyState: string;
    canvases: Array<{ width: number; height: number; clientWidth: number; clientHeight: number }>;
    hasTt: boolean;
    hasGameGlobal: boolean;
  };
  viewport?: { clientWidth?: number; clientHeight?: number; scale?: number; zoom?: number };
  error?: string;
  remoteOperations: "forbidden";
}

export interface StatusRequest {
  type: "getStatus";
  requestId: string;
}

export interface RuntimeStatusRequest {
  type: "getRuntimeStatus";
  requestId: string;
}

export type RuntimeAction = "reload" | "tap" | "screenshot" | "collectConsole";

export type RuntimeActionRequest =
  | { type: "runtimeAction"; requestId: string; action: "reload" | "screenshot" }
  | { type: "runtimeAction"; requestId: string; action: "tap"; x: number; y: number }
  | { type: "runtimeAction"; requestId: string; action: "collectConsole"; durationMs: number };

export interface RuntimeConsoleEntry {
  level: string;
  text: string;
  timestamp?: number;
}

export interface BridgeRuntimeActionResult {
  type: "runtimeActionResult";
  requestId: string;
  protocolVersion: typeof BRIDGE_PROTOCOL_VERSION;
  action: RuntimeAction;
  ok: boolean;
  screenshot?: { byteLength: number; sha256: string };
  console?: RuntimeConsoleEntry[];
  error?: string;
  remoteOperations: "forbidden";
}

export interface BridgeRendezvous {
  port: number;
  token: string;
  expiresAt: number;
}

export type ControllerRequest = StatusRequest | RuntimeStatusRequest | RuntimeActionRequest;
export type ExtensionMessage = BridgeHello | BridgeStatus | BridgeRuntimeStatus | BridgeRuntimeActionResult;

export function encodeMessage(message: ExtensionMessage): string {
  return `${JSON.stringify(message)}\n`;
}

export function parseControllerRequest(line: string): ControllerRequest | undefined {
  if (Buffer.byteLength(line, "utf8") > 8_192) return undefined;
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return undefined;
  }
  if (!isRecord(value)) return undefined;
  if (typeof value.requestId !== "string" || value.requestId.length === 0 || value.requestId.length > 128) {
    return undefined;
  }
  if (value.type === "getStatus" || value.type === "getRuntimeStatus") {
    return { type: value.type, requestId: value.requestId };
  }
  if (value.type !== "runtimeAction") return undefined;
  if (value.action === "reload" || value.action === "screenshot") {
    return { type: value.type, requestId: value.requestId, action: value.action };
  }
  if (value.action === "tap" && isBoundedCoordinate(value.x) && isBoundedCoordinate(value.y)) {
    return { type: value.type, requestId: value.requestId, action: value.action, x: value.x, y: value.y };
  }
  if (value.action === "collectConsole" && typeof value.durationMs === "number" && Number.isInteger(value.durationMs) && value.durationMs >= 0 && value.durationMs <= 5_000) {
    return { type: value.type, requestId: value.requestId, action: value.action, durationMs: value.durationMs };
  }
  return undefined;
}

export function readBridgeToken(environment: NodeJS.ProcessEnv): string | undefined {
  const token = environment.GAMEFORGE_DOUYIN_BRIDGE_TOKEN?.trim();
  return token !== undefined && token.length >= MIN_TOKEN_LENGTH ? token : undefined;
}

export function parseBridgeRendezvous(json: string, now = Date.now()): BridgeRendezvous | undefined {
  if (Buffer.byteLength(json, "utf8") > 4_096) return undefined;
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    return undefined;
  }
  if (!isRecord(value)) return undefined;
  const { port, token, expiresAt } = value;
  if (!Number.isInteger(port) || (port as number) < 1_024 || (port as number) > 65_535) return undefined;
  if (typeof token !== "string" || token.length < MIN_TOKEN_LENGTH || token.length > 256) return undefined;
  if (typeof expiresAt !== "number" || !Number.isFinite(expiresAt) || expiresAt <= now || expiresAt > now + 60_000) {
    return undefined;
  }
  return { port: port as number, token, expiresAt };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isBoundedCoordinate(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 4_096;
}
