import { describe, expect, it } from "vitest";
import { evaluateDoctorPreflight, expectedConditionalTools, redactEnvironmentValues } from "./doctor-core.js";

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
    };
    const message = redactEnvironmentValues(
      "failed dashscope-secret-value / freesound-secret-value",
      environment,
    );
    expect(message).toBe("failed [REDACTED] / [REDACTED]");
  });

  it("maps ready capabilities to the exact conditional MCP surface", () => {
    expect(expectedConditionalTools({
      providers: {
        spec: { ready: false },
        image: { ready: true },
        tts: { ready: false },
        sound: { ready: true },
      },
      engineering: { assetStore: true, generator: true, verifier: true, preview: true, runRelay: true, taskInbox: true },
    })).toEqual([
      "claim_game_task",
      "complete_game_run",
      "create_game_run",
      "generate_game_project",
      "get_game_task",
      "get_project_assets",
      "import_sound_asset",
      "list_game_tasks",
      "publish_run_events",
      "recover_project_assets",
      "replay_game_run",
      "request_image_asset",
      "search_sound_asset",
      "start_game_preview",
      "stop_game_preview",
      "stop_game_run",
      "verify_game_project",
    ]);
  });
});
