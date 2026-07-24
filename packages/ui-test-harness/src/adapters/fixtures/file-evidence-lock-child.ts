import { access, writeFile } from "node:fs/promises";
import path from "node:path";
import { FileEvidenceSink } from "../file-evidence.js";

const [root, role] = process.argv.slice(2);
if (root === undefined || (role !== "holder" && role !== "contender")) {
  throw new Error("Expected <session-root> <holder|contender>.");
}

const sink = new FileEvidenceSink(root);
await sink.recordSession({
  sessionId: "shared-session",
  startedAt: "2026-07-24T00:00:00.000Z",
  mode: "headless",
});

if (role === "holder") {
  await writeFile(path.join(root, "holder-ready"), "ready\n", "utf8");
  const release = path.join(root, "release-holder");
  while (!await access(release).then(() => true, () => false)) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  await sink.finalize({
    status: "completed",
    scenario: "lock-holder",
    startedAt: "2026-07-24T00:00:00.000Z",
    finishedAt: "2026-07-24T00:00:01.000Z",
  });
}
