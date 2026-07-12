#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { gameSpecSchema } from "@gameforge/contracts";
import { z } from "zod";

const server = new McpServer({
  name: "gameforge",
  version: "0.1.0",
});

server.registerTool(
  "validate_game_spec",
  {
    title: "Validate game specification",
    description: "Validate a structured game requirement before implementation starts.",
    inputSchema: {
      spec: z.unknown().describe("A candidate GameForge game specification"),
    },
  },
  async ({ spec }) => {
    const result = gameSpecSchema.safeParse(spec);

    if (!result.success) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: JSON.stringify({ valid: false, issues: result.error.issues }, null, 2),
          },
        ],
      };
    }

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ valid: true, spec: result.data }, null, 2),
        },
      ],
    };
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
