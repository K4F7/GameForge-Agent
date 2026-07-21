import path from "node:path";
import { randomUUID } from "node:crypto";
import { access, readFile, symlink, unlink } from "node:fs/promises";
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
    const previousLayaCli = process.env.GAMEFORGE_LAYAIR_CLI;
    const previousDouyinCli = process.env.GAMEFORGE_DOUYIN_MINIGAME_CLI;
    const previousMinimaxApiKey = process.env.MINIMAX_API_KEY;
    const previousMinimaxMusicModel = process.env.GAMEFORGE_MUSIC_MODEL;
    const previousMinimaxMusicLicense = process.env.GAMEFORGE_MUSIC_LICENSE;
    const previousNonInteractiveApproval = process.env.GAMEFORGE_CODEARTS_NONINTERACTIVE_ALLOW;
    const previousProviderIsolation = process.env.GAMEFORGE_CODEARTS_PROVIDER_ISOLATION;
    let layaCliLink: string | undefined;
    try {
      delete process.env.GAMEFORGE_RUN_RELAY_TOKEN;
      delete process.env.GAMEFORGE_LAYAIR_CLI;
      delete process.env.GAMEFORGE_DOUYIN_MINIGAME_CLI;
      delete process.env.MINIMAX_API_KEY;
      delete process.env.GAMEFORGE_MUSIC_MODEL;
      delete process.env.GAMEFORGE_MUSIC_LICENSE;
      delete process.env.GAMEFORGE_CODEARTS_NONINTERACTIVE_ALLOW;
      delete process.env.GAMEFORGE_CODEARTS_PROVIDER_ISOLATION;
      await writeRuntimeConfig(runtime);
      const config = JSON.parse(await readFile(runtime.configPath, "utf8")) as {
        mcp: { gameforge: { environment: Record<string, string>; cwd?: unknown } };
        permission: Record<string, string>;
      };
      expect(path.isAbsolute(runtime.auditDirectory)).toBe(true);
      expect(runtime.auditDirectory).toContain(path.join("integrations", "codearts", "mcp-audit"));
      expect(config.mcp.gameforge.cwd).toBeUndefined();
      expect(config.mcp.gameforge.environment.GAMEFORGE_RUN_RELAY_TOKEN).toBeUndefined();
      expect(config.mcp.gameforge.environment.GAMEFORGE_LAYAIR_CLI).toBeUndefined();
      expect(config.mcp.gameforge.environment.GAMEFORGE_DOUYIN_MINIGAME_CLI).toBeUndefined();
      expect(config.mcp.gameforge.environment.MINIMAX_API_KEY).toBeUndefined();
      expect(config.mcp.gameforge.environment.GAMEFORGE_MCP_AUDIT_DIR).toBe(runtime.auditDirectory);
      expect(config.permission["gameforge_*"]).toBe("ask");
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

      process.env.MINIMAX_API_KEY = "test-key-not-real";
      process.env.GAMEFORGE_MUSIC_MODEL = "music-3.0-free";
      process.env.GAMEFORGE_MUSIC_LICENSE = "non-commercial";
      await writeRuntimeConfig(runtime);
      const musicConfig = JSON.parse(await readFile(runtime.configPath, "utf8")) as {
        mcp: { gameforge: { environment: Record<string, string> } };
      };
      expect(musicConfig.mcp.gameforge.environment.MINIMAX_API_KEY).toBe("{env:MINIMAX_API_KEY}");
      expect(musicConfig.mcp.gameforge.environment.GAMEFORGE_MUSIC_MODEL)
        .toBe("{env:GAMEFORGE_MUSIC_MODEL}");
      expect(musicConfig.mcp.gameforge.environment.GAMEFORGE_MUSIC_LICENSE)
        .toBe("{env:GAMEFORGE_MUSIC_LICENSE}");

      process.env.GAMEFORGE_CODEARTS_NONINTERACTIVE_ALLOW = "1";
      process.env.GAMEFORGE_CODEARTS_PROVIDER_ISOLATION = "1";
      await writeRuntimeConfig(runtime);
      const nonInteractiveConfig = JSON.parse(await readFile(runtime.configPath, "utf8")) as {
        mcp: { gameforge: { environment: Record<string, string>; timeout: number } };
        permission: Record<string, string>;
      };
      expect(nonInteractiveConfig.permission["gameforge_*"]).toBe("allow");
      expect(nonInteractiveConfig.mcp.gameforge.environment.DASHSCOPE_API_KEY).toBe("");
      expect(nonInteractiveConfig.mcp.gameforge.timeout).toBe(180_000);

      process.env.GAMEFORGE_LAYAIR_CLI = "   ";
      await expect(writeRuntimeConfig(runtime)).rejects.toThrow("must be unset or contain an absolute regular file path");
      process.env.GAMEFORGE_LAYAIR_CLI = "relative-layaair.cmd";
      await expect(writeRuntimeConfig(runtime)).rejects.toThrow("must be unset or contain an absolute regular file path");
      process.env.GAMEFORGE_LAYAIR_CLI = runtime.repoRoot;
      await expect(writeRuntimeConfig(runtime)).rejects.toThrow("must be unset or contain an absolute regular file path");
      const builtMcpEntry = path.join(runtime.repoRoot, "packages", "mcp-server", "dist", "index.js");
      if (process.platform !== "win32") {
        layaCliLink = path.join(path.dirname(runtime.configPath), `layaair-${randomUUID()}`);
        await symlink(builtMcpEntry, layaCliLink);
        process.env.GAMEFORGE_LAYAIR_CLI = layaCliLink;
        await expect(writeRuntimeConfig(runtime)).rejects.toThrow("must be unset or contain an absolute regular file path");
      }
      process.env.GAMEFORGE_LAYAIR_CLI = builtMcpEntry;
      await writeRuntimeConfig(runtime);
      const layaConfig = JSON.parse(await readFile(runtime.configPath, "utf8")) as {
        mcp: { gameforge: { environment: Record<string, string> } };
      };
      expect(layaConfig.mcp.gameforge.environment.GAMEFORGE_LAYAIR_CLI).toBe(builtMcpEntry);

      process.env.GAMEFORGE_DOUYIN_MINIGAME_CLI = "tmg";
      await expect(writeRuntimeConfig(runtime)).rejects.toThrow(
        "GAMEFORGE_DOUYIN_MINIGAME_CLI must be unset or contain an absolute regular file path",
      );
      process.env.GAMEFORGE_DOUYIN_MINIGAME_CLI = builtMcpEntry;
      await writeRuntimeConfig(runtime);
      const douyinConfig = JSON.parse(await readFile(runtime.configPath, "utf8")) as {
        mcp: { gameforge: { environment: Record<string, string> } };
      };
      expect(douyinConfig.mcp.gameforge.environment.GAMEFORGE_DOUYIN_MINIGAME_CLI).toBe(builtMcpEntry);
    } finally {
      if (previousToken === undefined) delete process.env.GAMEFORGE_RUN_RELAY_TOKEN;
      else process.env.GAMEFORGE_RUN_RELAY_TOKEN = previousToken;
      if (previousLayaCli === undefined) delete process.env.GAMEFORGE_LAYAIR_CLI;
      else process.env.GAMEFORGE_LAYAIR_CLI = previousLayaCli;
      if (previousDouyinCli === undefined) delete process.env.GAMEFORGE_DOUYIN_MINIGAME_CLI;
      else process.env.GAMEFORGE_DOUYIN_MINIGAME_CLI = previousDouyinCli;
      if (previousMinimaxApiKey === undefined) delete process.env.MINIMAX_API_KEY;
      else process.env.MINIMAX_API_KEY = previousMinimaxApiKey;
      if (previousMinimaxMusicModel === undefined) delete process.env.GAMEFORGE_MUSIC_MODEL;
      else process.env.GAMEFORGE_MUSIC_MODEL = previousMinimaxMusicModel;
      if (previousMinimaxMusicLicense === undefined) delete process.env.GAMEFORGE_MUSIC_LICENSE;
      else process.env.GAMEFORGE_MUSIC_LICENSE = previousMinimaxMusicLicense;
      if (previousNonInteractiveApproval === undefined) delete process.env.GAMEFORGE_CODEARTS_NONINTERACTIVE_ALLOW;
      else process.env.GAMEFORGE_CODEARTS_NONINTERACTIVE_ALLOW = previousNonInteractiveApproval;
      if (previousProviderIsolation === undefined) delete process.env.GAMEFORGE_CODEARTS_PROVIDER_ISOLATION;
      else process.env.GAMEFORGE_CODEARTS_PROVIDER_ISOLATION = previousProviderIsolation;
      if (layaCliLink !== undefined) await unlink(layaCliLink).catch(() => undefined);
    }
  });
});
