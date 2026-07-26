import { createServer } from "node:http";
import { access, mkdtemp, rm } from "node:fs/promises";
import os from "node:os"; import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { CodeArtsTuiDriver, HarnessSession, TuiOutputFrame, TuiSnapshot } from "../contracts.js";
import { PlaywrightOpenChamberDriver } from "./playwright-openchamber.js";
import { XtermTuiObserverDriver } from "./xterm-observer.js";

const roots: string[] = []; afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });
const session: HarnessSession = { sessionId: "session-mvp", runId: "run-mvp", startedAt: new Date().toISOString(), mode: "headless" };

describe("MVP adapters", () => {
  it("parses the one ConPTY output stream with official xterm headless", async () => {
    let listener: ((frame: TuiOutputFrame) => void) | undefined;
    const source: CodeArtsTuiDriver = { kind: "codearts-original-tui", async start() { return snapshot(); }, async read() { return snapshot(); },
      subscribeOutput(value) { listener = value; return () => { listener = undefined; }; }, async sendText() {}, async sendKey() {}, async resize() {}, async stop() {} };
    const observer = new XtermTuiObserverDriver(); await observer.open({ session, source, visible: false, viewport: { width: 800, height: 600 } });
    listener?.({ sessionId: session.sessionId, sequence: 1, data: "first\r\n\x1b[31msecond\x1b[0m" });
    expect(await observer.screen()).toContain("first\nsecond"); expect((await observer.snapshot()).sessionId).toBe(session.sessionId); await observer.close();
  });

  it("requests buffered replay so the observer shows output from before it opened", async () => {
    let listener: ((frame: TuiOutputFrame) => void) | undefined;
    const source: CodeArtsTuiDriver = { kind: "codearts-original-tui", async start() { return snapshot(); }, async read() { return snapshot(); },
      subscribeOutput(value, options) {
        if (options?.replayBuffered === true) value({ sessionId: session.sessionId, sequence: 7, data: "buffered-before-open\r\n" });
        listener = value; return () => { listener = undefined; };
      }, async sendText() {}, async sendKey() {}, async resize() {}, async stop() {} };
    const observer = new XtermTuiObserverDriver();
    await observer.open({ session, source, visible: false, viewport: { width: 800, height: 600 } });
    listener?.({ sessionId: session.sessionId, sequence: 8, data: "after-open" });
    const screen = await observer.screen();
    expect(screen).toContain("buffered-before-open");
    expect(screen).toContain("after-open");
    await observer.close();
  });

  it("settles output emitted while the xterm observer unsubscribes", async () => {
    let listener: ((frame: TuiOutputFrame) => void) | undefined;
    const source: CodeArtsTuiDriver = { kind: "codearts-original-tui", async start() { return snapshot(); }, async read() { return snapshot(); },
      subscribeOutput(value) { listener = value; return () => { const lateListener = listener; listener = undefined; queueMicrotask(() => lateListener?.({ sessionId: session.sessionId, sequence: 1, data: "late" })); }; },
      async sendText() {}, async sendKey() {}, async resize() {}, async stop() {} };
    const observer = new XtermTuiObserverDriver();
    await observer.open({ session, source, visible: false, viewport: { width: 800, height: 600 } });
    try {
      await observer.close();
      let timeout: ReturnType<typeof setTimeout> | undefined;
      try {
        await expect(Promise.race([
          observer.open({ session, source, visible: false, viewport: { width: 800, height: 600 } }),
          new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error("xterm reopen timed out")), 5_000); }),
        ])).resolves.toMatchObject({ sessionId: session.sessionId });
      } finally {
        if (timeout !== undefined) clearTimeout(timeout);
      }
    } finally {
      await observer.close();
    }
  });

  it("drives a loopback page and writes a correlated PNG screenshot", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "gameforge-playwright-")); roots.push(root);
    const server = createServer((_request, response) => { response.writeHead(200, { "content-type": "text/html" }); response.end("<title>OpenChamber Test</title><button id=go>Go</button>"); });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const address = server.address(); if (address === null || typeof address === "string") throw new Error("Expected TCP address.");
      const baseUrl = `http://127.0.0.1:${address.port}/`;
      const driver = new PlaywrightOpenChamberDriver({ sessionRoot: root, baseUrl });
      await driver.launch({ session, mode: "headless", viewport: { width: 800, height: 600 } }); const result = await driver.snapshot("loaded"); await driver.close();
      expect(result).toMatchObject({ sessionId: "session-mvp", runId: "run-mvp", title: "OpenChamber Test" });
      if (result.screenshotPath === undefined) throw new Error("Expected screenshot path."); await expect(access(path.join(root, result.screenshotPath))).resolves.toBeUndefined();
    } finally { await new Promise<void>((resolve) => server.close(() => resolve())); }
  }, 30_000);

  it("does not reload OpenChamber when navigating to the current URL", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "gameforge-playwright-")); roots.push(root);
    let pageRequests = 0;
    const server = createServer((request, response) => {
      if (request.url === "/") pageRequests += 1;
      response.writeHead(200, { "content-type": "text/html" });
      response.end("<title>OpenChamber Stable</title>");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const address = server.address(); if (address === null || typeof address === "string") throw new Error("Expected TCP address.");
      const baseUrl = `http://127.0.0.1:${address.port}/`;
      const driver = new PlaywrightOpenChamberDriver({ sessionRoot: root, baseUrl });
      await driver.launch({ session, mode: "headless", viewport: { width: 800, height: 600 } });
      await driver.navigate(baseUrl);
      const result = await driver.snapshot("same-url"); await driver.close();
      expect(pageRequests).toBe(1);
      expect(result).toMatchObject({ url: baseUrl, diagnostics: { consoleErrors: [], pageErrors: [], failedRequests: [] } });
    } finally { await new Promise<void>((resolve) => server.close(() => resolve())); }
  }, 30_000);

  it("drives GUI interactions, captures browser diagnostics, and isolates a later session", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "gameforge-playwright-")); roots.push(root);
    const server = createServer((request, response) => {
      if (request.url === "/broken") { response.destroy(); return; }
      response.writeHead(200, { "content-type": "text/html" });
      response.end(`<!doctype html><title>OpenChamber Ready</title><input id="name"><button id="go">Go</button><script>
        document.querySelector("#go").addEventListener("click", () => {
          console.error("GUI probe console error");
          fetch("/broken").catch(() => undefined);
          document.title = "OpenChamber Submitted";
        });
        document.querySelector("#name").addEventListener("keydown", (event) => {
          if (event.key === "Enter") throw new Error("GUI probe page error");
        });
      </script>`);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const address = server.address(); if (address === null || typeof address === "string") throw new Error("Expected TCP address.");
      const baseUrl = `http://127.0.0.1:${address.port}/`;
      const driver = new PlaywrightOpenChamberDriver({ sessionRoot: root, baseUrl });
      await driver.launch({ session, mode: "headless", viewport: { width: 800, height: 600 } });
      await driver.fill("#name", "GameForge"); await driver.click("#go"); await driver.press("#name", "Enter");
      const observed = await driver.snapshot("interacted"); await driver.close();
      expect(observed.title).toBe("OpenChamber Submitted");
      expect(observed.diagnostics.consoleErrors.some((error) => error.startsWith("GUI probe console error"))).toBe(true);
      expect(observed.diagnostics.consoleErrors.some((error) => error.includes(baseUrl))).toBe(true);
      expect(observed.diagnostics.pageErrors).toContain("GUI probe page error");
      expect(observed.diagnostics.failedRequests).toHaveLength(1);

      await driver.launch({ session: { ...session, sessionId: "session-next" }, mode: "headless", viewport: { width: 800, height: 600 } });
      const laterSession = await driver.snapshot("fresh-session"); await driver.close();
      expect(laterSession).toMatchObject({ sessionId: "session-next", diagnostics: { consoleErrors: [], pageErrors: [], failedRequests: [] } });
    } finally { await new Promise<void>((resolve) => server.close(() => resolve())); }
  }, 30_000);

  it("ignores missing optional OpenChamber config files but retains other console errors", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "gameforge-playwright-")); roots.push(root);
    const server = createServer((request, response) => {
      if (request.url === "/favicon.ico") { response.writeHead(204); response.end(); return; }
      if (request.url === "/") {
        response.writeHead(200, { "content-type": "text/html" });
        response.end(`<!doctype html><title>OpenChamber Config Probe</title><script>
          Promise.all([
            fetch("/api/fs/read?path=C%3A%2FUsers%2Ftester%2F.config%2Fopenchamber%2Fprojects%2Fproject.json"),
            fetch("/api/fs/read?path=D%3A%2Frepo%2F.openchamber%2Fopenchamber.json"),
            fetch("/missing-business-resource"),
          ]).then(() => document.body.insertAdjacentHTML("beforeend", '<div id="requests-complete"></div>'));
        </script>`);
        return;
      }
      response.writeHead(404); response.end("missing");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const address = server.address(); if (address === null || typeof address === "string") throw new Error("Expected TCP address.");
      const baseUrl = `http://127.0.0.1:${address.port}/`;
      const driver = new PlaywrightOpenChamberDriver({ sessionRoot: root, baseUrl });
      await driver.launch({ session, mode: "headless", viewport: { width: 800, height: 600 } });
      await driver.waitFor("#requests-complete", { state: "attached", timeoutMs: 1_000 });
      const observed = await driver.snapshot("optional-config-404"); await driver.close();
      expect(observed.diagnostics.consoleErrors).toHaveLength(1);
      expect(observed.diagnostics.consoleErrors[0]).toContain("/missing-business-resource");
      expect(observed.diagnostics.failedRequests).toEqual([`GET ${baseUrl}missing-business-resource HTTP 404`]);
    } finally { await new Promise<void>((resolve) => server.close(() => resolve())); }
  }, 30_000);

  it("reports HTTP error responses as failed GUI requests", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "gameforge-playwright-")); roots.push(root);
    const server = createServer((request, response) => {
      if (request.url === "/") {
        response.writeHead(200, { "content-type": "text/html" });
        response.end(`<!doctype html><title>OpenChamber HTTP Probe</title><script>
          fetch("/api/broken").then(() => document.body.insertAdjacentHTML("beforeend", '<div id="request-complete"></div>'));
        </script>`);
        return;
      }
      response.writeHead(500); response.end("broken");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const address = server.address(); if (address === null || typeof address === "string") throw new Error("Expected TCP address.");
      const baseUrl = `http://127.0.0.1:${address.port}/`;
      const driver = new PlaywrightOpenChamberDriver({ sessionRoot: root, baseUrl });
      await driver.launch({ session, mode: "headless", viewport: { width: 800, height: 600 } });
      await driver.waitFor("#request-complete", { state: "attached", timeoutMs: 1_000 });
      const observed = await driver.snapshot("http-500"); await driver.close();
      expect(observed.diagnostics.failedRequests).toContain(`GET ${baseUrl}api/broken HTTP 500`);
    } finally { await new Promise<void>((resolve) => server.close(() => resolve())); }
  }, 30_000);

  it("waits for an asynchronous GUI state before capturing evidence", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "gameforge-playwright-")); roots.push(root);
    const server = createServer((request, response) => {
      response.writeHead(200, { "content-type": "text/html" });
      response.end(`<!doctype html><title>OpenChamber Pending</title><button id="go">Go</button><script>
        document.querySelector("#go").addEventListener("click", () => setTimeout(() => {
          document.title = "OpenChamber Complete";
          document.body.insertAdjacentHTML("beforeend", '<div id="done">Done</div>');
        }, 50));
      </script>`);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const address = server.address(); if (address === null || typeof address === "string") throw new Error("Expected TCP address.");
      const baseUrl = `http://127.0.0.1:${address.port}/`;
      const driver = new PlaywrightOpenChamberDriver({ sessionRoot: root, baseUrl });
      await driver.launch({ session, mode: "headless", viewport: { width: 800, height: 600 } });
      await driver.click("#go");
      await driver.waitFor("#done", { state: "visible", timeoutMs: 1_000 });
      const observed = await driver.snapshot("async-complete"); await driver.close();
      expect(observed.title).toBe("OpenChamber Complete");
    } finally { await new Promise<void>((resolve) => server.close(() => resolve())); }
  }, 30_000);
});

function snapshot(): TuiSnapshot { return { sessionId: session.sessionId, status: "running", columns: 80, rows: 24, outputSequence: 0, lastChangedAt: new Date().toISOString(), screen: "" }; }
