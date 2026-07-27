import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { createServer } from "./server.js";
import { getDouyinMiniGameCliStatusTool } from "./tools.js";

const report = {
  platform: "douyin-mini-game",
  ready: true,
  packageName: "tt-minigame-ide-cli",
  binary: "tmg",
  version: "2.1.1",
  executedArguments: ["--version"],
  remoteOperations: "forbidden",
  exposedArguments: ["--version"],
} as const;

describe("Douyin mini-game CLI MCP surface", () => {
  it("returns only the version-only, no-remote status report", async () => {
    await expect(getDouyinMiniGameCliStatusTool({ async probe() { return report; } })).resolves.toEqual({
      content: [{ type: "text", text: JSON.stringify(report, null, 2) }],
    });
  });

  it("maps probe failures to a stable error without leaking the cause", async () => {
    const result = await getDouyinMiniGameCliStatusTool({
      async probe() { throw new Error("D:\\private\\tmg.cmd token=secret"); },
    });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result)).toContain("douyin_cli_probe_failed");
    expect(JSON.stringify(result)).not.toMatch(/private|secret|tmg\.cmd/i);
  });

  it("does not expose the retired CLI probe when explicitly configured", async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = createServer({ douyinMiniGameCliProbe: { async probe() { return report; } } });
    const client = new Client({ name: "gameforge-douyin-cli-test", version: "1.0.0" });
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    try {
      const tools = (await client.listTools()).tools;
      expect(tools.map(({ name }) => name)).not.toContain("get_douyin_mini_game_cli_status");
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("keeps the tool absent and capability false when the probe is not configured", async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = createServer();
    const client = new Client({ name: "gameforge-douyin-cli-unconfigured-test", version: "1.0.0" });
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    try {
      const tools = (await client.listTools()).tools;
      expect(tools.some(({ name }) => name === "get_douyin_mini_game_cli_status")).toBe(false);
      const capabilities = await client.callTool({ name: "get_gameforge_capabilities", arguments: {} });
      if (!Array.isArray(capabilities.content) || capabilities.content[0]?.type !== "text") {
        throw new Error("Expected text capability snapshot.");
      }
      expect(JSON.parse(capabilities.content[0].text)).toMatchObject({
        engineering: { douyinCliProbe: false },
      });
    } finally {
      await client.close();
      await server.close();
    }
  });
});
