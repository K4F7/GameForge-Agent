import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type Protocol from "devtools-protocol";
import {
  chromeRemoteInterfaceConnector,
  type DouyinCdpConnector,
  type DouyinCdpSession,
} from "./cdp-client.js";

const MAX_CONSOLE_ENTRIES = 64;
const MAX_CONSOLE_TEXT_LENGTH = 512;
const MAX_CANVASES = 16;
const MAX_RUNTIME_DIMENSION = 65_536;

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

export type RuntimeActionInput =
  | { action: "reload" }
  | { action: "screenshot" }
  | { action: "tap"; x: number; y: number }
  | { action: "collectConsole"; durationMs: number };

export interface RuntimeActionOutput {
  action: RuntimeActionInput["action"];
  screenshot?: { byteLength: number; sha256: string };
  console?: Array<{ level: string; text: string; timestamp?: number }>;
}

export interface DouyinRuntimeProbe {
  probe(configuredPort?: number, captureScreenshot?: boolean): Promise<RuntimeProbeResult>;
  executeAction(configuredPort: number | undefined, input: RuntimeActionInput): Promise<RuntimeActionOutput>;
}

export function createDouyinRuntimeProbe(
  connector: DouyinCdpConnector = chromeRemoteInterfaceConnector,
): DouyinRuntimeProbe {
  return {
    probe: async (configuredPort, captureScreenshot = false) => {
      const { port, target, value } = await withRuntimeSession(configuredPort, connector, async (session) => {
        await session.enableRuntime();
        await session.enablePage();
        await session.waitForExecutionContexts();
        const contexts = session.contexts;
        const probes: Array<{ contextId: number; status: RuntimeContextStatus }> = [];
        let failedContexts = 0;
        for (const context of contexts) {
          try {
            const response = await session.evaluate({
              contextId: context.id,
              returnByValue: true,
              expression: `(() => ({
                title: document.title,
                readyState: document.readyState,
                canvases: [...document.querySelectorAll('canvas')].slice(0, ${MAX_CANVASES}).map((c) => ({width:c.width,height:c.height,clientWidth:c.clientWidth,clientHeight:c.clientHeight})),
                iframeCount: document.querySelectorAll('iframe').length,
                hasTt: typeof globalThis.tt === 'object',
                hasGameGlobal: typeof globalThis.GameGlobal === 'object'
              }))()`,
            });
            const status = parseRuntimeContextStatus(response.result.value);
            if (response.exceptionDetails === undefined && status !== undefined) {
              probes.push({ contextId: context.id, status });
            } else {
              failedContexts += 1;
            }
          } catch {
            failedContexts += 1;
          }
        }
        const gameContext = probes
          .filter(({ status }) => status.canvases.length > 0 && status.hasGameGlobal && status.hasTt)
          .sort((left, right) => left.contextId - right.contextId)[0]?.status;
        if (gameContext === undefined) {
          throw new Error(
            `No game Runtime context with tt, GameGlobal, and Canvas was found (${failedContexts}/${contexts.length} probes failed).`,
          );
        }
        const layout = await session.getLayoutMetrics();
        const viewport = parseViewport(layout.cssVisualViewport);
        const screenshot = captureScreenshot ? await captureScreenshotSummary(session) : undefined;
        return { contextCount: contexts.length, gameContext, viewport, screenshot };
      });
      return {
        cdpPort: port,
        target,
        contextCount: value.contextCount,
        gameContext: value.gameContext,
        ...(value.viewport === undefined ? {} : { viewport: value.viewport }),
        ...(value.screenshot === undefined ? {} : { screenshot: value.screenshot }),
      };
    },
    executeAction: async (configuredPort, input) => {
      validateRuntimeActionInput(input);
      return (await withRuntimeSession(configuredPort, connector, async (session) => {
        await session.enableRuntime();
        await session.enablePage();
        if (input.action === "reload") {
          await session.reload({ ignoreCache: false });
          return { action: input.action };
        }
        if (input.action === "screenshot") {
          return { action: input.action, screenshot: await captureScreenshotSummary(session) };
        }
        if (input.action === "tap") {
          const layout = await session.getLayoutMetrics();
          const viewport = parseViewport(layout.cssVisualViewport);
          if (
            viewport?.clientWidth === undefined || viewport.clientHeight === undefined ||
            input.x >= viewport.clientWidth || input.y >= viewport.clientHeight
          ) {
            throw new Error("Tap coordinates are outside the current Runtime viewport.");
          }
          const touchPoint: Protocol.Input.TouchPoint = {
            x: input.x,
            y: input.y,
            radiusX: 1,
            radiusY: 1,
            force: 1,
            id: 0,
          };
          await session.dispatchTouchEvent({ type: "touchStart", touchPoints: [touchPoint] });
          await session.dispatchTouchEvent({ type: "touchEnd", touchPoints: [] });
          return { action: input.action };
        }
        const entries: NonNullable<RuntimeActionOutput["console"]> = [];
        const appendEntry = (entry: NonNullable<RuntimeActionOutput["console"]>[number]): void => {
          if (entries.length < MAX_CONSOLE_ENTRIES) entries.push(entry);
        };
        const removeConsole = session.onConsole((event) => {
          const text = event.args.map((arg) => formatConsoleArgument(arg)).join(" ").slice(0, MAX_CONSOLE_TEXT_LENGTH);
          appendEntry({
            level: String(event.type).slice(0, 32),
            text,
            ...(Number.isFinite(event.timestamp) ? { timestamp: event.timestamp } : {}),
          });
        });
        const removeException = session.onException((event) => {
          const text = event.exceptionDetails.exception?.description ?? event.exceptionDetails.text ?? "Runtime exception";
          appendEntry({ level: "exception", text: String(text).slice(0, MAX_CONSOLE_TEXT_LENGTH) });
        });
        try {
          await delay(input.durationMs);
        } finally {
          removeConsole();
          removeException();
        }
        return { action: input.action, console: entries };
      })).value;
    },
  };
}

const defaultRuntimeProbe = createDouyinRuntimeProbe();

export async function probeDouyinRuntime(
  configuredPort?: number,
  captureScreenshot = false,
): Promise<RuntimeProbeResult> {
  return defaultRuntimeProbe.probe(configuredPort, captureScreenshot);
}

export async function executeRuntimeAction(
  configuredPort: number | undefined,
  input: RuntimeActionInput,
): Promise<RuntimeActionOutput> {
  return defaultRuntimeProbe.executeAction(configuredPort, input);
}

async function withRuntimeSession<T>(
  configuredPort: number | undefined,
  connector: DouyinCdpConnector,
  operation: (session: DouyinCdpSession) => Promise<T>,
): Promise<{ port: number; target: { id: string; type: string; title: string }; value: T }> {
  const port = await resolveDouyinCdpPort(configuredPort);
  const { target, session } = await connector.connect(port);
  try {
    return { port, target, value: await operation(session) };
  } finally {
    await session.close().catch(() => undefined);
  }
}

async function captureScreenshotSummary(session: DouyinCdpSession): Promise<{ byteLength: number; sha256: string }> {
  let pageCaptureError: unknown;
  try {
    const response = await session.captureScreenshot({ format: "png", fromSurface: true });
    return summarizePngBase64(response.data);
  } catch (error) {
    pageCaptureError = error;
  }
  await session.waitForExecutionContexts();
  for (const context of session.contexts) {
    try {
      const response = await session.evaluate({
        contextId: context.id,
        returnByValue: true,
        expression: `(() => {
          const canvas = document.querySelector('canvas');
          if (typeof HTMLCanvasElement !== 'function' || !(canvas instanceof HTMLCanvasElement) || typeof globalThis.tt !== 'object' || typeof globalThis.GameGlobal !== 'object') return null;
          try {
            const dataUrl = canvas.toDataURL('image/png');
            return dataUrl.length <= 16777216 ? dataUrl : null;
          } catch {
            return null;
          }
        })()`,
      });
      const value = response.exceptionDetails === undefined ? response.result.value : undefined;
      if (typeof value === "string" && value.startsWith("data:image/png;base64,")) {
        return summarizePngBase64(value.slice("data:image/png;base64,".length));
      }
    } catch {
      // A stale or non-game execution context is expected while the simulator reloads.
    }
  }
  const cause = pageCaptureError instanceof Error ? pageCaptureError.message : String(pageCaptureError);
  throw new Error(`The MiniApp target did not provide a screenshot. Page capture failed: ${cause}`);
}

function summarizePngBase64(data: string): { byteLength: number; sha256: string } {
  if (!isCanonicalBase64(data)) throw new Error("The MiniApp target returned an invalid screenshot payload.");
  const bytes = Buffer.from(data, "base64");
  const pngSignature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length < pngSignature.length || pngSignature.some((value, index) => bytes[index] !== value)) {
    throw new Error("The MiniApp target did not return a PNG screenshot.");
  }
  return { byteLength: bytes.byteLength, sha256: createHash("sha256").update(bytes).digest("hex") };
}

function parseRuntimeContextStatus(value: unknown): RuntimeContextStatus | undefined {
  if (!isRecord(value)) return undefined;
  if (
    typeof value.title !== "string" || value.title.length > 512 ||
    typeof value.readyState !== "string" || value.readyState.length > 64 ||
    !Array.isArray(value.canvases) || value.canvases.length > MAX_CANVASES ||
    !isBoundedInteger(value.iframeCount, 0, 1_024) ||
    typeof value.hasTt !== "boolean" || typeof value.hasGameGlobal !== "boolean"
  ) return undefined;
  const canvases: RuntimeCanvas[] = [];
  for (const canvas of value.canvases) {
    if (!isRecord(canvas)) return undefined;
    const { width, height, clientWidth, clientHeight } = canvas;
    if (
      !isBoundedNumber(width, 0, MAX_RUNTIME_DIMENSION) ||
      !isBoundedNumber(height, 0, MAX_RUNTIME_DIMENSION) ||
      !isBoundedNumber(clientWidth, 0, MAX_RUNTIME_DIMENSION) ||
      !isBoundedNumber(clientHeight, 0, MAX_RUNTIME_DIMENSION)
    ) return undefined;
    canvases.push({ width, height, clientWidth, clientHeight });
  }
  return {
    title: value.title,
    readyState: value.readyState,
    canvases,
    iframeCount: value.iframeCount,
    hasTt: value.hasTt,
    hasGameGlobal: value.hasGameGlobal,
  };
}

function parseViewport(
  viewport: Protocol.Page.VisualViewport | undefined,
): RuntimeProbeResult["viewport"] | undefined {
  if (viewport === undefined) return undefined;
  const clientWidth = isBoundedNumber(viewport.clientWidth, 1, MAX_RUNTIME_DIMENSION) ? viewport.clientWidth : undefined;
  const clientHeight = isBoundedNumber(viewport.clientHeight, 1, MAX_RUNTIME_DIMENSION) ? viewport.clientHeight : undefined;
  const scale = isBoundedNumber(viewport.scale, 0.01, 100) ? viewport.scale : undefined;
  const zoom = isBoundedNumber(viewport.zoom, 0.01, 100) ? viewport.zoom : undefined;
  if (clientWidth === undefined || clientHeight === undefined) return undefined;
  return {
    clientWidth,
    clientHeight,
    ...(scale === undefined ? {} : { scale }),
    ...(zoom === undefined ? {} : { zoom }),
  };
}

function validateRuntimeActionInput(input: RuntimeActionInput): void {
  if (input.action === "reload" || input.action === "screenshot") return;
  if (input.action === "tap") {
    if (!isBoundedNumber(input.x, 0, 4_096) || !isBoundedNumber(input.y, 0, 4_096)) {
      throw new Error("Tap coordinates must be finite numbers between 0 and 4096.");
    }
    return;
  }
  if (!isBoundedInteger(input.durationMs, 0, 5_000)) {
    throw new Error("Console collection duration must be an integer between 0 and 5000 milliseconds.");
  }
}

function formatConsoleArgument(value: Protocol.Runtime.RemoteObject): string {
  if (typeof value.value === "string") return value.value.slice(0, MAX_CONSOLE_TEXT_LENGTH);
  if (value.value !== undefined) return safeJsonStringify(value.value).slice(0, MAX_CONSOLE_TEXT_LENGTH);
  return String(value.description ?? value.type ?? "value").slice(0, MAX_CONSOLE_TEXT_LENGTH);
}

function safeJsonStringify(value: unknown): string {
  try {
    const encoded = JSON.stringify(value);
    return encoded === undefined ? String(value) : encoded;
  } catch {
    return "[unserializable]";
  }
}

function isCanonicalBase64(value: string): boolean {
  if (value.length === 0 || value.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) return false;
  const normalized = value.replace(/=+$/, "");
  return Buffer.from(value, "base64").toString("base64").replace(/=+$/, "") === normalized;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isBoundedNumber(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= minimum && value <= maximum;
}

function isBoundedInteger(value: unknown, minimum: number, maximum: number): value is number {
  return isBoundedNumber(value, minimum, maximum) && Number.isInteger(value);
}
