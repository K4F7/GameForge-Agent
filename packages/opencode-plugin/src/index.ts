import { tool, type Hooks, type Plugin } from "@opencode-ai/plugin";
import { RunRelayClient } from "@gameforge/run-relay/client";

type StatusSnapshot = {
  mcp: Record<string, string>;
  relay: { reachable: boolean; queued: number; claimed: number; completed: number; failed: number; stopped: number };
};

export const GameForgePlugin: Plugin = async (input) => {
  const relayUrl = process.env.GAMEFORGE_RUN_RELAY_URL?.trim() || "http://127.0.0.1:8787/";
  const relay = createRelay(relayUrl);
  const knownCompleted = new Set<string>();
  const notify = async (body: {
    title: string;
    message: string;
    variant: "info" | "success" | "warning" | "error";
    duration: number;
  }): Promise<void> => {
    try {
      await input.client.tui.showToast({ query: { directory: input.directory }, body });
    } catch {
      // Headless `opencode run` has no TUI surface; notifications are best-effort.
    }
  };

  const inspect = async (): Promise<StatusSnapshot> => {
    let mcp: Record<string, string>;
    try {
      const mcpResult = await input.client.mcp.status({ query: { directory: input.directory } });
      mcp = Object.fromEntries(Object.entries(mcpResult.data ?? {}).map(([name, status]) => [name, status.status]));
    } catch {
      mcp = { gameforge: "unavailable" };
    }
    try {
      const tasks = await relay.listTasks({ limit: 100 });
      return {
        mcp,
        relay: {
          reachable: true,
          queued: tasks.filter((task) => task.status === "queued").length,
          claimed: tasks.filter((task) => task.status === "claimed").length,
          completed: tasks.filter((task) => task.status === "completed").length,
          failed: tasks.filter((task) => task.status === "failed").length,
          stopped: tasks.filter((task) => task.status === "stopped").length,
        },
      };
    } catch {
      return { mcp, relay: { reachable: false, queued: 0, claimed: 0, completed: 0, failed: 0, stopped: 0 } };
    }
  };

  const hooks: Hooks = {
    tool: {
      gameforge_status: tool({
        description: "Report GameForge MCP connection and Run Relay task counts without changing state.",
        args: {},
        async execute() {
          return {
            title: "GameForge status",
            output: JSON.stringify(await inspect(), null, 2),
          };
        },
      }),
    },
    async event({ event }) {
      if (event.type === "session.created") {
        const status = await inspect();
        await notify({
            title: "GameForge",
            message: status.relay.reachable
              ? `Relay ready; ${status.relay.queued} queued task(s). Use /gameforge-status for details.`
              : "Relay unavailable. Start bun run dev:relay before submitting tasks.",
            variant: status.relay.reachable ? "info" : "warning",
            duration: 6_000,
        });
        const tasks = status.relay.reachable ? await relay.listTasks({ limit: 100 }) : [];
        for (const task of tasks) if (task.status === "completed") knownCompleted.add(task.taskId);
      }
      if (event.type === "session.idle") {
        let tasks;
        try {
          tasks = await relay.listTasks({ limit: 100 });
        } catch {
          return;
        }
        const newlyCompleted = tasks.filter((task) => task.status === "completed" && !knownCompleted.has(task.taskId));
        for (const task of newlyCompleted) knownCompleted.add(task.taskId);
        if (newlyCompleted.length > 0) {
          await notify({
              title: "GameForge Run completed",
              message: newlyCompleted.map((task) => task.runId).join(", "),
              variant: "success",
              duration: 8_000,
          });
        }
      }
    },
  };
  return hooks;
};

export default GameForgePlugin;

function createRelay(baseUrl: string): RunRelayClient {
  const token = process.env.GAMEFORGE_RUN_RELAY_TOKEN;
  return new RunRelayClient({
    baseUrl,
    timeoutMilliseconds: 2_000,
    ...(token === undefined ? {} : { authToken: token }),
  });
}
