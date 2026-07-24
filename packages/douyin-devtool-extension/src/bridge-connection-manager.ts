import { BridgeClient, type BridgeClientOptions, type BridgeConnectionState } from "./bridge-client.js";

type ManagedClient = Pick<BridgeClient, "connect" | "disconnect" | "connectionState">;
type Schedule = (callback: () => void, delayMs: number) => NodeJS.Timeout;

export interface BridgeConnectionManagerOptions {
  loadOptions: () => Omit<BridgeClientOptions, "onStateChange"> | undefined;
  onStateChange?: (state: BridgeConnectionState | "waiting") => void;
  createClient?: (options: BridgeClientOptions) => ManagedClient;
  schedule?: Schedule;
  cancel?: (timer: NodeJS.Timeout) => void;
}

export class BridgeConnectionManager {
  private client: ManagedClient | undefined;
  private timer: NodeJS.Timeout | undefined;
  private desired = false;
  private attempt = 0;

  constructor(private readonly options: BridgeConnectionManagerOptions) {}

  get connectionState(): BridgeConnectionState | "waiting" {
    return this.client?.connectionState ?? (this.desired ? "waiting" : "disconnected");
  }

  writeStatus(): void {
    if (this.client instanceof BridgeClient) this.client.writeStatus();
  }

  connect(): void {
    this.desired = true;
    if (this.client?.connectionState === "connected" || this.client?.connectionState === "connecting") return;
    this.clearTimer();
    this.tryConnect();
  }

  disconnect(): void {
    this.desired = false;
    this.attempt = 0;
    this.clearTimer();
    const client = this.client;
    this.client = undefined;
    client?.disconnect();
    this.options.onStateChange?.("disconnected");
  }

  private tryConnect(): void {
    if (!this.desired || this.client !== undefined) return;
    const loaded = this.options.loadOptions();
    if (loaded === undefined) {
      this.options.onStateChange?.("waiting");
      this.scheduleReconnect();
      return;
    }
    let candidate: ManagedClient;
    candidate = (this.options.createClient ?? ((clientOptions) => new BridgeClient(clientOptions)))({
      ...loaded,
      onStateChange: (state) => {
        if (this.client !== candidate) return;
        if (state === "connected") {
          this.attempt = 0;
          this.options.onStateChange?.(state);
          return;
        }
        if (state === "disconnected") {
          this.client = undefined;
          this.options.onStateChange?.("waiting");
          this.scheduleReconnect();
          return;
        }
        this.options.onStateChange?.(state);
      },
    });
    this.client = candidate;
    try {
      candidate.connect();
    } catch {
      if (this.client !== candidate) return;
      this.client = undefined;
      try { candidate.disconnect(); } catch { /* best-effort cleanup */ }
      this.options.onStateChange?.("waiting");
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (!this.desired || this.timer !== undefined) return;
    const delayMs = Math.min(5_000, 250 * 2 ** Math.min(this.attempt++, 5));
    const schedule = this.options.schedule ?? setTimeout;
    this.timer = schedule(() => {
      this.timer = undefined;
      this.tryConnect();
    }, delayMs);
  }

  private clearTimer(): void {
    if (this.timer === undefined) return;
    (this.options.cancel ?? clearTimeout)(this.timer);
    this.timer = undefined;
  }
}
