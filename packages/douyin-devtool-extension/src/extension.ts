import * as vscode from "vscode";
import { lstatSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { BridgeClient } from "./bridge-client.js";
import { BridgeConnectionManager } from "./bridge-connection-manager.js";
import { DEFAULT_BRIDGE_PORT, parseBridgeRendezvous, readBridgeToken, type RuntimeActionRequest } from "./protocol.js";
import { executeRuntimeAction, probeDouyinRuntime } from "./runtime-probe.js";

let manager: BridgeConnectionManager | undefined;
let statusBar: vscode.StatusBarItem | undefined;
let lastLaunch: { token: string; port?: number } | undefined;

export function activate(context: vscode.ExtensionContext): void {
  statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 20);
  statusBar.command = "gameforgeDouyin.connect";
  statusBar.show();

  manager = new BridgeConnectionManager({
    loadOptions: () => {
      const launch = readLaunchConfiguration() ?? lastLaunch;
      if (launch === undefined) return undefined;
      lastLaunch = launch;
      const configuration = vscode.workspace.getConfiguration("gameforgeDouyinBridge");
      const environmentPort = Number.parseInt(process.env.GAMEFORGE_DOUYIN_BRIDGE_PORT ?? "", 10);
      const port = launch.port ?? (
        Number.isInteger(environmentPort) && environmentPort >= 1_024 && environmentPort <= 65_535
          ? environmentPort
          : configuration.get<number>("port", DEFAULT_BRIDGE_PORT)
      );
      const configuredCdpPort = configuration.get<number>("cdpPort", 0);
      const cdpPort = configuredCdpPort >= 1_024 && configuredCdpPort <= 65_535 ? configuredCdpPort : undefined;
      return {
        port,
        token: launch.token,
        extensionVersion: String(context.extension.packageJSON.version ?? "unknown"),
        getStatus: (requestId) => {
          const activeUri = vscode.window.activeTextEditor?.document.uri;
          const activeFile = activeUri === undefined ? undefined : vscode.workspace.asRelativePath(activeUri, false);
          return {
            ...(requestId === undefined ? {} : { requestId }),
            workspaceFolders: vscode.workspace.workspaceFolders?.map((folder) => folder.uri.fsPath) ?? [],
            ...(activeFile === undefined ? {} : { activeFile }),
            capabilities: ["workspace-status", "runtime-status", "runtime-actions"],
            remoteOperations: "forbidden",
          };
        },
        getRuntimeStatus: async (requestId) => runtimeStatus(cdpPort, requestId),
        runRuntimeAction: async (request) => runtimeAction(cdpPort, request),
      };
    },
    createClient: (options) => new BridgeClient(options),
    onStateChange: (state) => updateStatus(
      state === "waiting" ? "waiting for controller" : state,
      state === "connecting" || state === "waiting" ? "sync" : undefined,
    ),
  });

  const connect = (): void => manager?.connect();

  context.subscriptions.push(
    statusBar,
    vscode.commands.registerCommand("gameforgeDouyin.connect", connect),
    vscode.commands.registerCommand("gameforgeDouyin.disconnect", () => {
      manager?.disconnect();
    }),
    vscode.commands.registerCommand("gameforgeDouyin.showStatus", () => {
      const state = manager?.connectionState ?? "disconnected";
      void vscode.window.showInformationMessage(`GameForge Douyin Bridge: ${state}`);
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(() => manager?.writeStatus()),
    vscode.window.onDidChangeActiveTextEditor(() => manager?.writeStatus()),
  );

  const enabled = hasPendingRendezvous() ||
    process.env.GAMEFORGE_DOUYIN_BRIDGE_AUTOCONNECT === "1" ||
    vscode.workspace.getConfiguration("gameforgeDouyinBridge").get<boolean>("enabled", false);
  if (enabled) connect();
  else updateStatus("disabled");
}

function readLaunchConfiguration(): { token: string; port?: number } | undefined {
  const rendezvousPath = getRendezvousPath();
  try {
    const metadata = lstatSync(rendezvousPath);
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > 4_096) return undefined;
    const rendezvous = parseBridgeRendezvous(readFileSync(rendezvousPath, "utf8"));
    if (rendezvous === undefined) return undefined;
    rmSync(rendezvousPath);
    return { token: rendezvous.token, port: rendezvous.port };
  } catch {
    const environmentToken = readBridgeToken(process.env);
    return environmentToken === undefined ? undefined : { token: environmentToken };
  }
}

async function runtimeStatus(cdpPort: number | undefined, requestId: string) {
  try {
    const runtime = await probeDouyinRuntime(cdpPort);
    return {
      requestId,
      available: true,
      target: runtime.target,
      contextCount: runtime.contextCount,
      gameContext: {
        readyState: runtime.gameContext.readyState,
        canvases: runtime.gameContext.canvases,
        hasTt: runtime.gameContext.hasTt,
        hasGameGlobal: runtime.gameContext.hasGameGlobal,
      },
      ...(runtime.viewport === undefined ? {} : { viewport: runtime.viewport }),
      remoteOperations: "forbidden" as const,
    };
  } catch (error) {
    return {
      requestId,
      available: false,
      error: (error instanceof Error ? error.message : String(error)).slice(0, 256),
      remoteOperations: "forbidden" as const,
    };
  }
}

async function runtimeAction(cdpPort: number | undefined, request: RuntimeActionRequest) {
  try {
    const result = await executeRuntimeAction(cdpPort, request);
    return {
      requestId: request.requestId,
      action: request.action,
      ok: true,
      ...(result.screenshot === undefined ? {} : { screenshot: result.screenshot }),
      ...(result.console === undefined ? {} : { console: result.console }),
      remoteOperations: "forbidden" as const,
    };
  } catch (error) {
    return {
      requestId: request.requestId,
      action: request.action,
      ok: false,
      error: (error instanceof Error ? error.message : String(error)).slice(0, 256),
      remoteOperations: "forbidden" as const,
    };
  }
}

function hasPendingRendezvous(): boolean {
  try {
    return lstatSync(getRendezvousPath()).isFile();
  } catch {
    return false;
  }
}

function getRendezvousPath(): string {
  return resolve(tmpdir(), "gameforge-douyin-bridge.json");
}

export function deactivate(): void {
  manager?.disconnect();
  manager = undefined;
  lastLaunch = undefined;
}

function updateStatus(label: string, icon?: "warning" | "sync"): void {
  if (statusBar === undefined) return;
  const prefix = icon === undefined ? "$(debug-disconnect)" : `$(${icon})`;
  statusBar.text = `${prefix} GameForge: ${label}`;
  statusBar.tooltip = "Local-only Douyin DevTool bridge; preview and upload are not exposed.";
}
