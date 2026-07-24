import { describe, expect, test, vi } from "vitest";
import type { BridgeClientOptions, BridgeConnectionState } from "./bridge-client.js";
import { BridgeConnectionManager } from "./bridge-connection-manager.js";

class FakeClient {
  connectionState: BridgeConnectionState = "disconnected";
  constructor(private readonly onStateChange?: (state: BridgeConnectionState) => void) {}
  connect(): void { this.connectionState = "connecting"; this.onStateChange?.("connecting"); }
  disconnect(): void { this.connectionState = "disconnected"; this.onStateChange?.("disconnected"); }
  setState(state: BridgeConnectionState): void { this.connectionState = state; this.onStateChange?.(state); }
}

const baseOptions = {
  port: 47_653,
  token: "t".repeat(32),
  extensionVersion: "test",
  getStatus: () => ({ workspaceFolders: [], capabilities: ["workspace-status", "runtime-status", "runtime-actions"] as const, remoteOperations: "forbidden" as const }),
  getRuntimeStatus: async (requestId: string) => ({ requestId, available: false, remoteOperations: "forbidden" as const }),
  runRuntimeAction: async (request: { requestId: string; action: "reload" | "screenshot" | "tap" | "collectConsole" }) => ({ requestId: request.requestId, action: request.action, ok: false, remoteOperations: "forbidden" as const }),
};

describe("BridgeConnectionManager", () => {
  test("reconnects with newly loaded credentials after a disconnect", () => {
    vi.useFakeTimers();
    const clients: FakeClient[] = [];
    const loads = [baseOptions, { ...baseOptions, port: 47_654, token: "n".repeat(32) }];
    const manager = new BridgeConnectionManager({
      loadOptions: () => loads.shift(),
      createClient: (options: BridgeClientOptions) => {
        const client = new FakeClient(options.onStateChange);
        clients.push(client);
        return client;
      },
    });
    manager.connect();
    clients[0]?.setState("connected");
    clients[0]?.setState("disconnected");
    vi.advanceTimersByTime(250);
    expect(clients).toHaveLength(2);
    expect(clients[1]?.connectionState).toBe("connecting");
    vi.useRealTimers();
  });

  test("manual disconnect cancels reconnect and repeated connect is idempotent", () => {
    vi.useFakeTimers();
    const clients: FakeClient[] = [];
    const manager = new BridgeConnectionManager({
      loadOptions: () => baseOptions,
      createClient: (options: BridgeClientOptions) => {
        const client = new FakeClient(options.onStateChange);
        clients.push(client);
        return client;
      },
    });
    manager.connect();
    manager.connect();
    expect(clients).toHaveLength(1);
    clients[0]?.setState("disconnected");
    manager.disconnect();
    vi.advanceTimersByTime(10_000);
    expect(clients).toHaveLength(1);
    vi.useRealTimers();
  });

  test("waits with bounded backoff until credentials appear", () => {
    vi.useFakeTimers();
    let ready = false;
    const createClient = vi.fn((options: BridgeClientOptions) => new FakeClient(options.onStateChange));
    const manager = new BridgeConnectionManager({
      loadOptions: () => ready ? baseOptions : undefined,
      createClient,
    });
    manager.connect();
    vi.advanceTimersByTime(250);
    expect(createClient).not.toHaveBeenCalled();
    ready = true;
    vi.advanceTimersByTime(500);
    expect(createClient).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  test("retries when a client throws synchronously while connecting", () => {
    vi.useFakeTimers();
    try {
      let attempt = 0;
      const createClient = vi.fn((options: BridgeClientOptions) => {
        const client = new FakeClient(options.onStateChange);
        if (attempt++ === 0) client.connect = () => { throw new Error("bridge connect failed"); };
        return client;
      });
      const manager = new BridgeConnectionManager({ loadOptions: () => baseOptions, createClient });

      expect(() => manager.connect()).not.toThrow();
      expect(manager.connectionState).toBe("waiting");
      vi.advanceTimersByTime(250);

      expect(createClient).toHaveBeenCalledTimes(2);
      expect(manager.connectionState).toBe("connecting");
    } finally {
      vi.useRealTimers();
    }
  });
});
