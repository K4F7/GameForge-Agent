#!/usr/bin/env bun

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { RunRelayClient } from "@gameforge/run-relay/client";
import { mcpToolAuditSchema } from "@gameforge/contracts";
import { captureBenchmarkEvidence, evidenceCaptureMetadataSchema } from "./capture.js";
import { benchmarkDefinitionSchema, benchmarkRecordSchema } from "./schema.js";
import { compareRecords, formatComparison } from "./report.js";

const readJson = async (file: string): Promise<unknown> =>
  JSON.parse(await readFile(path.resolve(file), "utf8")) as unknown;

async function main(argv: readonly string[]): Promise<void> {
  const [command, ...args] = argv;
  if (command === "report") {
    await report(args);
    return;
  }
  if (command === "capture") {
    await capture(args);
    return;
  }
  usage();
}

async function report(args: readonly string[]): Promise<void> {
  const [definitionPath, ...rest] = args;
  if (definitionPath === undefined || rest.length < 2) usage();
  const outIndex = rest.indexOf("--out");
  const outputPath = outIndex < 0 ? undefined : rest[outIndex + 1];
  if (outIndex >= 0 && outputPath === undefined) throw new Error("--out requires a path.");
  const recordPaths = outIndex < 0 ? rest : rest.slice(0, outIndex);
  if (rest.filter((value) => value === "--out").length > 1 || (outIndex >= 0 && outIndex !== rest.length - 2)) {
    throw new Error("--out must appear once at the end of the command.");
  }
  if (recordPaths.length < 2) throw new Error("At least two record files are required.");
  const definition = benchmarkDefinitionSchema.parse(await readJson(definitionPath));
  const records = await Promise.all(recordPaths.map(async (file) => benchmarkRecordSchema.parse(await readJson(file))));
  const markdown = formatComparison(definition, compareRecords(definition, records));
  if (outputPath === undefined) process.stdout.write(markdown);
  else await writeFile(path.resolve(outputPath), markdown, "utf8");
}

async function capture(args: readonly string[]): Promise<void> {
  const [definitionPath, metadataPath, ...flags] = args;
  if (definitionPath === undefined || metadataPath === undefined) usage();
  const options = parseCaptureFlags(flags);
  const definition = benchmarkDefinitionSchema.parse(await readJson(definitionPath));
  const metadata = evidenceCaptureMetadataSchema.parse(await readJson(metadataPath));
  const mcpAudit = options.mcpAuditPath === undefined
    ? undefined
    : mcpToolAuditSchema.parse(await readJson(options.mcpAuditPath));
  const relay = new RunRelayClient({ baseUrl: options.relayUrl });
  const record = await captureBenchmarkEvidence({
    definition,
    metadata,
    taskId: options.taskId,
    relay,
    ...(mcpAudit === undefined ? {} : { mcpAudit }),
  });
  await writeFile(path.resolve(options.outputPath), `${JSON.stringify(record, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
}

function parseCaptureFlags(flags: readonly string[]): {
  taskId: string;
  relayUrl: string;
  outputPath: string;
  mcpAuditPath?: string;
} {
  const values = new Map<string, string>();
  for (let index = 0; index < flags.length; index += 2) {
    const name = flags[index];
    const value = flags[index + 1];
    if (name === undefined || value === undefined || !name.startsWith("--") || value.startsWith("--")) usage();
    if (!["--task-id", "--relay-url", "--mcp-audit", "--out"].includes(name)) throw new Error(`Unknown capture option: ${name}`);
    if (values.has(name)) throw new Error(`Duplicate capture option: ${name}`);
    values.set(name, value);
  }
  const taskId = values.get("--task-id");
  const outputPath = values.get("--out");
  if (taskId === undefined || outputPath === undefined) usage();
  const mcpAuditPath = values.get("--mcp-audit");
  return {
    taskId,
    outputPath,
    relayUrl: values.get("--relay-url") ?? process.env.GAMEFORGE_RUN_RELAY_URL?.trim() ?? "http://127.0.0.1:8787/",
    ...(mcpAuditPath === undefined ? {} : { mcpAuditPath }),
  };
}

function usage(): never {
  process.stderr.write(
    "Usage:\n" +
    "  bun run benchmark -- report DEFINITION.json RECORD.json RECORD.json [--out REPORT.md]\n" +
    "  bun run benchmark -- capture DEFINITION.json METADATA.json --task-id ID [--relay-url URL] [--mcp-audit AUDIT.json] --out RECORD.json\n",
  );
  process.exit(2);
}

main(process.argv.slice(2)).catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : "Benchmark command failed."}\n`);
  process.exitCode = 1;
});
