import { XtermTuiObserverDriver } from "../../dist/adapters/xterm-observer.js";

const source = {
  kind: "codearts-original-tui",
  async read() {
    return { sessionId: "xterm-startup-failure", status: "running", columns: 80, rows: 24, outputSequence: 0, lastChangedAt: new Date().toISOString(), screen: "" };
  },
  async start() { return this.read(); },
  subscribeOutput() { return () => undefined; },
  async sendText() {},
  async sendKey() {},
  async resize() {},
  async stop() {},
};
process.env.GAMEFORGE_BROWSER_CHANNEL = "gameforge-invalid-browser-channel";
const observer = new XtermTuiObserverDriver();
try {
  await observer.open({
    session: { sessionId: "xterm-startup-failure", startedAt: new Date().toISOString(), mode: "headed/watch" },
    source,
    visible: true,
    viewport: { width: 800, height: 600 },
  });
} catch {
  process.stdout.write("open rejected\n");
} finally {
  await observer.close();
}
