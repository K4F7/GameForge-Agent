import { describe, expect, it } from "vitest";
import { createMapView, createSceneNodes } from "./design-view.js";

const spec = {
  title: "Safety Sprint",
  genre: "arcade" as const,
  objective: "Collect all safety equipment before time expires.",
  controls: ["Arrow keys", "Space"],
  winCondition: "Collect every item and reach the exit.",
  loseCondition: "Time expires or lives reach zero.",
  targetDurationSeconds: 90,
};

describe("design view", () => {
  it("derives the scene tree only from validated spec and assets", () => {
    const nodes = createSceneNodes(spec, [{
      assetId: "sprites/player",
      kind: "image",
      role: "player",
      path: "assets/player.png",
      mimeType: "image/png",
      bytes: 128,
      sha256: "a".repeat(64),
      provenance: {
        assetId: "sprites/player",
        kind: "image",
        origin: "generated",
        provider: "seedream",
        model: "seedream-4-0",
        prompt: "A player sprite",
        license: "test",
        sha256: "a".repeat(64),
      },
    }]);

    expect(nodes[0]).toMatchObject({ label: "Safety SprintScene", detail: "arcade" });
    expect(nodes.find((node) => node.id === "asset:player")).toMatchObject({ detail: "sprites/player", state: "bound" });
    expect(nodes.find((node) => node.id === "asset:hazard")).toMatchObject({ detail: "程序化/静音回退", state: "fallback" });
    expect(nodes.find((node) => node.id === "controls")?.detail).toBe("Arrow keys · Space");
  });

  it.each(["arcade", "platformer", "puzzle", "shooter", "strategy"] as const)(
    "creates a bounded deterministic %s layout",
    (genre) => {
      const view = createMapView({ ...spec, genre });
      expect(view.cells.filter((cell) => cell.kind === "floor")).toHaveLength(66);
      expect(view.cells.some((cell) => cell.kind === "player")).toBe(true);
      expect(view.cells.some((cell) => cell.kind === "goal")).toBe(true);
      expect(view.cells.every((cell) => cell.column < view.columns && cell.row < view.rows)).toBe(true);
    },
  );

  it("reflects tuned target and hazard counts in scene and map projections", () => {
    const tuned = {
      ...spec,
      gameplay: { collectibleCount: 2, hazardCount: 0, startingLives: 1, movementSpeed: 300 },
    };
    const nodes = createSceneNodes(tuned, []);
    expect(nodes.find((node) => node.id === "systems")?.detail).toContain("2 目标 · 0 危险 · 1 生命");
    expect(nodes.find((node) => node.id === "movement")?.detail).toBe("300 px/s");
    const view = createMapView(tuned);
    expect(view.cells.filter((cell) => cell.kind === "collectible")).toHaveLength(2);
    expect(view.cells.filter((cell) => cell.kind === "hazard")).toHaveLength(0);
  });
});
