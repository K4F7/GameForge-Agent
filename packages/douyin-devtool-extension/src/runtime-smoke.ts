import { probeDouyinRuntime } from "./runtime-probe.js";

async function main(): Promise<void> {
  const configuredPort = Number.parseInt(process.env.GAMEFORGE_DOUYIN_CDP_PORT ?? "", 10);
  const port = Number.isInteger(configuredPort) && configuredPort >= 1_024 && configuredPort <= 65_535
    ? configuredPort
    : undefined;
  const result = await probeDouyinRuntime(port, true);
  process.stdout.write(`${JSON.stringify({ ok: true, ...result })}\n`);
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
