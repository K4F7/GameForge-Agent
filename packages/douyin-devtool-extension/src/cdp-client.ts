import CDP = require("chrome-remote-interface");
import type Protocol from "devtools-protocol";

const CDP_OPERATION_TIMEOUT_MS = 5_000;
const CDP_SCREENSHOT_TIMEOUT_MS = 5_000;
const CDP_CONTEXT_SETTLE_MS = 75;

export interface DouyinDevToolsTarget {
  id: string;
  type: string;
  title: string;
}

interface InspectableTarget extends DouyinDevToolsTarget {
  url: string;
  webSocketDebuggerUrl: string;
}

export interface DouyinCdpSession {
  readonly contexts: ReadonlyArray<Protocol.Runtime.ExecutionContextDescription>;
  enableRuntime(): Promise<void>;
  enablePage(): Promise<void>;
  waitForExecutionContexts(timeoutMs?: number): Promise<void>;
  evaluate(params: Protocol.Runtime.EvaluateRequest): Promise<Protocol.Runtime.EvaluateResponse>;
  getLayoutMetrics(): Promise<Protocol.Page.GetLayoutMetricsResponse>;
  reload(params: Protocol.Page.ReloadRequest): Promise<void>;
  dispatchTouchEvent(params: Protocol.Input.DispatchTouchEventRequest): Promise<void>;
  captureScreenshot(params: Protocol.Page.CaptureScreenshotRequest): Promise<Protocol.Page.CaptureScreenshotResponse>;
  onConsole(listener: (event: Protocol.Runtime.ConsoleAPICalledEvent) => void): () => void;
  onException(listener: (event: Protocol.Runtime.ExceptionThrownEvent) => void): () => void;
  close(): Promise<void>;
}

export interface DouyinCdpConnector {
  connect(port: number): Promise<{ target: DouyinDevToolsTarget; session: DouyinCdpSession }>;
}

export const chromeRemoteInterfaceConnector: DouyinCdpConnector = {
  async connect(port) {
    const listedTargets = await withTimeout(
      CDP.List({ host: "127.0.0.1", port }),
      CDP_OPERATION_TIMEOUT_MS,
      "Timed out listing Douyin DevTool CDP targets.",
    );
    const target = selectDouyinTarget(listedTargets, port);
    const client = await withTimeoutAndLateCleanup(
      CDP({ host: "127.0.0.1", port, target: target.webSocketDebuggerUrl }),
      CDP_OPERATION_TIMEOUT_MS,
      "Timed out opening the Douyin DevTool MiniApp CDP socket.",
      async (lateClient) => {
        await lateClient.close().catch(() => undefined);
      },
    );
    return {
      target: { id: target.id, type: target.type, title: target.title },
      session: new ChromeRemoteInterfaceSession(client),
    };
  },
};

class ChromeRemoteInterfaceSession implements DouyinCdpSession {
  readonly #contexts = new Map<number, Protocol.Runtime.ExecutionContextDescription>();
  readonly #contextListeners = new Set<() => void>();
  readonly #subscriptions: Array<() => void> = [];
  #failure: Error | undefined;
  #closePromise: Promise<void> | undefined;

  constructor(private readonly client: CDP.Client) {
    this.#subscriptions.push(
      client.Runtime.executionContextCreated(({ context }) => {
        this.#contexts.set(context.id, context);
        this.#notifyContextListeners();
      }),
      client.Runtime.executionContextDestroyed(({ executionContextId }) => {
        this.#contexts.delete(executionContextId);
        this.#notifyContextListeners();
      }),
      client.Runtime.executionContextsCleared(() => {
        this.#contexts.clear();
        this.#notifyContextListeners();
      }),
    );
    client.on("disconnect", () => {
      if (this.#failure === undefined) this.#failure = new Error("The Douyin DevTool CDP connection closed.");
      this.#notifyContextListeners();
    });
  }

  get contexts(): ReadonlyArray<Protocol.Runtime.ExecutionContextDescription> {
    return [...this.#contexts.values()].sort((left, right) => left.id - right.id);
  }

  async enableRuntime(): Promise<void> {
    await this.#command(() => this.client.Runtime.enable(), "Runtime.enable");
  }

  async enablePage(): Promise<void> {
    await this.#command(() => this.client.Page.enable(), "Page.enable");
  }

  async waitForExecutionContexts(timeoutMs = 1_000): Promise<void> {
    this.#throwIfUnavailable();
    await new Promise<void>((resolveWait, reject) => {
      let settleTimer: ReturnType<typeof setTimeout> | undefined;
      let timeout: ReturnType<typeof setTimeout> | undefined;
      const cleanup = (): void => {
        if (settleTimer !== undefined) clearTimeout(settleTimer);
        if (timeout !== undefined) clearTimeout(timeout);
        this.#contextListeners.delete(onChange);
      };
      const finish = (): void => {
        cleanup();
        resolveWait();
      };
      const onChange = (): void => {
        if (this.#failure !== undefined) {
          cleanup();
          reject(this.#failure);
          return;
        }
        if (this.#contexts.size === 0) return;
        if (settleTimer !== undefined) clearTimeout(settleTimer);
        settleTimer = setTimeout(finish, CDP_CONTEXT_SETTLE_MS);
      };
      timeout = setTimeout(() => {
        cleanup();
        reject(new Error("Timed out waiting for Douyin DevTool Runtime execution contexts."));
      }, timeoutMs);
      this.#contextListeners.add(onChange);
      onChange();
    });
  }

  async evaluate(params: Protocol.Runtime.EvaluateRequest): Promise<Protocol.Runtime.EvaluateResponse> {
    return this.#command(() => this.client.Runtime.evaluate(params), "Runtime.evaluate");
  }

  async getLayoutMetrics(): Promise<Protocol.Page.GetLayoutMetricsResponse> {
    return this.#command(() => this.client.Page.getLayoutMetrics(), "Page.getLayoutMetrics");
  }

  async reload(params: Protocol.Page.ReloadRequest): Promise<void> {
    await this.#command(() => this.client.Page.reload(params), "Page.reload");
  }

  async dispatchTouchEvent(params: Protocol.Input.DispatchTouchEventRequest): Promise<void> {
    await this.#command(() => this.client.Input.dispatchTouchEvent(params), "Input.dispatchTouchEvent");
  }

  async captureScreenshot(
    params: Protocol.Page.CaptureScreenshotRequest,
  ): Promise<Protocol.Page.CaptureScreenshotResponse> {
    return this.#command(
      () => this.client.Page.captureScreenshot(params),
      "Page.captureScreenshot",
      CDP_SCREENSHOT_TIMEOUT_MS,
      false,
    );
  }

  onConsole(listener: (event: Protocol.Runtime.ConsoleAPICalledEvent) => void): () => void {
    return this.client.Runtime.consoleAPICalled(listener);
  }

  onException(listener: (event: Protocol.Runtime.ExceptionThrownEvent) => void): () => void {
    return this.client.Runtime.exceptionThrown(listener);
  }

  async close(): Promise<void> {
    if (this.#closePromise !== undefined) return this.#closePromise;
    if (this.#failure === undefined) this.#failure = new Error("The Douyin DevTool CDP session is closed.");
    this.#notifyContextListeners();
    for (const unsubscribe of this.#subscriptions.splice(0)) unsubscribe();
    this.#closePromise = withTimeout(
      this.client.close(),
      1_000,
      "Timed out closing the Douyin DevTool CDP connection.",
    ).catch(() => undefined);
    return this.#closePromise;
  }

  async #command<T>(
    createOperation: () => Promise<T>,
    name: string,
    timeoutMs = CDP_OPERATION_TIMEOUT_MS,
    closeOnTimeout = true,
  ): Promise<T> {
    this.#throwIfUnavailable();
    const operation = createOperation();
    try {
      return await withTimeout(operation, timeoutMs, `Timed out waiting for CDP ${name}.`);
    } catch (error) {
      if (error instanceof TimeoutError && closeOnTimeout) {
        this.#failure = error;
        void this.close();
      }
      throw error;
    }
  }

  #throwIfUnavailable(): void {
    if (this.#failure !== undefined) throw this.#failure;
  }

  #notifyContextListeners(): void {
    for (const listener of this.#contextListeners) listener();
  }
}

export function selectDouyinTarget(targets: unknown, expectedPort: number): InspectableTarget {
  if (!Array.isArray(targets)) throw new Error("The DevTool returned an invalid CDP target list.");
  const matching = targets.filter((candidate) => isRecord(candidate) && candidate.title === "MiniApp Webview");
  const inspectable = matching.flatMap((candidate) => {
    const id = candidate.id;
    const type = candidate.type;
    const title = candidate.title;
    const url = candidate.url;
    const webSocketDebuggerUrl = candidate.webSocketDebuggerUrl;
    if (
      typeof id !== "string" || id.length === 0 || id.length > 256 ||
      typeof type !== "string" || type.length === 0 || type.length > 64 ||
      typeof title !== "string" ||
      typeof url !== "string" || url.length > 65_536 ||
      typeof webSocketDebuggerUrl !== "string" ||
      !isLoopbackWebSocket(webSocketDebuggerUrl, expectedPort)
    ) return [];
    return [{ id, type, title, url, webSocketDebuggerUrl }];
  });
  if (inspectable.length === 0) {
    if (matching.length > 0) throw new Error("The DevTool returned an invalid or non-loopback MiniApp Webview target.");
    throw new Error("The DevTool did not expose a MiniApp Webview CDP target.");
  }
  const ranked = inspectable
    .map((target) => ({ target, score: targetScore(target) }))
    .sort((left, right) => right.score - left.score || left.target.id.localeCompare(right.target.id));
  const first = ranked[0];
  const second = ranked[1];
  if (first === undefined) throw new Error("The DevTool did not expose a MiniApp Webview CDP target.");
  if (second !== undefined && first.score === second.score) {
    throw new Error("The DevTool exposed multiple ambiguous MiniApp Webview CDP targets.");
  }
  return first.target;
}

function targetScore(target: InspectableTarget): number {
  let score = target.type === "webview" ? 2 : target.type === "page" ? 1 : 0;
  try {
    const url = new URL(target.url);
    if (url.searchParams.get("type") === "microgame" || url.searchParams.get("openApplicationType") === "microgame") {
      score += 2;
    }
  } catch {
    // The target URL is advisory only; the loopback debugger URL is the security boundary.
  }
  return score;
}

function isLoopbackWebSocket(value: string, expectedPort: number): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "ws:" && url.hostname === "127.0.0.1" && Number(url.port) === expectedPort &&
      url.username === "" && url.password === "" && url.hash === "" && url.pathname.startsWith("/devtools/");
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

class TimeoutError extends Error {}

async function withTimeout<T>(operation: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new TimeoutError(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

async function withTimeoutAndLateCleanup<T>(
  operation: Promise<T>,
  timeoutMs: number,
  message: string,
  cleanup: (value: T) => Promise<void>,
): Promise<T> {
  try {
    return await withTimeout(operation, timeoutMs, message);
  } catch (error) {
    void operation.then((value) => cleanup(value)).catch(() => undefined);
    throw error;
  }
}
