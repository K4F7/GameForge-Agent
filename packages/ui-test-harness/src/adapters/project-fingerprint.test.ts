import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { projectFingerprint } from "./project-fingerprint.js";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

describe("managed project fingerprint", () => {
  it("changes when a nested project file changes", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "gameforge-fingerprint-")); roots.push(root);
    await mkdir(path.join(root, "src"));
    await writeFile(path.join(root, "src", "game.ts"), "first");
    const before = await projectFingerprint(root);
    await writeFile(path.join(root, "src", "game.ts"), "second version");
    expect(await projectFingerprint(root)).not.toBe(before);
  });
});
