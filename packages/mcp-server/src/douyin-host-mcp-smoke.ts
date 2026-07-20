import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const serverEntry = path.resolve(root, "packages/mcp-server/dist/index.js");
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [serverEntry],
  cwd: root,
  env: { ...process.env, GAMEFORGE_DOUYIN_BRIDGE_MODE: "host" },
  stderr: "pipe",
});
const client = new Client({ name: "gameforge-douyin-host-smoke", version: "1.0.0" });

try {
  await client.connect(transport);
  const status = await callJson("get_douyin_devtool_runtime_status", {});
  const action = await callJson("run_douyin_runtime_action", {
    action: "collectConsole",
    actionId: `host-smoke-${Date.now()}`,
    durationMs: 500,
  });
  if (!isSuccessfulAction(action)) throw new Error(`Douyin Runtime action failed: ${JSON.stringify(action)}`);
  process.stdout.write(`${JSON.stringify({ ok: true, status, action }, null, 2)}\n`);
} finally {
  await client.close();
}

function isSuccessfulAction(value: unknown): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const result = (value as Record<string, unknown>).result;
  return typeof result === "object" && result !== null && !Array.isArray(result) &&
    (result as Record<string, unknown>).ok === true;
}

async function callJson(name: string, arguments_: Record<string, unknown>): Promise<unknown> {
  const result = await client.callTool({ name, arguments: arguments_ });
  if (result.isError === true || !Array.isArray(result.content) || result.content[0]?.type !== "text") {
    throw new Error(`MCP tool ${name} failed: ${JSON.stringify(result.content)}`);
  }
  return JSON.parse(result.content[0].text) as unknown;
}
