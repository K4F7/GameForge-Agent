import { createServer } from "node:http";
import { PlaywrightOpenChamberDriver } from "../../dist/adapters/playwright-openchamber.js";

const server = createServer((_request, response) => {
  response.writeHead(200, { "content-type": "text/html" });
  response.end(`<!doctype html><title>Remote Pending</title><button id="go">Go</button><script>
    document.querySelector("#go").addEventListener("click", () => setTimeout(() => {
      document.title = "Remote Complete";
      document.body.insertAdjacentHTML("beforeend", '<div id="done">Done</div>');
    }, 50));
  </script>`);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
if (address === null || typeof address === "string") throw new Error("Expected TCP address.");
const driver = new PlaywrightOpenChamberDriver({ sessionRoot: process.argv[2], baseUrl: `http://127.0.0.1:${address.port}/` });
try {
  await driver.launch({
    session: { sessionId: "remote-wait", startedAt: new Date().toISOString(), mode: "headless" },
    mode: "headless",
    viewport: { width: 800, height: 600 },
  });
  // Navigating to the URL the page is already on must be a no-op, not an
  // error - the readiness scenario's first step does exactly this.
  await driver.navigate(`http://127.0.0.1:${address.port}/`);
  await driver.click("#go");
  await driver.waitFor("#done", { state: "visible", timeoutMs: 2_000 });
  const snapshot = await driver.snapshot("remote-complete");
  process.stdout.write(`${JSON.stringify({ title: snapshot.title, diagnostics: snapshot.diagnostics })}\n`);
} finally {
  await driver.close();
  await new Promise((resolve) => server.close(resolve));
}
