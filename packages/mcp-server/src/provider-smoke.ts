import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { gameforgeCapabilitySnapshotSchema } from "@gameforge/contracts";
import { missingProviderEnvironment, parseProviderSelection, publicEvidence, type ProviderName } from "./provider-smoke-core.js";

const args = process.argv.slice(2);
const execute = args.includes("--execute");
const selected = parseProviderSelection(args.find((arg) => arg.startsWith("--providers="))?.slice(12));
const root = process.cwd();
const outputRoot = path.join(root, ".gameforge-validation", "provider-smoke", "projects");
const evidencePath = path.join(root, ".gameforge-validation", "provider-smoke", "evidence.json");
const projectId = `provider-smoke-${new Date().toISOString().replace(/\D/g, "").slice(0, 14)}-${crypto.randomUUID().slice(0, 8)}`;
const missing = Object.fromEntries(selected.map((provider) => [provider, missingProviderEnvironment(provider, process.env)]));
const ready = selected.filter((provider) => missing[provider]?.length === 0);
const report: Record<string, unknown> = {
  executed: execute,
  selected,
  ready,
  missing,
  startedAt: new Date().toISOString(),
  warning: "--execute performs real provider requests and may incur charges.",
};

async function writeEvidence(): Promise<void> {
  await mkdir(path.dirname(evidencePath), { recursive: true });
  await writeFile(evidencePath, `${JSON.stringify(publicEvidence(report), null, 2)}\n`, "utf8");
}

if (!execute) {
  report.ok = ready.length === selected.length;
  report.finishedAt = new Date().toISOString();
  await writeEvidence();
  console.log(JSON.stringify(report, null, 2));
  process.exit(ready.length === selected.length ? 0 : 1);
}
if (ready.length !== selected.length) {
  report.ok = false;
  report.finishedAt = new Date().toISOString();
  await writeEvidence();
  console.error(JSON.stringify(report, null, 2));
  process.exit(1);
}

await mkdir(outputRoot, { recursive: true });
const serverEntry = path.join(root, "packages", "mcp-server", "dist", "index.js");
const environment = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined));
environment.GAMEFORGE_PROJECT_OUTPUT_ROOT = outputRoot;
const transport = new StdioClientTransport({ command: process.execPath, args: [serverEntry], cwd: root, env: environment, stderr: "pipe" });
const client = new Client({ name: "gameforge-provider-smoke", version: "1.0.0" });
const results: Record<string, unknown> = {};

async function call(name: string, input: Record<string, unknown>, evidenceName = name): Promise<Record<string, unknown>> {
  const started = performance.now();
  const result = await client.callTool({ name, arguments: input });
  if (result.isError === true || !Array.isArray(result.content) || result.content[0]?.type !== "text") {
    throw new Error(`${name} failed.`);
  }
  const parsed = JSON.parse(result.content[0].text) as Record<string, unknown>;
  results[evidenceName] = { elapsedMs: Math.round(performance.now() - started), result: publicEvidence(parsed) };
  return parsed;
}

try {
  await client.connect(transport);
  const tools = (await client.listTools()).tools.map((tool) => tool.name);
  const capabilityResult = await call("get_gameforge_capabilities", {});
  report.capabilities = gameforgeCapabilitySnapshotSchema.parse(capabilityResult);
  report.tools = tools.sort();

  let spec: Record<string, unknown> | undefined;
  if (selected.includes("qwen")) {
    const drafted = await call("draft_game_spec", { prompt: "制作一个中文单屏收集游戏，玩家收集三枚星星并躲避一个障碍。", language: "zh-CN" });
    spec = drafted.spec as Record<string, unknown>;
  }
  if ((selected.includes("seedream") || selected.includes("freesound") || selected.includes("tts")) && spec === undefined) {
    throw new Error("Media smoke requires qwen in --providers so the temporary project is generated from a real validated GameSpec.");
  }
  if (spec !== undefined && selected.some((provider) => provider !== "qwen")) {
    await call("generate_game_project", { projectId, spec, mode: "apply" });
  }
  if (selected.includes("seedream")) {
    await call("request_image_asset", { projectId, assetId: "smoke-player", prompt: "可爱简洁的蓝色太空探险者，单个角色，全身，纯色背景，2D游戏素材", size: "1K", watermark: false, role: "player" });
  }
  if (selected.includes("freesound")) {
    const search = await call("search_sound_asset", { query: "short impact", license: "cc0", pageSize: 1 });
    const candidate = (search.candidates as Array<Record<string, unknown>> | undefined)?.[0];
    if (candidate === undefined) throw new Error("Freesound returned no CC0 candidate.");
    await call("import_sound_asset", { projectId, assetId: "smoke-hit", soundId: candidate.soundId, name: candidate.name, username: candidate.username, license: candidate.license, sourceUrl: candidate.sourceUrl, previewUrl: candidate.previewUrl, role: "hit-sound" });
  }
  if (selected.includes("tts")) {
    const submitted = await call("submit_voice_job", { projectId, assetId: "smoke-voice", text: "欢迎来到游戏。", voiceType: process.env.GAMEFORGE_TTS_SMOKE_VOICE, format: "mp3", language: "zh-CN" });
    const jobHandle = submitted.jobHandle;
    if (typeof jobHandle !== "string") throw new Error("TTS submit did not return a job handle.");
    let status = submitted.status;
    for (let attempt = 0; status === "processing" && attempt < 5; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 2_000));
      status = (await call("query_voice_job", { projectId, jobHandle }, `query_voice_job_${attempt + 1}`)).status;
    }
    if (status === "succeeded") await call("materialize_voice_job", { projectId, jobHandle });
    else {
      report.ttsPending = true;
      throw new Error("TTS job did not reach succeeded within the bounded smoke window.");
    }
  }
  report.ok = true;
} catch (error) {
  report.ok = false;
  report.error = error instanceof Error ? error.message : String(error);
  process.exitCode = 1;
} finally {
  report.results = results;
  report.finishedAt = new Date().toISOString();
  await writeEvidence();
  await client.close().catch(() => undefined);
  console.log(JSON.stringify(publicEvidence(report), null, 2));
}
