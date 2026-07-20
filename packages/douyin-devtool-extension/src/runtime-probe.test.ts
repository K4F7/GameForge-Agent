import type Protocol from "devtools-protocol";
import { describe, expect, test, vi } from "vitest";
import type { DouyinCdpConnector, DouyinCdpSession } from "./cdp-client.js";
import { createDouyinRuntimeProbe } from "./runtime-probe.js";

const validScreenshot =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

class FakeSession implements DouyinCdpSession {
  contexts: ReadonlyArray<Protocol.Runtime.ExecutionContextDescription> = [context(1)];
  readonly enableRuntime = vi.fn(async () => undefined);
  readonly enablePage = vi.fn(async () => undefined);
  readonly waitForExecutionContexts = vi.fn(async () => undefined);
  readonly close = vi.fn(async () => undefined);
  readonly reload = vi.fn(async (_params: Protocol.Page.ReloadRequest) => undefined);
  readonly dispatchTouchEvent = vi.fn(async (_params: Protocol.Input.DispatchTouchEventRequest) => undefined);
  evaluate = vi.fn(async (_params: Protocol.Runtime.EvaluateRequest): Promise<Protocol.Runtime.EvaluateResponse> => ({
    result: {
      type: "object",
      value: runtimeContextValue(),
    },
  }));
  getLayoutMetrics = vi.fn(async (): Promise<Protocol.Page.GetLayoutMetricsResponse> => ({
    layoutViewport: { pageX: 0, pageY: 0, clientWidth: 393, clientHeight: 852 },
    visualViewport: { offsetX: 0, offsetY: 0, pageX: 0, pageY: 0, clientWidth: 393, clientHeight: 852, scale: 1 },
    contentSize: { x: 0, y: 0, width: 393, height: 852 },
    cssLayoutViewport: { pageX: 0, pageY: 0, clientWidth: 393, clientHeight: 852 },
    cssVisualViewport: {
      offsetX: 0,
      offsetY: 0,
      pageX: 0,
      pageY: 0,
      clientWidth: 393,
      clientHeight: 852,
      scale: 1,
      zoom: 1,
    },
    cssContentSize: { x: 0, y: 0, width: 393, height: 852 },
  }));
  captureScreenshot = vi.fn(async (_params: Protocol.Page.CaptureScreenshotRequest) => ({ data: validScreenshot }));
  #consoleListener: ((event: Protocol.Runtime.ConsoleAPICalledEvent) => void) | undefined;
  #exceptionListener: ((event: Protocol.Runtime.ExceptionThrownEvent) => void) | undefined;

  onConsole(listener: (event: Protocol.Runtime.ConsoleAPICalledEvent) => void): () => void {
    this.#consoleListener = listener;
    return () => {
      this.#consoleListener = undefined;
    };
  }

  onException(listener: (event: Protocol.Runtime.ExceptionThrownEvent) => void): () => void {
    this.#exceptionListener = listener;
    return () => {
      this.#exceptionListener = undefined;
    };
  }

  emitConsole(event: Protocol.Runtime.ConsoleAPICalledEvent): void {
    this.#consoleListener?.(event);
  }

  emitException(event: Protocol.Runtime.ExceptionThrownEvent): void {
    this.#exceptionListener?.(event);
  }
}

describe("Douyin runtime probe", () => {
  test("continues past a stale context and returns a validated game context", async () => {
    const session = new FakeSession();
    session.contexts = [context(1), context(2)];
    session.evaluate = vi.fn(async ({ contextId }) => {
      if (contextId === 1) throw new Error("Cannot find context");
      return { result: { type: "object" as const, value: runtimeContextValue() } };
    });
    const probe = createDouyinRuntimeProbe(connector(session));

    await expect(probe.probe(8_465)).resolves.toMatchObject({
      cdpPort: 8_465,
      contextCount: 2,
      gameContext: { hasTt: true, hasGameGlobal: true, canvases: [{ clientWidth: 393, clientHeight: 852 }] },
      viewport: { clientWidth: 393, clientHeight: 852, scale: 1, zoom: 1 },
    });
    expect(session.waitForExecutionContexts).toHaveBeenCalledOnce();
    expect(session.close).toHaveBeenCalledOnce();
  });

  test("rejects malformed Runtime values and still closes the session", async () => {
    const session = new FakeSession();
    session.evaluate = vi.fn(async () => ({ result: { type: "object" as const, value: { hasTt: true } } }));
    const probe = createDouyinRuntimeProbe(connector(session));

    await expect(probe.probe(8_465)).rejects.toThrow("No game Runtime context");
    expect(session.close).toHaveBeenCalledOnce();
  });

  test("validates direct action input before connecting", async () => {
    const connect = vi.fn(async () => ({ target: target(), session: new FakeSession() }));
    const probe = createDouyinRuntimeProbe({ connect });

    await expect(probe.executeAction(8_465, { action: "tap", x: Number.NaN, y: 1 }))
      .rejects.toThrow("finite numbers");
    await expect(probe.executeAction(8_465, { action: "collectConsole", durationMs: 5_001 }))
      .rejects.toThrow("between 0 and 5000");
    expect(connect).not.toHaveBeenCalled();
  });

  test("rejects viewport overflow without dispatching input", async () => {
    const session = new FakeSession();
    const probe = createDouyinRuntimeProbe(connector(session));

    await expect(probe.executeAction(8_465, { action: "tap", x: 394, y: 10 }))
      .rejects.toThrow("outside the current Runtime viewport");
    expect(session.dispatchTouchEvent).not.toHaveBeenCalled();
    expect(session.close).toHaveBeenCalledOnce();
  });

  test("requires a canonical PNG screenshot", async () => {
    const session = new FakeSession();
    session.captureScreenshot = vi.fn(async () => ({ data: Buffer.from("not png").toString("base64") }));
    const probe = createDouyinRuntimeProbe(connector(session));

    await expect(probe.executeAction(8_465, { action: "screenshot" })).rejects.toThrow("did not provide a screenshot");
    expect(session.close).toHaveBeenCalledOnce();
  });

  test("falls back to a fixed Canvas PNG capture when Page capture is unavailable", async () => {
    const session = new FakeSession();
    session.captureScreenshot = vi.fn(async () => {
      throw new Error("Page capture timed out");
    });
    session.evaluate = vi.fn(async () => ({
      result: { type: "string" as const, value: `data:image/png;base64,${validScreenshot}` },
    }));
    const probe = createDouyinRuntimeProbe(connector(session));

    await expect(probe.executeAction(8_465, { action: "screenshot" })).resolves.toMatchObject({
      action: "screenshot",
      screenshot: { byteLength: expect.any(Number), sha256: expect.stringMatching(/^[a-f0-9]{64}$/) },
    });
    expect(session.waitForExecutionContexts).toHaveBeenCalledOnce();
  });

  test("bounds console output and tolerates unserializable values", async () => {
    const session = new FakeSession();
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    session.onException = (listener) => {
      queueMicrotask(() => {
        for (let index = 0; index < 70; index += 1) {
          session.emitConsole({
            type: "log",
            args: [{ type: "object", value: circular } as unknown as Protocol.Runtime.RemoteObject],
            executionContextId: 1,
            timestamp: index,
          });
        }
        listener({
          timestamp: 71,
          exceptionDetails: { exceptionId: 1, text: "boom", lineNumber: 1, columnNumber: 1 },
        });
      });
      return () => undefined;
    };
    const probe = createDouyinRuntimeProbe(connector(session));

    const result = await probe.executeAction(8_465, { action: "collectConsole", durationMs: 0 });
    expect(result.console).toHaveLength(64);
    expect(result.console?.[0]?.text).toBe("[unserializable]");
  });
});

function connector(session: DouyinCdpSession): DouyinCdpConnector {
  return { connect: vi.fn(async () => ({ target: target(), session })) };
}

function target() {
  return { id: "target-1", type: "webview", title: "MiniApp Webview" };
}

function context(id: number): Protocol.Runtime.ExecutionContextDescription {
  return { id, origin: "http://127.0.0.1", name: `context-${id}`, uniqueId: `unique-${id}` };
}

function runtimeContextValue(): Record<string, unknown> {
  return {
    title: "Mini Game",
    readyState: "complete",
    canvases: [{ width: 1179, height: 2556, clientWidth: 393, clientHeight: 852 }],
    iframeCount: 0,
    hasTt: true,
    hasGameGlobal: true,
  };
}
