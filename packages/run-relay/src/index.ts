#!/usr/bin/env node

import { createRunRelayServer } from "./server.js";
import { RelayStatePersistence } from "./persistence.js";

const host = "127.0.0.1";
const portInput = process.env.GAMEFORGE_RUN_RELAY_PORT?.trim() ?? "8787";
if (!/^\d+$/.test(portInput)) throw new Error("GAMEFORGE_RUN_RELAY_PORT must be an integer.");
const port = Number(portInput);
if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  throw new Error("GAMEFORGE_RUN_RELAY_PORT must be between 1 and 65535.");
}

const stateFile = process.env.GAMEFORGE_RUN_RELAY_STATE_FILE?.trim();
const authToken = process.env.GAMEFORGE_RUN_RELAY_TOKEN;
const persistence = stateFile === undefined || stateFile.length === 0
  ? undefined
  : new RelayStatePersistence(stateFile);
const restored = persistence === undefined ? undefined : await persistence.load();
const server = createRunRelayServer({
  ...(authToken === undefined ? {} : { authToken }),
  ...(restored === undefined ? {} : { store: restored.store, taskInbox: restored.taskInbox }),
  ...(persistence === undefined || restored === undefined
    ? {}
    : { persistState: () => persistence.save(restored.store, restored.taskInbox) }),
});
server.listen(port, host, () => {
  process.stderr.write(`GameForge run relay listening on http://${host}:${port}\n`);
});
