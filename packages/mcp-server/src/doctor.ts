import { execFile } from "node:child_process";
import { access } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { gameforgeCapabilitySnapshotSchema, type GameforgeCapabilitySnapshot } from "@gameforge/contracts";
import { evaluateDoctorPreflight, expectedConditionalTools, redactEnvironmentValues } from "./doctor-core.js";

const executeFile = promisify(execFile);
const root = process.cwd();
const serverEntry = path.join(root, "packages", "mcp-server", "dist", "index.js");
const exists = async (target: string): Promise<boolean> => access(target).then(() => true, () => false);
const bunVersion = await executeFile("bun", ["--version"], { timeout: 10_000 })
  .then(({ stdout }) => stdout.trim(), () => null);
const preflight = {
  nodeVersion: process.version,
  bunVersion,
  serverEntryExists: await exists(serverEntry),
  bunLockExists: await exists(path.join(root, "bun.lock")),
  packageLockExists: await exists(path.join(root, "package-lock.json")),
};
const issues: Array<{ code: string; message: string }> = [...evaluateDoctorPreflight(preflight)];
let tools: string[] = [];
let capabilities: GameforgeCapabilitySnapshot | null = null;

if (issues.length === 0) {
  const environment = Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined),
  );
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [serverEntry],
    cwd: root,
    env: environment,
    stderr: "pipe",
  });
  const client = new Client({ name: "gameforge-doctor", version: "1.0.0" });
  let serverStderr = "";
  transport.stderr?.on("data", (chunk: Buffer | string) => {
    if (serverStderr.length < 4_000) serverStderr += String(chunk).slice(0, 4_000 - serverStderr.length);
  });
  try {
    await client.connect(transport);
    tools = (await client.listTools()).tools.map((tool) => tool.name).sort();
    const required = [
      "get_gameforge_capabilities",
      "get_agent_model_route",
      "validate_asset_manifest",
      "validate_game_spec",
      "validate_provider_config",
    ];
    const missing = required.filter((tool) => !tools.includes(tool));
    if (missing.length > 0) {
      issues.push({ code: "required_tools_missing", message: `Missing required tools: ${missing.join(", ")}` });
    }
    const result = await client.callTool({ name: "get_gameforge_capabilities", arguments: {} });
    if (result.isError === true || !Array.isArray(result.content) || result.content[0]?.type !== "text") {
      throw new Error("Capability tool returned an invalid result.");
    }
    capabilities = gameforgeCapabilitySnapshotSchema.parse(JSON.parse(result.content[0].text) as unknown);
    const missingConditional = expectedConditionalTools(capabilities).filter((tool) => !tools.includes(tool));
    if (missingConditional.length > 0) {
      issues.push({
        code: "capability_tool_mismatch",
        message: `Ready capabilities are missing tools: ${missingConditional.join(", ")}`,
      });
    }
    if (capabilities.engineering.taskInbox) {
      const relayProbe = await client.callTool({ name: "list_game_tasks", arguments: { limit: 1 } });
      if (relayProbe.isError === true) throw new Error("Configured Run Relay failed the bounded task-list probe.");
    }
  } catch (error) {
    const cause = error instanceof Error ? error.message : String(error);
    const detail = serverStderr.trim().length === 0 ? cause : `${cause} ${serverStderr.trim()}`;
    issues.push({
      code: "mcp_startup",
      message: redactEnvironmentValues(detail.replace(/[\r\n]+/g, " "), process.env).slice(0, 4_000),
    });
  } finally {
    await client.close().catch(() => undefined);
  }
}

console.log(JSON.stringify({
  ok: issues.length === 0,
  runtime: { node: preflight.nodeVersion, bun: preflight.bunVersion },
  repository: {
    bunLock: preflight.bunLockExists,
    npmLockAbsent: !preflight.packageLockExists,
    mcpBuilt: preflight.serverEntryExists,
  },
  mcp: { tools, capabilities },
  issues,
}, null, 2));
if (issues.length > 0) process.exitCode = 1;
