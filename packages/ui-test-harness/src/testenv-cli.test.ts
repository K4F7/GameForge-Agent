import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

describe("testenv CLI", () => {
  it("rejects unknown startup options before touching resident services", () => {
    const result = spawnSync("bun", [fileURLToPath(new URL("./testenv-cli.ts", import.meta.url)), "up", "--codearts-servre-url", "http://127.0.0.1:4097/"], {
      encoding: "utf8",
      timeout: 5_000,
      windowsHide: true,
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Unknown testenv option: --codearts-servre-url");
  });
});
