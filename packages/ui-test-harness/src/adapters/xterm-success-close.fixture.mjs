import { execFileSync } from "node:child_process";
import { XtermTuiObserverDriver } from "../../dist/adapters/xterm-observer.js";

const sessionId = "xterm-success-close";
const source = {
  kind: "codearts-original-tui",
  async read() { return { sessionId, status: "running", columns: 80, rows: 24, outputSequence: 0, lastChangedAt: new Date().toISOString(), screen: "" }; },
  async start() { return this.read(); },
  subscribeOutput() { return () => undefined; },
  async sendText() {},
  async sendKey() {},
  async resize() {},
  async stop() {},
};
const observer = new XtermTuiObserverDriver();
const opened = await observer.open({
  session: { sessionId, startedAt: new Date().toISOString(), mode: "headed/watch" },
  source,
  visible: true,
  viewport: { width: 800, height: 600 },
});
const helperPid = Number(execFileSync("powershell.exe", [
  "-NoProfile",
  "-Command",
  `(Get-CimInstance Win32_Process -Filter \"ParentProcessId = ${process.pid}\" | Where-Object { $_.Name -like 'node*' -and $_.CommandLine -like '*xterm-window.js*' } | Select-Object -First 1 -ExpandProperty ProcessId)`,
], { encoding: "utf8", windowsHide: true }).trim());
if (!Number.isSafeInteger(helperPid)) throw new Error("Expected visible xterm Node helper PID.");
const browserPids = execFileSync("powershell.exe", [
  "-NoProfile",
  "-Command",
  `$root = Get-CimInstance Win32_Process -Filter \"ProcessId = ${helperPid}\"; $all = @(Get-CimInstance Win32_Process | Where-Object { $_.CreationDate -ge $root.CreationDate }); $parents = @(${helperPid}); $descendants = @(); do { $children = @($all | Where-Object { $parents -contains $_.ParentProcessId -and $descendants -notcontains $_.ProcessId } | Select-Object -ExpandProperty ProcessId); $descendants += $children; $parents = $children } while ($children.Count -gt 0); $descendants -join ','`,
], { encoding: "utf8", windowsHide: true }).trim().split(",").filter(Boolean).map(Number);
if (browserPids.length === 0 || browserPids.some((pid) => !Number.isSafeInteger(pid))) throw new Error("Expected xterm browser process PIDs.");
if (process.argv.includes("--open-during-close")) {
  const closing = observer.close();
  await new Promise((resolve) => setImmediate(resolve));
  try {
    await observer.open({
      session: { sessionId, startedAt: new Date().toISOString(), mode: "headed/watch" },
      source,
      visible: true,
      viewport: { width: 800, height: 600 },
    });
    process.stdout.write("open while closing accepted");
  } catch {
    process.stdout.write("open while closing rejected");
  }
  await closing;
  await observer.close();
} else {
const concurrentClose = process.argv.includes("--concurrent-close");
const firstClose = observer.close();
if (concurrentClose) await observer.close(); else await firstClose;
let helperAliveAfterClose = false;
try { process.kill(helperPid, 0); helperAliveAfterClose = true; } catch {}
const browserPidsAliveAfterClose = browserPids.filter((pid) => {
  try { process.kill(pid, 0); return true; } catch { return false; }
});
await firstClose;
process.stdout.write(JSON.stringify({ visible: opened.visible, helperAliveAfterClose, browserPidsAliveAfterClose }));
}
