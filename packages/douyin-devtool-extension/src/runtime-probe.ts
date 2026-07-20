import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import { resolve } from "node:path";

export interface RuntimeCanvas {
  width: number;
  height: number;
  clientWidth: number;
  clientHeight: number;
}

export interface RuntimeContextStatus {
  title: string;
  readyState: string;
  canvases: RuntimeCanvas[];
  iframeCount: number;
  hasTt: boolean;
  hasGameGlobal: boolean;
}

export interface RuntimeProbeResult {
  cdpPort: number;
  target: { id: string; type: string; title: string };
  contextCount: number;
  gameContext: RuntimeContextStatus;
  viewport?: { clientWidth?: number; clientHeight?: number; scale?: number; zoom?: number };
  screenshot?: { byteLength: number; sha256: string };
}

interface DevToolsTarget {
  id: string;
  type: string;
  title: string;
  webSocketDebuggerUrl?: string;
}

interface WebSocketLike {
  onopen: (() => void) | null;
  onerror: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  send(data: string): void;
  close(): void;
}

interface WebSocketConstructor {
  new (url: string): WebSocketLike;
}

interface RuntimeContext {
  id: number;
}

interface CdpMessage {
  id?: number;
  method?: string;
  params?: Record<string, unknown> & { context?: RuntimeContext };
  result?: Record<string, unknown>;
  error?: { message?: string };
}

export type RuntimeActionInput =
  | { action: "reload" | "screenshot" }
  | { action: "tap"; x: number; y: number }
  | { action: "collectConsole"; durationMs: number };

export interface RuntimeActionOutput {
  action: RuntimeActionInput["action"];
  screenshot?: { byteLength: number; sha256: string };
  console?: Array<{ level: string; text: string; timestamp?: number }>;
}

interface CdpSession {
  call(method: string, params?: Record<string, unknown>): Promise<CdpMessage>;
  contexts: RuntimeContext[];
  addEventListener(listener: (message: CdpMessage) => void): () => void;
}

export async function probeDouyinRuntime(
  configuredPort?: number,
  captureScreenshot = false,
): Promise<RuntimeProbeResult> {
  const { port, target, value } = await withRuntimeSession(configuredPort, async (session) => {
    await session.call("Runtime.enable");
    await session.call("Page.enable");
    await delay(100);
    const probes: RuntimeContextStatus[] = [];
    for (const context of session.contexts) {
      const response = await session.call("Runtime.evaluate", {
        contextId: context.id,
        returnByValue: true,
        expression: `(() => ({
          title: document.title,
          readyState: document.readyState,
          canvases: [...document.querySelectorAll('canvas')].map((c) => ({width:c.width,height:c.height,clientWidth:c.clientWidth,clientHeight:c.clientHeight})),
          iframeCount: document.querySelectorAll('iframe').length,
          hasTt: typeof globalThis.tt === 'object',
          hasGameGlobal: typeof globalThis.GameGlobal === 'object'
        }))()`,
      });
      const remoteObject = response.result?.result as { value?: RuntimeContextStatus } | undefined;
      if (remoteObject?.value !== undefined) probes.push(remoteObject.value);
    }
    const gameContext = probes.find((probe) => probe.canvases.length > 0 && probe.hasGameGlobal && probe.hasTt);
    if (gameContext === undefined) throw new Error("No game Runtime context with tt, GameGlobal, and Canvas was found.");
    const layout = await session.call("Page.getLayoutMetrics");
    const viewport = layout.result?.cssVisualViewport as RuntimeProbeResult["viewport"];
    const screenshot = captureScreenshot ? await captureScreenshotSummary(session) : undefined;
    return { contextCount: session.contexts.length, gameContext, viewport, screenshot };
  });
  return {
    cdpPort: port,
    target,
    contextCount: value.contextCount,
    gameContext: value.gameContext,
    ...(value.viewport === undefined ? {} : { viewport: value.viewport }),
    ...(value.screenshot === undefined ? {} : { screenshot: value.screenshot }),
  };
}

export async function executeRuntimeAction(
  configuredPort: number | undefined,
  input: RuntimeActionInput,
): Promise<RuntimeActionOutput> {
  return (await withRuntimeSession(configuredPort, async (session) => {
    await session.call("Runtime.enable");
    await session.call("Page.enable");
    if (input.action === "reload") {
      await session.call("Page.reload", { ignoreCache: false });
      return { action: input.action };
    }
    if (input.action === "screenshot") {
      return { action: input.action, screenshot: await captureScreenshotSummary(session) };
    }
    if (input.action === "tap") {
      const layout = await session.call("Page.getLayoutMetrics");
      const viewport = layout.result?.cssVisualViewport as { clientWidth?: number; clientHeight?: number } | undefined;
      if (viewport?.clientWidth === undefined || viewport.clientHeight === undefined ||
          input.x > viewport.clientWidth || input.y > viewport.clientHeight) {
        throw new Error("Tap coordinates are outside the current Runtime viewport.");
      }
      const touchPoint = { x: input.x, y: input.y, radiusX: 1, radiusY: 1, force: 1, id: 0 };
      await session.call("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [touchPoint] });
      await session.call("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      return { action: input.action };
    }
    const entries: NonNullable<RuntimeActionOutput["console"]> = [];
    const removeListener = session.addEventListener((message) => {
      if (entries.length >= 64) return;
      if (message.method === "Runtime.consoleAPICalled") {
        const params = message.params;
        const args = Array.isArray(params?.args) ? params.args : [];
        const text = args.map((arg) => formatConsoleArgument(arg)).join(" ").slice(0, 512);
        entries.push({
          level: typeof params?.type === "string" ? params.type.slice(0, 32) : "log",
          text,
          ...(typeof params?.timestamp === "number" ? { timestamp: params.timestamp } : {}),
        });
      } else if (message.method === "Runtime.exceptionThrown") {
        const details = message.params?.exceptionDetails as Record<string, unknown> | undefined;
        entries.push({ level: "exception", text: String(details?.text ?? "Runtime exception").slice(0, 512) });
      }
    });
    try {
      await delay(input.action === "collectConsole" ? input.durationMs : 0);
    } finally {
      removeListener();
    }
    return { action: input.action, console: entries };
  })).value;
}

async function withRuntimeSession<T>(
  configuredPort: number | undefined,
  operation: (session: CdpSession) => Promise<T>,
): Promise<{ port: number; target: { id: string; type: string; title: string }; value: T }> {
  const port = await resolveDouyinCdpPort(configuredPort);
  const targets = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(5_000) }).then(async (response) => {
    if (!response.ok) throw new Error(`DevTool CDP target list returned HTTP ${response.status}.`);
    return (await response.json()) as DevToolsTarget[];
  });
  const target = targets.find((candidate) => candidate.title === "MiniApp Webview");
  if (target?.webSocketDebuggerUrl === undefined) {
    throw new Error("The DevTool did not expose a MiniApp Webview CDP target.");
  }
  if (!isLoopbackWebSocket(target.webSocketDebuggerUrl, port)) {
    throw new Error("The DevTool returned a non-loopback CDP WebSocket URL.");
  }

  const webSocketConstructor = (globalThis as unknown as { WebSocket?: WebSocketConstructor }).WebSocket;
  if (webSocketConstructor === undefined) throw new Error("This runtime does not provide WebSocket support.");
  const socket = new webSocketConstructor(target.webSocketDebuggerUrl);
  const contexts: RuntimeContext[] = [];
  const listeners = new Set<(message: CdpMessage) => void>();
  let nextId = 1;
  const pending = new Map<number, { resolve: (value: CdpMessage) => void; reject: (error: Error) => void }>();
  socket.onmessage = (event) => {
    const message = JSON.parse(String(event.data)) as CdpMessage;
    if (message.method === "Runtime.executionContextCreated" && message.params?.context !== undefined) {
      contexts.push(message.params.context);
    }
    for (const listener of listeners) listener(message);
    if (message.id === undefined) return;
    const waiter = pending.get(message.id);
    if (waiter === undefined) return;
    pending.delete(message.id);
    if (message.error !== undefined) waiter.reject(new Error(message.error.message ?? "CDP request failed."));
    else waiter.resolve(message);
  };
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.close();
      reject(new Error("Timed out opening the DevTool MiniApp CDP socket."));
    }, 5_000);
    socket.onopen = () => {
      clearTimeout(timer);
      resolve();
    };
    socket.onerror = () => {
      clearTimeout(timer);
      socket.close();
      reject(new Error("Failed to open the DevTool MiniApp CDP socket."));
    };
  });
  const call = (method: string, params: Record<string, unknown> = {}): Promise<CdpMessage> => {
    const id = nextId++;
    const result = new Promise<CdpMessage>((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`Timed out waiting for CDP ${method}.`));
      }, 5_000);
      pending.set(id, {
        resolve: (message) => {
          clearTimeout(timer);
          resolve(message);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
    });
    socket.send(JSON.stringify({ id, method, params }));
    return result;
  };

  try {
    const value = await operation({
      call,
      contexts,
      addEventListener: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    });
    return { port, target: { id: target.id, type: target.type, title: target.title }, value };
  } finally {
    socket.close();
  }
}

async function captureScreenshotSummary(session: CdpSession): Promise<{ byteLength: number; sha256: string }> {
  const response = await session.call("Page.captureScreenshot", { format: "png", fromSurface: true });
  const data = (response.result?.data as string | undefined) ?? "";
  if (data.length === 0) throw new Error("The MiniApp target returned an empty screenshot.");
  const bytes = Buffer.from(data, "base64");
  return { byteLength: bytes.byteLength, sha256: createHash("sha256").update(bytes).digest("hex") };
}

function formatConsoleArgument(value: unknown): string {
  if (typeof value !== "object" || value === null) return String(value);
  const remote = value as Record<string, unknown>;
  if (typeof remote.value === "string") return remote.value;
  if (remote.value !== undefined) return JSON.stringify(remote.value).slice(0, 512);
  return String(remote.description ?? remote.type ?? "value").slice(0, 512);
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

export async function resolveDouyinCdpPort(configuredPort?: number): Promise<number> {
  if (isValidPort(configuredPort)) return configuredPort;
  const environmentPort = Number.parseInt(process.env.BYTEDANCE_IDE_PORT ?? "", 10);
  if (isValidPort(environmentPort)) return environmentPort;
  const appData = process.env.APPDATA;
  if (appData === undefined || appData.trim() === "") {
    throw new Error("APPDATA is unavailable; configure gameforgeDouyinBridge.cdpPort explicitly.");
  }
  const activePortPath = resolve(appData, "@byted", "vela", "DevToolsActivePort");
  const metadata = await lstat(activePortPath);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > 256) {
    throw new Error("The Douyin DevToolsActivePort file is invalid.");
  }
  const firstLine = (await readFile(activePortPath, "utf8")).split(/\r?\n/, 1)[0];
  const activePort = Number.parseInt(firstLine ?? "", 10);
  if (!isValidPort(activePort)) throw new Error("The Douyin DevToolsActivePort file contains an invalid port.");
  return activePort;
}

function isValidPort(value: number | undefined): value is number {
  return value !== undefined && Number.isInteger(value) && value >= 1_024 && value <= 65_535;
}

function isLoopbackWebSocket(value: string, expectedPort: number): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "ws:" && url.hostname === "127.0.0.1" && Number(url.port) === expectedPort;
  } catch {
    return false;
  }
}
