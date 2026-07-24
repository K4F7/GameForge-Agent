import { XtermTuiObserverDriver } from "../../dist/adapters/xterm-observer.js";

const sessionId = "xterm-post-ready-failure";
const source = {
  kind: "codearts-original-tui",
  async read() { return { sessionId, status: "running", columns: 80, rows: 24, outputSequence: 0, lastChangedAt: new Date().toISOString(), screen: "" }; },
  async start() { return this.read(); },
  subscribeOutput() { throw new Error("subscription failed"); },
  async sendText() {},
  async sendKey() {},
  async resize() {},
  async stop() {},
};
const observer = new XtermTuiObserverDriver();
try {
  await observer.open({
    session: { sessionId, startedAt: new Date().toISOString(), mode: "headed/watch" },
    source,
    visible: true,
    viewport: { width: 800, height: 600 },
  });
} catch {
  process.stdout.write("open rejected\n");
}
