import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { describe, expect, it } from "vitest";

const repositoryRoot = path.resolve(import.meta.dirname, "../../..");
const retiredRuntimePattern = /douyin|wechat|mini[-_]?game/i;

describe("production MCP startup", () => {
  it("ignores retired platform runtime configuration and starts the Web MCP surface", async () => {
    const environment = Object.fromEntries(
      ["PATH", "Path", "PATHEXT", "SystemRoot", "TEMP", "TMP"]
        .map((name) => [name, process.env[name]])
        .filter((entry): entry is [string, string] => entry[1] !== undefined),
    );
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [path.join(repositoryRoot, "packages", "mcp-server", "dist", "index.js")],
      cwd: repositoryRoot,
      env: {
        ...environment,
        GAMEFORGE_DOUYIN_BRIDGE_MODE: "retired",
        GAMEFORGE_DOUYIN_MINIGAME_CLI: "retired",
      },
      stderr: "pipe",
    });
    const client = new Client({ name: "gameforge-production-startup-test", version: "1.0.0" });
    let stderr = "";
    transport.stderr?.on("data", (chunk: Buffer | string) => {
      stderr += String(chunk);
    });

    try {
      await client.connect(transport).catch((error: unknown) => {
        throw new Error(`Production MCP startup failed: ${stderr.trim()}`, { cause: error });
      });
      const toolNames = (await client.listTools()).tools.map((tool) => tool.name);
      expect(toolNames).toContain("validate_game_spec");
      expect(toolNames.filter((name) => retiredRuntimePattern.test(name))).toEqual([]);
    } finally {
      await client.close().catch(() => undefined);
    }
  });
});
