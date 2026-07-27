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
delete process.env.GAMEFORGE_BROWSER_CHANNEL;
const observer = new XtermTuiObserverDriver({ browserChannel: "gameforge-invalid-browser-channel" });
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
