#!/usr/bin/env bun

import { RunRelayClient } from "@gameforge/run-relay/client";
import type { WireRunEvent } from "@gameforge/contracts";
import { parseArgs } from "./args.js";
import { formatSummary, summarizeRun } from "./summary.js";
import { attachTerminalControls, renderWatchFrame } from "./terminal.js";
import { watchRun } from "./watch.js";

const help = `GameForge TUI

Usage:
  bun run tui -- submit --run-id ID --prompt TEXT [--project-id PROJECT_ID] [--language zh-CN|en-US]
  bun run tui -- list [--status STATUS] [--limit N]
  bun run tui -- task TASK_ID
  bun run tui -- run RUN_ID [--after N]
  bun run tui -- stop RUN_ID
  bun run tui -- watch RUN_ID [--after N]

Global options: --base-url URL --json`;

export async function runCli(argv: readonly string[]): Promise<void> {
  const options = parseArgs(argv);
  if (options.command === "help") {
    process.stdout.write(`${help}\n`);
    return;
  }
  const client = new RunRelayClient({ baseUrl: options.baseUrl });
  const output = (value: unknown, text: string): void => {
    process.stdout.write(options.json ? `${JSON.stringify(value)}\n` : `${text}\n`);
  };
  switch (options.command) {
    case "submit": {
      const created = await client.createTask({
        runId: options.runId!,
        prompt: options.prompt!,
        language: options.language,
        ...(options.projectId === undefined ? {} : { projectId: options.projectId }),
      });
      output(created, `Queued ${created.task.taskId}\nRun ${created.task.runId} (${created.task.language})`);
      return;
    }
    case "list": {
      const tasks = await client.listTasks({
        limit: options.limit,
        ...(options.status === undefined ? {} : { status: options.status }),
      });
      output(tasks, tasks.length === 0 ? "No tasks." : tasks.map((task) =>
        `${task.status.padEnd(9)} ${task.taskId}  ${task.runId}  ${task.language}`).join("\n"));
      return;
    }
    case "task": {
      const task = await client.getTask(options.taskId!);
      output(task, `${task.status} ${task.taskId}\nRun ${task.runId} (${task.language})\n${task.prompt}`);
      return;
    }
    case "run": {
      const batch = await client.replayEvents({ runId: options.runId!, after: options.after });
      const summary = summarizeRun(batch.events);
      output(batch, summary === null ? "No start event in this page." : formatSummary(summary));
      return;
    }
    case "stop": {
      const event = await client.stopRun(options.runId!);
      output(event, `Stopped ${event.runId} at sequence ${event.sequence}.`);
      return;
    }
    case "watch": {
      const history: WireRunEvent[] = [];
      let scrollOffset = 0;
      let watchStatus = "正在连接 Run Relay";
      const render = (event?: WireRunEvent): void => {
        if (options.json) {
          if (event !== undefined) process.stdout.write(`${JSON.stringify(event)}\n`);
          return;
        }
        const summary = summarizeRun(history);
        const body = summary === null ? "Waiting for run events..." : formatSummary(summary);
        const text = `${body}\n\n${watchStatus}`;
        process.stdout.write(renderWatchFrame(text, process.stdout, scrollOffset));
      };
      const controls = options.json ? undefined : attachTerminalControls({
        input: process.stdin,
        output: process.stdout,
        onResize: () => render(),
        onScroll: (lines) => { scrollOffset = Math.max(0, scrollOffset + lines); render(); },
      });
      try {
        if (!options.json) render();
        const result = await watchRun({
          client,
          baseUrl: options.baseUrl,
          runId: options.runId!,
          after: options.after,
          onEvent: (event) => { history.push(event); render(event); },
          onRetry: (retry) => {
            watchStatus = `Relay 断线；${retry.delayMs}ms 后第 ${retry.attempt} 次恢复（游标 ${retry.cursor}）`;
            if (options.json) process.stderr.write(`${watchStatus}\n`); else render();
          },
          ...(controls === undefined ? {} : { signal: controls.signal }),
        });
        if (!options.json && !result.aborted) {
          watchStatus = result.terminal ? `运行已到终态，最后游标 ${result.cursor}` : `观察结束，最后游标 ${result.cursor}`;
          render();
        }
      } finally {
        controls?.close();
      }
    }
  }
}

if (import.meta.main) {
  runCli(process.argv.slice(2)).catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : "Unknown TUI error"}\n`);
    process.exitCode = 1;
  });
}
