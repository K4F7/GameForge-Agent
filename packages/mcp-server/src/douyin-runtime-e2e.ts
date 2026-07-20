import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createRunRelayServer } from "@gameforge/run-relay";
import { RunRelayClient } from "@gameforge/run-relay/client";
import { mkdir, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "./server.js";
import { DouyinBridgeController } from "./douyin-bridge-controller.js";

const runId = `run-douyin-runtime-e2e-${new Date().toISOString().replace(/[-:.TZ]/g, "")}`;
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const outputPath = path.resolve(
  repositoryRoot,
  process.env.GAMEFORGE_DOUYIN_E2E_OUTPUT?.trim() ||
    `experiments/${new Date().toISOString().slice(0, 10)}-douyin-runtime-mcp-e2e/evidence.json`,
);
const relayServer = createRunRelayServer({ heartbeatMilliseconds: 1_000 });
const controller = new DouyinBridgeController();
const pair = InMemoryTransport.createLinkedPair();
const client = new Client({ name: "gameforge-douyin-runtime-e2e", version: "1.0.0" });

try {
  await new Promise<void>((resolve, reject) => {
    relayServer.once("error", reject);
    relayServer.listen(0, "127.0.0.1", resolve);
  });
  const address = relayServer.address() as AddressInfo;
  const relay = new RunRelayClient({ baseUrl: `http://127.0.0.1:${address.port}` });
  await controller.start();
  const server = createServer({ douyinBridgeController: controller, runRelayClient: relay });
  await server.connect(pair[1]);
  await client.connect(pair[0]);

  process.stderr.write("Douyin bridge is listening. Click 'GameForge: disconnected' in DevTool within 60 seconds.\n");
  await waitForConnection(controller, 60_000);

  await callJson(client, "create_game_run", { runId });
  const runtimeStatus = await callJson(client, "get_douyin_devtool_runtime_status", {});
  const tapResult = await callJson(client, "run_douyin_runtime_action", {
    action: "tap",
    actionId: `${runId}-tap`,
    x: 206,
    y: 150,
    runId,
    after: 1,
  });
  const runtimeStatusAfterAction = await callJson(client, "get_douyin_devtool_runtime_status", {});
  await callJson(client, "complete_game_run", { runId });
  const replay = await callJson(client, "replay_game_run", { runId, after: 0, limit: 100 });
  const evidence = {
    capturedAt: new Date().toISOString(),
    runId,
    constraints: { remoteOperations: "forbidden", preview: false, upload: false, submit: false, publish: false },
    runtimeStatus,
    actions: { tap: tapResult },
    runtimeStatusAfterAction,
    replay,
  };
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify({ ok: true, runId, outputPath, evidence }, null, 2)}\n`);
} finally {
  await client.close().catch(() => undefined);
  await controller.stop().catch(() => undefined);
  relayServer.closeAllConnections();
  await new Promise<void>((resolve) => relayServer.close(() => resolve())).catch(() => undefined);
}

async function waitForConnection(controller: DouyinBridgeController, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (controller.getStatus().connected) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Timed out waiting for the Douyin DevTool extension to connect.");
}

async function callJson(client: Client, name: string, arguments_: Record<string, unknown>): Promise<unknown> {
  const result = await client.callTool({ name, arguments: arguments_ });
  if (result.isError === true) {
    throw new Error(`MCP tool ${name} failed: ${JSON.stringify(result.content)}`);
  }
  if (!Array.isArray(result.content) || result.content[0]?.type !== "text") {
    throw new Error(`MCP tool ${name} did not return text content.`);
  }
  return JSON.parse(result.content[0].text) as unknown;
}
