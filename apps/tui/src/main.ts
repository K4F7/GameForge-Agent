#!/usr/bin/env bun

import { RunRelayClient } from "@gameforge/run-relay/client";
import type { WireRunEvent } from "@gameforge/contracts";
import { parseArgs } from "./args.js";
import { formatSummary, summarizeRun } from "./summary.js";
import { streamRunEvents } from "./stream.js";

const help = `GameForge TUI

Usage:
  bun run tui -- submit --run-id ID --prompt TEXT [--language zh-CN|en-US]
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
      const replay = await client.replayEvents({ runId: options.runId!, after: options.after });
      history.push(...replay.events);
      const render = (event?: WireRunEvent): void => {
        if (options.json) {
          if (event !== undefined) process.stdout.write(`${JSON.stringify(event)}\n`);
          return;
        }
        const summary = summarizeRun(history);
        const text = summary === null ? "Waiting for run events..." : formatSummary(summary);
        if (process.stdout.isTTY) process.stdout.write(`\u001b[2J\u001b[H${text}\n`);
        else process.stdout.write(`${text}\n`);
      };
      if (options.json) replay.events.forEach((event) => render(event)); else render();
      const cursor = replay.events.at(-1)?.sequence ?? options.after;
      const terminal = replay.events.at(-1);
      if (terminal?.type === "run.completed" || terminal?.type === "run.stopped" ||
          (terminal?.type === "phase.failed" && !terminal.repairable)) return;
      await streamRunEvents({
        baseUrl: options.baseUrl,
        runId: options.runId!,
        after: cursor,
        onEvent: (event) => { history.push(event); render(event); },
      });
    }
  }
}

if (import.meta.main) {
  runCli(process.argv.slice(2)).catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : "Unknown TUI error"}\n`);
    process.exitCode = 1;
  });
}
