import { describe, expect, it } from "vitest";
import {
  evaluateDoctorPreflight,
  expectedConditionalTools,
  redactEnvironmentValues,
  sanitizeDoctorDiagnostic,
} from "./doctor-core.js";

describe("GameForge doctor core", () => {
  it("accepts the pinned runtimes, one Bun lock, and a built server", () => {
    expect(evaluateDoctorPreflight({
      nodeVersion: "v24.18.0",
      bunVersion: "1.3.14",
      serverEntryExists: true,
      bunLockExists: true,
      packageLockExists: false,
    })).toEqual([]);
  });

  it("returns stable issue codes for an unreproducible checkout", () => {
    expect(evaluateDoctorPreflight({
      nodeVersion: "v20.0.0",
      bunVersion: null,
      serverEntryExists: false,
      bunLockExists: false,
      packageLockExists: true,
    }).map((issue) => issue.code)).toEqual([
      "node_version",
      "bun_version",
      "server_not_built",
      "bun_lock_missing",
      "parallel_lockfile",
    ]);
  });

  it("redacts configured credential values from startup errors", () => {
    const environment = {
      DASHSCOPE_API_KEY: "dashscope-secret-value",
      FREESOUND_API_KEY: "freesound-secret-value",
      GAMEFORGE_RUN_RELAY_TOKEN: "relay-secret-value",
      CODEARTS_CLI_AK: "codearts-access-value",
      CODEARTS_CLI_SK: "codearts-secret-value",
      GAMEFORGE_IMAGE_LICENSE: "private-license-value",
    };
    const message = redactEnvironmentValues(
      "failed dashscope-secret-value / freesound-secret-value / relay-secret-value / codearts-access-value / codearts-secret-value / private-license-value",
      environment,
    );
    expect(message).toBe("failed [REDACTED] / [REDACTED] / [REDACTED] / [REDACTED] / [REDACTED] / [REDACTED]");
  });

  it("removes known local roots and collapses multiline startup diagnostics", () => {
    expect(sanitizeDoctorDiagnostic(
      "Error at D:\\private\\repo\\packages\\mcp-server\nsecret relay-value",
      { GAMEFORGE_RUN_RELAY_TOKEN: "relay-value", USERPROFILE: "D:\\private" },
      ["D:\\private\\repo"],
    )).toBe("Error at [LOCAL_PATH]\\packages\\mcp-server secret [REDACTED]");
  });

  it("maps ready capabilities to the exact conditional MCP surface", () => {
    expect(expectedConditionalTools({
      providers: {
        spec: { ready: false },
        image: { ready: true },
        tts: { ready: false },
        sound: { ready: true },
        music: { ready: true },
      },
      engineering: { assetStore: true, generator: true, verifier: true, preview: true, runRelay: true, taskInbox: true },
    })).toEqual([
      "claim_game_task",
      "complete_game_run",
      "create_game_run",
      "create_game_task",
      "generate_game_project",
      "generate_music_asset",
      "get_game_task",
      "get_project_assets",
      "import_sound_asset",
      "list_game_tasks",
      "publish_run_events",
      "recover_game_project_update",
      "recover_project_assets",
      "replay_game_run",
      "request_image_asset",
      "search_sound_asset",
      "start_game_preview",
      "stop_game_preview",
      "stop_game_run",
      "transition_game_task",
      "verify_game_project",
    ]);
  });
});
