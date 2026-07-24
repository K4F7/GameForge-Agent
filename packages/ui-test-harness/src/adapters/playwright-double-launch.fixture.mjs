import { createServer } from "node:http";
import { PlaywrightOpenChamberDriver } from "../../dist/adapters/playwright-openchamber.js";

const server = createServer((_request, response) => {
  response.writeHead(200, { "content-type": "text/html" });
  response.end("<!doctype html><title>Double Launch Probe</title>");
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
if (address === null || typeof address === "string") throw new Error("Expected TCP address.");

const driver = new PlaywrightOpenChamberDriver({ sessionRoot: process.argv[2], baseUrl: `http://127.0.0.1:${address.port}/` });
const launchOptions = {
  session: { sessionId: "double-launch", startedAt: new Date().toISOString(), mode: "headless" },
  mode: "headless",
  viewport: { width: 800, height: 600 },
};
try {
  await driver.launch(launchOptions);
  if (process.argv.includes("--during-close")) {
    const closing = driver.close();
    await new Promise((resolve) => setImmediate(resolve));
    try {
      await driver.launch(launchOptions);
      process.stdout.write("launch while closing accepted\n");
    } catch {
      process.stdout.write("launch while closing rejected\n");
    }
    await closing;
  } else {
    try {
      await driver.launch(launchOptions);
      process.stdout.write("second launch accepted\n");
    } catch {
      process.stdout.write("second launch rejected\n");
    }
  }
} finally {
  await driver.close();
  await new Promise((resolve) => server.close(resolve));
}
