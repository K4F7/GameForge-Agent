import { describe, expect, test } from "vitest";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
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
    expect(() => loopbackHttpPort("http://127.0.0.1:8787/api", "Relay URL")).toThrow(/root path/i);
    expect(() => loopbackHttpPort("http://[::1]:8787/", "Relay URL")).toThrow(/127\.0\.0\.1|localhost/i);
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

  test("requires environment-provided CodeArts attach URL and session together", async () => {
    const output = await runCli(["--headed"], {
      GAMEFORGE_CODEARTS_SERVER_URL: "http://127.0.0.1:4097",
      GAMEFORGE_CODEARTS_SESSION: undefined,
    });
    expect(output).toContain("--codearts-server-url and --codearts-session must be provided together");
  });

  test("requires an external CodeArts session for acceptance before creating Evidence", async () => {
    const experiment = `missing-attach-${Date.now()}`;
    const output = await runCli(["--headed", "--tier", "acceptance", "--experiment", experiment], {
      GAMEFORGE_CODEARTS_SERVER_URL: undefined,
      GAMEFORGE_CODEARTS_SESSION: undefined,
    });
    expect(output).toContain("requires an external CodeArts server and session");
    expect(existsSync(path.resolve(process.cwd(), "../..", ".gameforge-validation", experiment))).toBe(false);
  });

  test("rejects an unknown option instead of silently running the acceptance tier", async () => {
    const output = await runCli(["--headless", "--tire", "readiness"]);
    expect(output).toContain("Unknown option: --tire");
  });

  test("rejects headless readiness before contacting Relay", async () => {
    const output = await runCli(["--headless", "--tier", "readiness"]);
    expect(output).toContain("readiness tier requires --headed");
  });

  test("rejects an existing task tuple for readiness before contacting Relay", async () => {
    const output = await runCli([
      "--headed", "--tier", "readiness",
      "--task-id", "task-1", "--run-id", "run-1", "--project-id", "project-1",
    ]);
    expect(output).toContain("readiness tier must create a fresh Authority task");
  });

  test("accepts zero to disable the headed failure hold", async () => {
    const output = await runCli(["--headed", "--failure-hold-ms", "0", "--relay-url", "http://127.0.0.1:1/"]);
    expect(output).not.toContain("Timeout values must be positive integers");
  });

  test("rejects an unsafe OpenChamber URL before creating Evidence", async () => {
    const experiment = `unsafe-openchamber-${Date.now()}`;
    const output = await runCli(["--headless", "--experiment", experiment, "--openchamber-url", "https://example.com:43163/"]);
    expect(output).toContain("OpenChamber URL must be credential-free loopback HTTP(S)");
    expect(existsSync(path.resolve(process.cwd(), "../..", ".gameforge-validation", experiment))).toBe(false);
  });
});

async function runCli(args: string[], environment: Record<string, string | undefined> = {}): Promise<string> {
  const run = promisify(execFile);
  return run("bun", ["src/cli.ts", ...args], { cwd: process.cwd(), env: { ...process.env, ...environment } })
    .then(({ stdout, stderr }) => `${stdout}${stderr}`)
    .catch((error: { stdout?: string; stderr?: string }) => `${error.stdout ?? ""}${error.stderr ?? ""}`);
}
