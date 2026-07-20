import { describe, expect, test } from "vitest";
import {
  BRIDGE_PROTOCOL_VERSION,
  encodeMessage,
  parseControllerRequest,
  parseBridgeRendezvous,
  readBridgeToken,
} from "./protocol.js";

describe("Douyin bridge protocol", () => {
  test("encodes one JSON message per line", () => {
    const encoded = encodeMessage({
      type: "hello",
      protocolVersion: BRIDGE_PROTOCOL_VERSION,
      token: "x".repeat(32),
      extensionVersion: "0.1.0",
      devtool: "douyin",
    });
    expect(encoded.endsWith("\n")).toBe(true);
    expect(JSON.parse(encoded)).toMatchObject({ type: "hello", devtool: "douyin" });
  });

  test("accepts only bounded status requests", () => {
    expect(parseControllerRequest('{"type":"getStatus","requestId":"request-1"}')).toEqual({
      type: "getStatus",
      requestId: "request-1",
    });
    expect(parseControllerRequest('{"type":"getRuntimeStatus","requestId":"runtime-1"}')).toEqual({
      type: "getRuntimeStatus",
      requestId: "runtime-1",
    });
    expect(parseControllerRequest('{"type":"runtimeAction","requestId":"action-1","action":"tap","x":10,"y":20}'))
      .toEqual({ type: "runtimeAction", requestId: "action-1", action: "tap", x: 10, y: 20 });
    expect(parseControllerRequest('{"type":"runtimeAction","requestId":"action-2","action":"collectConsole","durationMs":5000}'))
      .toEqual({ type: "runtimeAction", requestId: "action-2", action: "collectConsole", durationMs: 5000 });
    expect(parseControllerRequest('{"type":"runtimeAction","requestId":"action-3","action":"screenshot"}'))
      .toEqual({ type: "runtimeAction", requestId: "action-3", action: "screenshot" });
    expect(parseControllerRequest('{"type":"runtimeAction","requestId":"bad","action":"tap","x":-1,"y":20}'))
      .toBeUndefined();
    expect(parseControllerRequest('{"type":"runtimeAction","requestId":"bad","action":"collectConsole","durationMs":5001}'))
      .toBeUndefined();
    expect(parseControllerRequest('{"type":"runtimeAction","requestId":"bad","action":"evaluate"}'))
      .toBeUndefined();
    expect(parseControllerRequest('{"type":"evaluate","requestId":"request-1"}')).toBeUndefined();
    expect(parseControllerRequest("not json")).toBeUndefined();
    expect(parseControllerRequest(JSON.stringify({ type: "getStatus", requestId: "x".repeat(129) }))).toBeUndefined();
  });

  test("requires an explicit sufficiently long token", () => {
    expect(readBridgeToken({})).toBeUndefined();
    expect(readBridgeToken({ GAMEFORGE_DOUYIN_BRIDGE_TOKEN: "short" })).toBeUndefined();
    expect(readBridgeToken({ GAMEFORGE_DOUYIN_BRIDGE_TOKEN: `  ${"a".repeat(32)}  ` })).toBe("a".repeat(32));
  });

  test("accepts only short-lived bounded rendezvous data", () => {
    const now = 1_000_000;
    expect(parseBridgeRendezvous(JSON.stringify({ port: 47_653, token: "x".repeat(32), expiresAt: now + 30_000 }), now))
      .toEqual({ port: 47_653, token: "x".repeat(32), expiresAt: now + 30_000 });
    expect(parseBridgeRendezvous(JSON.stringify({ port: 80, token: "x".repeat(32), expiresAt: now + 30_000 }), now))
      .toBeUndefined();
    expect(parseBridgeRendezvous(JSON.stringify({ port: 47_653, token: "short", expiresAt: now + 30_000 }), now))
      .toBeUndefined();
    expect(parseBridgeRendezvous(JSON.stringify({ port: 47_653, token: "x".repeat(32), expiresAt: now - 1 }), now))
      .toBeUndefined();
  });
});
