import { lstat, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import type { DouyinBridgeControllerStatus, DouyinBridgePort, DouyinRuntimeAction } from "./douyin-bridge-controller.js";

export class DouyinBridgeHostClient implements DouyinBridgePort {
  private status: DouyinBridgeControllerStatus = { listening: true, connected: false };
  constructor(private readonly rendezvousPath = resolve(tmpdir(), "gameforge-douyin-bridge-host.json")) {}
  getStatus(): DouyinBridgeControllerStatus { return this.status; }
  async getRuntimeStatus(): Promise<Record<string, unknown>> { return this.request("/v1/runtime-status", {}); }
  async runRuntimeAction(action: DouyinRuntimeAction): Promise<Record<string, unknown>> { return this.request("/v1/runtime-action", action); }

  private async request(pathname: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
    const launch = await this.readRendezvous();
    const response = await fetch(`http://127.0.0.1:${launch.port}${pathname}`, {
      method: "POST",
      headers: { authorization: `Bearer ${launch.token}`, "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(50_000),
    });
    const payload = await response.json() as { status?: DouyinBridgeControllerStatus; result?: Record<string, unknown>; message?: string };
    if (payload.status !== undefined) this.status = payload.status;
    if (!response.ok || payload.result === undefined) throw new Error(payload.message ?? `Douyin bridge host returned HTTP ${response.status}.`);
    return payload.result;
  }

  private async readRendezvous(): Promise<{ port: number; token: string }> {
    const metadata = await lstat(this.rendezvousPath);
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > 4_096) throw new Error("The Douyin bridge host rendezvous is invalid.");
    const value = JSON.parse(await readFile(this.rendezvousPath, "utf8")) as Record<string, unknown>;
    if (!Number.isInteger(value.port) || typeof value.port !== "number" || value.port < 1_024 || value.port > 65_535 ||
        typeof value.token !== "string" || value.token.length < 32 || value.token.length > 256) {
      throw new Error("The Douyin bridge host rendezvous is invalid.");
    }
    return { port: value.port, token: value.token };
  }
}
