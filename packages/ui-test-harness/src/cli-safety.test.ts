import { describe, expect, test } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { safeEvidenceSegment, safeRelayUrl } from "./cli-safety.js";

describe("UI harness CLI safety", () => {
  test.each(["../outside", "..\\outside", "nested/path", "nested\\path", ".", "..", ""])
    ("rejects an unsafe evidence path segment: %j", (value) => {
      expect(() => safeEvidenceSegment(value, "--experiment")).toThrow(/safe path segment/i);
    });

  test.each(["http://example.com:8787/", "http://user:secret@127.0.0.1:8787/"])
    ("rejects an unsafe relay URL before credentials can be sent: %s", (value) => {
      expect(() => safeRelayUrl(value)).toThrow(/relay url/i);
    });

  test("accepts loopback HTTP and remote HTTPS relay URLs", () => {
    expect(safeRelayUrl("http://127.0.0.1:8787")).toBe("http://127.0.0.1:8787/");
    expect(safeRelayUrl("https://relay.example.com/api")).toBe("https://relay.example.com/api/");
  });

  test("evaluates the default projects root before contacting Relay", async () => {
    const output = await runCli(["--headless", "--relay-url", "http://127.0.0.1:1/"], { GAMEFORGE_PROJECT_OUTPUT_ROOT: undefined });
    expect(output).not.toContain("Cannot access 'repoRoot' before initialization");
  });

  test("rejects a traversal project id before contacting Relay", async () => {
    const output = await runCli(["--headless", "--task-id", "task-1", "--run-id", "run-1", "--project-id", "../../outside"]);
    expect(output).toContain("--project-id must be a safe path segment");
  });
});

async function runCli(args: string[], environment: Record<string, string | undefined> = {}): Promise<string> {
  const run = promisify(execFile);
  return run("bun", ["src/cli.ts", ...args], { cwd: process.cwd(), env: { ...process.env, ...environment } })
    .then(({ stdout, stderr }) => `${stdout}${stderr}`)
    .catch((error: { stdout?: string; stderr?: string }) => `${error.stdout ?? ""}${error.stderr ?? ""}`);
}
