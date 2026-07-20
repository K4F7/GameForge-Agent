import * as vscode from "vscode";
import { lstatSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { BridgeClient } from "./bridge-client.js";
import { DEFAULT_BRIDGE_PORT, parseBridgeRendezvous, readBridgeToken } from "./protocol.js";
import { executeRuntimeAction, probeDouyinRuntime } from "./runtime-probe.js";

let client: BridgeClient | undefined;
let statusBar: vscode.StatusBarItem | undefined;

export function activate(context: vscode.ExtensionContext): void {
  statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 20);
  statusBar.command = "gameforgeDouyin.connect";
  statusBar.show();

  const connect = (): void => {
    client?.disconnect();
    const launch = readLaunchConfiguration();
    if (launch === undefined) {
      updateStatus("token missing", "warning");
      void vscode.window.showWarningMessage(
        "GameForge Douyin Bridge requires a short-lived local rendezvous or GAMEFORGE_DOUYIN_BRIDGE_TOKEN.",
      );
      return;
    }
    const configuration = vscode.workspace.getConfiguration("gameforgeDouyinBridge");
    const environmentPort = Number.parseInt(process.env.GAMEFORGE_DOUYIN_BRIDGE_PORT ?? "", 10);
    const port = launch.port ?? (
      Number.isInteger(environmentPort) && environmentPort >= 1_024 && environmentPort <= 65_535
        ? environmentPort
        : configuration.get<number>("port", DEFAULT_BRIDGE_PORT)
    );
    const configuredCdpPort = configuration.get<number>("cdpPort", 0);
    const cdpPort = configuredCdpPort >= 1_024 && configuredCdpPort <= 65_535 ? configuredCdpPort : undefined;
    client = new BridgeClient({
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
      getRuntimeStatus: async (requestId) => {
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
            remoteOperations: "forbidden",
          };
        } catch (error) {
          return {
            requestId,
            available: false,
            error: (error instanceof Error ? error.message : String(error)).slice(0, 256),
            remoteOperations: "forbidden",
          };
        }
      },
      runRuntimeAction: async (request) => {
        try {
          const result = await executeRuntimeAction(cdpPort, request);
          return {
            requestId: request.requestId,
            action: request.action,
            ok: true,
            ...(result.screenshot === undefined ? {} : { screenshot: result.screenshot }),
            ...(result.console === undefined ? {} : { console: result.console }),
            remoteOperations: "forbidden",
          };
        } catch (error) {
          return {
            requestId: request.requestId,
            action: request.action,
            ok: false,
            error: (error instanceof Error ? error.message : String(error)).slice(0, 256),
            remoteOperations: "forbidden",
          };
        }
      },
      onStateChange: (state) => updateStatus(state, state === "connecting" ? "sync" : undefined),
    });
    client.connect();
  };

  context.subscriptions.push(
    statusBar,
    vscode.commands.registerCommand("gameforgeDouyin.connect", connect),
    vscode.commands.registerCommand("gameforgeDouyin.disconnect", () => {
      client?.disconnect();
      updateStatus("disconnected");
    }),
    vscode.commands.registerCommand("gameforgeDouyin.showStatus", () => {
      const state = client?.connectionState ?? "disconnected";
      void vscode.window.showInformationMessage(`GameForge Douyin Bridge: ${state}`);
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(() => client?.writeStatus()),
    vscode.window.onDidChangeActiveTextEditor(() => client?.writeStatus()),
  );

  const enabled = hasPendingRendezvous() ||
    process.env.GAMEFORGE_DOUYIN_BRIDGE_AUTOCONNECT === "1" ||
    vscode.workspace.getConfiguration("gameforgeDouyinBridge").get<boolean>("enabled", false);
  if (enabled) connect();
  else updateStatus("disabled");
}

function readLaunchConfiguration(): { token: string; port?: number } | undefined {
  const environmentToken = readBridgeToken(process.env);
  if (environmentToken !== undefined) return { token: environmentToken };
  const rendezvousPath = getRendezvousPath();
  try {
    const metadata = lstatSync(rendezvousPath);
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > 4_096) return undefined;
    const rendezvous = parseBridgeRendezvous(readFileSync(rendezvousPath, "utf8"));
    if (rendezvous === undefined) return undefined;
    rmSync(rendezvousPath);
    return { token: rendezvous.token, port: rendezvous.port };
  } catch {
    return undefined;
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
  client?.disconnect();
  client = undefined;
}

function updateStatus(label: string, icon?: "warning" | "sync"): void {
  if (statusBar === undefined) return;
  const prefix = icon === undefined ? "$(debug-disconnect)" : `$(${icon})`;
  statusBar.text = `${prefix} GameForge: ${label}`;
  statusBar.tooltip = "Local-only Douyin DevTool bridge; preview and upload are not exposed.";
}
