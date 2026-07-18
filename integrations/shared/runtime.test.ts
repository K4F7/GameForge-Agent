import path from "node:path";
import { access, readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { findRepoRoot, redactArguments, resolveRuntime, safeRelayUrl, writeRuntimeConfig } from "./runtime.js";

describe("integration runtime", () => {
  it("finds the repository from a nested integration directory", async () => {
    const root = await findRepoRoot(import.meta.dirname);
    expect(path.basename(root)).toBe("GameForge-Agent");
  });

  it("accepts safe relay URLs and rejects credential-bearing remote HTTP", () => {
    expect(safeRelayUrl("http://127.0.0.1:8787")).toBe("http://127.0.0.1:8787/");
    expect(safeRelayUrl("https://relay.example.com/gameforge")).toBe("https://relay.example.com/gameforge/");
    expect(() => safeRelayUrl("http://user:secret@example.com/")).toThrow("Relay URL");
  });

  it("redacts secret-looking diagnostic arguments", () => {
    expect(redactArguments(["MODEL=qwen", "API_TOKEN=secret"])).toEqual(["MODEL=qwen", "<redacted>"]);
  });

  it("keeps the committed OpenCode example portable and permission-scoped", async () => {
    const root = await findRepoRoot(import.meta.dirname);
    const text = await readFile(path.join(root, "opencode.json.example"), "utf8");
    const config = JSON.parse(text) as {
      mcp: { gameforge: { command: string[]; environment: Record<string, string>; cwd?: unknown } };
      permission: Record<string, string>;
    };
    expect(config.mcp.gameforge.command).toEqual(["node", "packages/mcp-server/dist/index.js"]);
    expect(config.mcp.gameforge.cwd).toBeUndefined();
    expect(text).not.toMatch(/[A-Z]:\\/);
    expect(config.mcp.gameforge.environment.GAMEFORGE_RUN_RELAY_TOKEN)
      .toBe("{env:GAMEFORGE_RUN_RELAY_TOKEN}");
    expect(config.mcp.gameforge.environment.GAMEFORGE_MODEL_ROUTING_POLICY)
      .toBe("{env:GAMEFORGE_MODEL_ROUTING_POLICY}");
    expect(text.replaceAll("GAMEFORGE_RUN_RELAY_TOKEN", "RELAY_CREDENTIAL_REF"))
      .not.toMatch(/(?:api[_-]?key|token|secret)\s*[":=]\s*[^<{]/i);
    expect(config.permission).toMatchObject({
      "gameforge_*": "ask",
      "gameforge_validate_*": "allow",
      "gameforge_generate_*": "ask",
      "gameforge_complete_*": "ask",
    });
  });

  it("generates a per-client ignored MCP audit directory", async () => {
    const runtime = await resolveRuntime(import.meta.dirname, "codearts");
    const previousToken = process.env.GAMEFORGE_RUN_RELAY_TOKEN;
    try {
      delete process.env.GAMEFORGE_RUN_RELAY_TOKEN;
      await writeRuntimeConfig(runtime);
      const config = JSON.parse(await readFile(runtime.configPath, "utf8")) as {
        mcp: { gameforge: { environment: Record<string, string>; cwd?: unknown } };
      };
      expect(path.isAbsolute(runtime.auditDirectory)).toBe(true);
      expect(runtime.auditDirectory).toContain(path.join("integrations", "codearts", "mcp-audit"));
      expect(config.mcp.gameforge.cwd).toBeUndefined();
      expect(config.mcp.gameforge.environment.GAMEFORGE_RUN_RELAY_TOKEN).toBeUndefined();
      expect(config.mcp.gameforge.environment.GAMEFORGE_MCP_AUDIT_DIR).toBe(runtime.auditDirectory);
      const policyPath = config.mcp.gameforge.environment.GAMEFORGE_MODEL_ROUTING_POLICY;
      if (policyPath === undefined) throw new Error("Expected generated model routing policy path.");
      expect(path.isAbsolute(policyPath)).toBe(true);
      await expect(access(policyPath)).resolves.toBeUndefined();

      process.env.GAMEFORGE_RUN_RELAY_TOKEN = "   ";
      await expect(writeRuntimeConfig(runtime)).rejects.toThrow("must be unset or contain between 32 and 512");

      process.env.GAMEFORGE_RUN_RELAY_TOKEN = "r".repeat(32);
      await writeRuntimeConfig(runtime);
      const authenticatedConfig = JSON.parse(await readFile(runtime.configPath, "utf8")) as {
        mcp: { gameforge: { environment: Record<string, string> } };
      };
      expect(authenticatedConfig.mcp.gameforge.environment.GAMEFORGE_RUN_RELAY_TOKEN)
        .toBe("{env:GAMEFORGE_RUN_RELAY_TOKEN}");
    } finally {
      if (previousToken === undefined) delete process.env.GAMEFORGE_RUN_RELAY_TOKEN;
      else process.env.GAMEFORGE_RUN_RELAY_TOKEN = previousToken;
    }
  });
});
