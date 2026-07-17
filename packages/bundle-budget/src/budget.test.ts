import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { budgetIssues, classifyManifest, measureBundle, type ViteManifest } from "./budget.js";

const manifest: ViteManifest = {
  "index.html": { file: "assets/index.js", isEntry: true, dynamicImports: ["src/game.ts"] },
  "src/game.ts": { file: "assets/game.js" },
};

describe("bundle budget", () => {
  it("separates entry and dynamic chunks", () => {
    expect([...classifyManifest(manifest)]).toEqual([["index.html", "initial"], ["src/game.ts", "async"]]);
  });

  it("measures gzip bytes and reports exceeded limits", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "gameforge-bundle-"));
    await mkdir(path.join(root, "assets"));
    await writeFile(path.join(root, "assets", "index.js"), "entry");
    await writeFile(path.join(root, "assets", "game.js"), "game".repeat(100));
    const metrics = await measureBundle(root, manifest);
    expect(metrics.initial.raw).toBe(5);
    expect(metrics.async.raw).toBe(400);
    expect(budgetIssues(metrics, { initialRaw: 10, initialGzip: 100, asyncRaw: 399, asyncGzip: 1000, totalRaw: 1000, totalGzip: 1000 }))
      .toEqual(["async raw: 400 > 399"]);
  });

  it("counts imported CSS once and rejects paths outside dist", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "gameforge-bundle-css-"));
    await mkdir(path.join(root, "assets"));
    await writeFile(path.join(root, "assets", "index.js"), "entry");
    await writeFile(path.join(root, "assets", "style.css"), "body{}");
    const withCss: ViteManifest = {
      "index.html": { file: "assets/index.js", isEntry: true, css: ["assets/style.css", "assets/style.css"] },
    };
    expect((await measureBundle(root, withCss)).initial.raw).toBe(11);
    await expect(measureBundle(root, { "index.html": { file: "../outside.js", isEntry: true } }))
      .rejects.toThrow("escapes dist");
  });

  it("rejects missing chunks and manifests without an entry", () => {
    expect(() => classifyManifest({ "index.html": { file: "index.js", isEntry: true, imports: ["missing"] } }))
      .toThrow("missing chunk");
    expect(() => classifyManifest({ "src/game.ts": { file: "game.js" } })).toThrow("no entry");
  });
});
