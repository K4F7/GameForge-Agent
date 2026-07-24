import { PlaywrightOpenChamberDriver } from "../../dist/adapters/playwright-openchamber.js";

const driver = new PlaywrightOpenChamberDriver({
  sessionRoot: process.argv[2],
  baseUrl: "http://127.0.0.1:1/",
});
try {
  await driver.launch({
    session: { sessionId: "startup-failure", startedAt: new Date().toISOString(), mode: "headless" },
    mode: "headless",
    viewport: { width: 800, height: 600 },
  });
} catch {
  process.stdout.write("launch rejected\n");
}
