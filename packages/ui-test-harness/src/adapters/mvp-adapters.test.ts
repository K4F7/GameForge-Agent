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

  it("drives a loopback page and writes a correlated PNG screenshot", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "gameforge-playwright-")); roots.push(root);
    const server = createServer((_request, response) => { response.writeHead(200, { "content-type": "text/html" }); response.end("<title>OpenChamber Test</title><button id=go>Go</button>"); });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const address = server.address(); if (address === null || typeof address === "string") throw new Error("Expected TCP address.");
      const driver = new PlaywrightOpenChamberDriver({ sessionRoot: root, baseUrl: `http://127.0.0.1:${address.port}/` });
      await driver.launch({ session, mode: "headless", viewport: { width: 800, height: 600 } }); const result = await driver.snapshot("loaded"); await driver.close();
      expect(result).toMatchObject({ sessionId: "session-mvp", runId: "run-mvp", title: "OpenChamber Test" });
      if (result.screenshotPath === undefined) throw new Error("Expected screenshot path."); await expect(access(path.join(root, result.screenshotPath))).resolves.toBeUndefined();
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
      const driver = new PlaywrightOpenChamberDriver({ sessionRoot: root, baseUrl: `http://127.0.0.1:${address.port}/` });
      await driver.launch({ session, mode: "headless", viewport: { width: 800, height: 600 } });
      await driver.fill("#name", "GameForge"); await driver.click("#go"); await driver.press("#name", "Enter");
      const observed = await driver.snapshot("interacted"); await driver.close();
      expect(observed.title).toBe("OpenChamber Submitted");
      expect(observed.diagnostics.consoleErrors).toContain("GUI probe console error");
      expect(observed.diagnostics.pageErrors).toContain("GUI probe page error");
      expect(observed.diagnostics.failedRequests).toHaveLength(1);

      await driver.launch({ session: { ...session, sessionId: "session-next" }, mode: "headless", viewport: { width: 800, height: 600 } });
      const laterSession = await driver.snapshot("fresh-session"); await driver.close();
      expect(laterSession).toMatchObject({ sessionId: "session-next", diagnostics: { consoleErrors: [], pageErrors: [], failedRequests: [] } });
    } finally { await new Promise<void>((resolve) => server.close(() => resolve())); }
  }, 30_000);
});

function snapshot(): TuiSnapshot { return { sessionId: session.sessionId, status: "running", columns: 80, rows: 24, outputSequence: 0, lastChangedAt: new Date().toISOString(), screen: "" }; }
