import { describe, expect, it, vi } from "vitest";
import { GameForgePlugin } from "./index.js";

function pluginInput(fetch: typeof globalThis.fetch) {
  const showToast = vi.fn(async () => ({ data: true }));
  return {
    input: {
      client: {
        mcp: { status: vi.fn(async () => ({ data: { gameforge: { status: "connected" } } })) },
        tui: { showToast },
      },
      project: {} as never,
      directory: "D:/repo",
      worktree: "D:/repo",
      experimental_workspace: { register() {} },
      serverUrl: new URL("http://127.0.0.1:4096/"),
      $: {} as never,
    },
    showToast,
    fetch,
  };
}

describe("GameForge OpenCode plugin", () => {
  it("exposes a read-only status tool and session startup hint", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ tasks: [] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));
    try {
      const fixture = pluginInput(globalThis.fetch);
      const hooks = await GameForgePlugin(fixture.input as never);
      await hooks.event?.({ event: { type: "session.created", properties: { info: {} as never } } });
      expect(fixture.showToast).toHaveBeenCalledWith(expect.objectContaining({
        body: expect.objectContaining({ title: "GameForge", variant: "info" }),
      }));
      const result = await hooks.tool?.gameforge_status?.execute({}, {} as never);
      expect(result).toMatchObject({ title: "GameForge status" });
      expect(JSON.parse((result as { output: string }).output)).toMatchObject({
        mcp: { gameforge: "connected" }, relay: { reachable: true },
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("notifies when a completed Relay task appears at session idle", async () => {
    const originalFetch = globalThis.fetch;
    let request = 0;
    globalThis.fetch = vi.fn(async () => {
      request += 1;
      const tasks = request <= 2 ? [] : [{
        taskId: "task-00000000-0000-0000-0000-000000000000",
        runId: "run-1",
        prompt: "Create a complete deterministic browser game.",
        language: "en-US",
        status: "completed",
        createdAt: "2026-07-18T02:00:00+08:00",
        claimedAt: "2026-07-18T02:00:10+08:00",
        claimedBy: "codearts",
        completedAt: "2026-07-18T02:01:00+08:00",
      }];
      return new Response(JSON.stringify({ tasks }), { status: 200, headers: { "Content-Type": "application/json" } });
    });
    try {
      const fixture = pluginInput(globalThis.fetch);
      const hooks = await GameForgePlugin(fixture.input as never);
      await hooks.event?.({ event: { type: "session.created", properties: { info: {} as never } } });
      await hooks.event?.({ event: { type: "session.idle", properties: { sessionID: "session-1" } } });
      expect(fixture.showToast).toHaveBeenLastCalledWith(expect.objectContaining({
        body: expect.objectContaining({ title: "GameForge Run completed", variant: "success" }),
      }));
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("reports unavailable MCP status without breaking the plugin tool", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ tasks: [] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));
    try {
      const fixture = pluginInput(globalThis.fetch);
      fixture.input.client.mcp.status = vi.fn(async () => { throw new Error("offline"); });
      const hooks = await GameForgePlugin(fixture.input as never);
      const result = await hooks.tool?.gameforge_status?.execute({}, {} as never) as { output: string };
      expect(JSON.parse(result.output)).toMatchObject({ mcp: { gameforge: "unavailable" } });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
