import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { projectFingerprint } from "./adapters/project-fingerprint.js";
import { parseCliArguments } from "./cli-options.js";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

describe("UI harness CLI project root", () => {
  test.each([
    ["unset", {}],
    ["blank", { GAMEFORGE_PROJECT_OUTPUT_ROOT: "   " }],
  ])("uses the CodeArts managed-project default when the override is %s", async (_label, environment) => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "gameforge-cli-options-")); roots.push(repoRoot);
    const options = parseCliArguments(["--headless"], repoRoot, environment);
    const expectedRoot = path.join(repoRoot, ".gameforge-validation", "integrations", "projects");

    expect(options.projectsRoot).toBe(expectedRoot);
    await expect(projectFingerprint(path.join(options.projectsRoot, "not-created"))).resolves.toMatch(/^[a-f0-9]{64}$/);
  });

  test("uses the CodeArts output-root override", () => {
    const outputRoot = path.resolve("custom-managed-projects");
    const options = parseCliArguments(["--headless"], path.resolve("repo"), { GAMEFORGE_PROJECT_OUTPUT_ROOT: outputRoot });

    expect(options.projectsRoot).toBe(outputRoot);
  });
});
