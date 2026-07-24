import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { PlaywrightOpenChamberDriver } from "../../dist/adapters/playwright-openchamber.js";

const server = createServer((_request, response) => {
  response.writeHead(200, { "content-type": "text/html" });
  response.end("<!doctype html><title>Remote Close</title>");
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
if (address === null || typeof address === "string") throw new Error("Expected TCP address.");

const driver = new PlaywrightOpenChamberDriver({
  sessionRoot: process.argv[2],
  baseUrl: `http://127.0.0.1:${address.port}/`,
});
try {
  await driver.launch({
    session: { sessionId: "remote-success-close", startedAt: new Date().toISOString(), mode: "headless" },
    mode: "headless",
    viewport: { width: 800, height: 600 },
  });
  const helperPid = Number(execFileSync("powershell.exe", [
    "-NoProfile",
    "-Command",
    `(Get-CimInstance Win32_Process -Filter \"ParentProcessId = ${process.pid}\" | Where-Object { $_.Name -like 'node*' -and $_.CommandLine -like '*playwright-server.js*' } | Select-Object -First 1 -ExpandProperty ProcessId)`,
  ], { encoding: "utf8", windowsHide: true }).trim());
  if (!Number.isSafeInteger(helperPid)) throw new Error("Expected Playwright Node helper PID.");
  const browserPids = execFileSync("powershell.exe", [
    "-NoProfile",
    "-Command",
    `$root = Get-CimInstance Win32_Process -Filter \"ProcessId = ${helperPid}\"; $all = @(Get-CimInstance Win32_Process | Where-Object { $_.CreationDate -ge $root.CreationDate }); $parents = @(${helperPid}); $descendants = @(); do { $children = @($all | Where-Object { $parents -contains $_.ParentProcessId -and $descendants -notcontains $_.ProcessId } | Select-Object -ExpandProperty ProcessId); $descendants += $children; $parents = $children } while ($children.Count -gt 0); $descendants -join ','`,
  ], { encoding: "utf8", windowsHide: true }).trim().split(",").filter(Boolean).map(Number);
  if (browserPids.length === 0 || browserPids.some((pid) => !Number.isSafeInteger(pid))) throw new Error("Expected Playwright browser process PIDs.");
  const concurrentClose = process.argv.includes("--concurrent-close");
  let firstCloseSettled = false;
  const firstClose = driver.close().then(() => { firstCloseSettled = true; });
  if (concurrentClose) await driver.close(); else await firstClose;
  let helperAliveAfterClose = false;
  try { process.kill(helperPid, 0); helperAliveAfterClose = true; } catch {}
  const browserPidsAliveAfterClose = browserPids.filter((pid) => {
    try { process.kill(pid, 0); return true; } catch { return false; }
  });
  await firstClose;
  process.stdout.write(JSON.stringify({ helperAliveAfterClose, browserPidsAliveAfterClose, ...(concurrentClose ? { firstCloseSettledWhenSecondResolved: firstCloseSettled } : {}) }));
} finally {
  await driver.close();
  await new Promise((resolve) => server.close(resolve));
}
