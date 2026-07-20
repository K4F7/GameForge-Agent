import { describe, expect, test } from "vitest";
import { selectDouyinTarget } from "./cdp-client.js";

const port = 8_465;

function target(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "target-1",
    type: "webview",
    title: "MiniApp Webview",
    url: "http://127.0.0.1:7000/miniapp/index.html?type=microgame",
    webSocketDebuggerUrl: `ws://127.0.0.1:${port}/devtools/page/target-1`,
    ...overrides,
  };
}

describe("Douyin CDP target selection", () => {
  test("prefers a microgame webview over lower-ranked matching targets", () => {
    expect(selectDouyinTarget([
      target({ id: "page", type: "page", url: "http://127.0.0.1/page" }),
      target({ id: "game" }),
    ], port)).toMatchObject({ id: "game", type: "webview", title: "MiniApp Webview" });
  });

  test("rejects ambiguous targets instead of controlling an arbitrary simulator", () => {
    expect(() => selectDouyinTarget([
      target({ id: "game-1" }),
      target({ id: "game-2" }),
    ], port)).toThrow("multiple ambiguous MiniApp Webview");
  });

  test("rejects malformed and non-loopback debugger targets", () => {
    expect(() => selectDouyinTarget({ targets: [] }, port)).toThrow("invalid CDP target list");
    expect(() => selectDouyinTarget([
      target({ webSocketDebuggerUrl: `ws://192.0.2.10:${port}/devtools/page/target-1` }),
    ], port)).toThrow("invalid or non-loopback");
    expect(() => selectDouyinTarget([
      target({ webSocketDebuggerUrl: `ws://127.0.0.1:${port}/other/target-1` }),
    ], port)).toThrow("invalid or non-loopback");
  });
});
