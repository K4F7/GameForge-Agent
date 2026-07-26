import { describe, expect, test } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { loopbackHttpPort, safeCodeArtsServerUrl, safeEvidenceSegment, safeRelayUrl } from "./cli-safety.js";

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

  test.each(["https://example.com:4097/", "http://127.0.0.1:4097/?token=secret", "http://user:secret@127.0.0.1:4097/"])
    ("rejects unsafe CodeArts attach URLs: %s", (value) => {
      expect(() => safeCodeArtsServerUrl(value)).toThrow(/codearts server url/i);
    });

  test("accepts a credential-free loopback CodeArts attach URL", () => {
    expect(safeCodeArtsServerUrl("http://127.0.0.1:4097")).toBe("http://127.0.0.1:4097/");
  });

  test("derives a management port only from plain-HTTP loopback URLs", () => {
    expect(loopbackHttpPort("http://127.0.0.1:8787/", "Relay URL")).toBe(8787);
    expect(loopbackHttpPort("http://localhost:43163/", "OpenChamber URL")).toBe(43163);
    // testenv:up only serves plain HTTP; an HTTPS management URL would report
    // ready while every probe hits TLS handshake failures on the same listener.
    expect(() => loopbackHttpPort("https://127.0.0.1:43163/", "OpenChamber URL")).toThrow(/plain HTTP/i);
    expect(() => loopbackHttpPort("http://relay.example.com/", "Relay URL")).toThrow(/loopback/i);
    expect(() => loopbackHttpPort("http://user:secret@127.0.0.1:8787/", "Relay URL")).toThrow(/credentials/i);
  });

  test("evaluates the default projects root before contacting Relay", async () => {
    const output = await runCli(["--headless", "--relay-url", "http://127.0.0.1:1/"], { GAMEFORGE_PROJECT_OUTPUT_ROOT: undefined });
    expect(output).not.toContain("Cannot access 'repoRoot' before initialization");
  });

  test("rejects a traversal project id before contacting Relay", async () => {
    const output = await runCli(["--headless", "--task-id", "task-1", "--run-id", "run-1", "--project-id", "../../outside"]);
    expect(output).toContain("--project-id must be a safe path segment");
  });

  test("rejects an unsafe CodeArts attach URL before contacting Relay", async () => {
    const output = await runCli(["--headless", "--codearts-server-url", "https://example.com:4097", "--codearts-session", "ses_probe"]);
    expect(output).toContain("CodeArts server URL");
  });

  test("requires CodeArts attach URL and session together", async () => {
    const output = await runCli(["--headless", "--codearts-server-url", "http://127.0.0.1:4097"]);
    expect(output).toContain("--codearts-server-url and --codearts-session must be provided together");
  });
});

async function runCli(args: string[], environment: Record<string, string | undefined> = {}): Promise<string> {
  const run = promisify(execFile);
  return run("bun", ["src/cli.ts", ...args], { cwd: process.cwd(), env: { ...process.env, ...environment } })
    .then(({ stdout, stderr }) => `${stdout}${stderr}`)
    .catch((error: { stdout?: string; stderr?: string }) => `${error.stdout ?? ""}${error.stderr ?? ""}`);
}
