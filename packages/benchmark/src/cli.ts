#!/usr/bin/env bun

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { benchmarkDefinitionSchema, benchmarkRecordSchema } from "./schema.js";
import { compareRecords, formatComparison } from "./report.js";

const [command, definitionPath, ...rest] = process.argv.slice(2);
if (command !== "report" || definitionPath === undefined || rest.length < 2) {
  console.error("Usage: bun run benchmark -- report DEFINITION.json RECORD.json RECORD.json [--out REPORT.md]");
  process.exit(2);
}
const outIndex = rest.indexOf("--out");
const outputPath = outIndex < 0 ? undefined : rest[outIndex + 1];
if (outIndex >= 0 && outputPath === undefined) throw new Error("--out requires a path.");
const recordPaths = outIndex < 0 ? rest : rest.slice(0, outIndex);
if (rest.filter((value) => value === "--out").length > 1 || (outIndex >= 0 && outIndex !== rest.length - 2)) {
  throw new Error("--out must appear once at the end of the command.");
}
if (recordPaths.length < 2) throw new Error("At least two record files are required.");
const readJson = async (file: string): Promise<unknown> => JSON.parse(await readFile(path.resolve(file), "utf8")) as unknown;
const definition = benchmarkDefinitionSchema.parse(await readJson(definitionPath));
const records = await Promise.all(recordPaths.map(async (file) => benchmarkRecordSchema.parse(await readJson(file))));
const markdown = formatComparison(definition, compareRecords(definition, records));
if (outputPath === undefined) process.stdout.write(markdown);
else await writeFile(path.resolve(outputPath), markdown, "utf8");
