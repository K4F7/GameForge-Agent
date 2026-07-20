import { describe, expect, it } from "vitest";
import { miniGameLocalHandoffManifestSchema } from "./minigame-handoff.js";

const manifest = {
  schemaVersion: "1.0",
  projectId: "safe-game",
  target: "douyin-mini-game",
  artifactRoot: "release/bytedancegame",
  engine: "layaair",
  engineVersion: "3.4.0",
  fileCount: 2,
  totalBytes: 30,
  files: [
    { path: "game.js", bytes: 10, sha256: "a".repeat(64) },
    { path: "game.json", bytes: 20, sha256: "b".repeat(64) },
  ],
  aggregateSha256: "c".repeat(64),
  remoteOperations: "forbidden",
  devToolVerification: "not-run",
} as const;

describe("mini-game local handoff manifest", () => {
  it("accepts a path-free, deterministically ordered local artifact manifest", () => {
    expect(miniGameLocalHandoffManifestSchema.parse(manifest)).toEqual(manifest);
    expect(JSON.stringify(manifest)).not.toMatch(/[A-Z]:[\\/]|\/Users\//);
  });

  it("rejects mismatched targets, totals, unsafe paths and non-local claims", () => {
    expect(miniGameLocalHandoffManifestSchema.safeParse({ ...manifest, artifactRoot: "release/wxgame" }).success).toBe(false);
    expect(miniGameLocalHandoffManifestSchema.safeParse({ ...manifest, fileCount: 3 }).success).toBe(false);
    expect(miniGameLocalHandoffManifestSchema.safeParse({ ...manifest, totalBytes: 31 }).success).toBe(false);
    expect(miniGameLocalHandoffManifestSchema.safeParse({
      ...manifest,
      files: [{ ...manifest.files[0], path: "../game.js" }, manifest.files[1]],
    }).success).toBe(false);
    expect(miniGameLocalHandoffManifestSchema.safeParse({ ...manifest, remoteOperations: "allowed" }).success).toBe(false);
    expect(miniGameLocalHandoffManifestSchema.safeParse({ ...manifest, devToolVerification: "passed" }).success).toBe(false);
  });

  it("rejects duplicate, unordered, oversized and malformed file entries", () => {
    const withFiles = (files: Array<{ path: string; bytes: number; sha256: string }>) => ({
      ...manifest,
      fileCount: files.length,
      totalBytes: files.reduce((total, file) => total + file.bytes, 0),
      files,
    });

    expect(miniGameLocalHandoffManifestSchema.safeParse(withFiles([
      { path: "GAME.JS", bytes: 10, sha256: "a".repeat(64) },
      { path: "game.js", bytes: 20, sha256: "b".repeat(64) },
    ])).success).toBe(false);
    expect(miniGameLocalHandoffManifestSchema.safeParse(withFiles([...manifest.files].reverse())).success).toBe(false);
    expect(miniGameLocalHandoffManifestSchema.safeParse(withFiles([
      { path: "game.js", bytes: 20 * 1024 * 1024 + 1, sha256: "a".repeat(64) },
    ])).success).toBe(false);
    expect(miniGameLocalHandoffManifestSchema.safeParse(withFiles([
      { path: "game.js", bytes: 1, sha256: "not-a-sha256" },
    ])).success).toBe(false);
  });
});
