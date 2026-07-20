import net from "node:net";
import { writeFileSync, appendFileSync } from "node:fs";
import { resolve } from "node:path";

const logPath = resolve(process.env.TEMP, "gameforge-listener.log");
writeFileSync(logPath, "");
const log = (line) => {
  console.log(line);
  appendFileSync(logPath, `${line}\n`);
};

const server = net.createServer((socket) => {
  let buffer = "";
  socket.on("data", (chunk) => {
    buffer += chunk.toString();
    if (Buffer.byteLength(buffer, "utf8") > 16_384) {
      socket.destroy();
      return;
    }
    let newline;
    while ((newline = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      if (!line) continue;
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        log("MESSAGE invalid-json");
        continue;
      }
      log(`MESSAGE ${JSON.stringify({ type: message.type, requestId: message.requestId })}`);
      if (message.type === "status") {
        socket.write(`${JSON.stringify({ type: "getRuntimeStatus", requestId: "runtime-1" })}\n`);
      }
      if (message.type === "runtimeStatus") {
        setTimeout(() => server.close(), 100);
      }
    }
  });
});

server.listen(47653, "127.0.0.1", () => log("LISTENING 47653"));
setTimeout(() => server.close(), 120_000);
