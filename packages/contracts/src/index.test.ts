import { describe, expect, it } from "vitest";
import { orderCollectTelemetrySchema, validateGameSpec } from "./index.js";
import orderCollectFixture from "./fixtures/order-collect.v1.json" with { type: "json" };

describe("validateGameSpec", () => {
  it("accepts supported locales while preserving legacy specifications", () => {
    const base = {
      title: "Safety Sprint",
      genre: "arcade" as const,
      objective: "Collect every safety item before time expires.",
      controls: ["Arrow keys"],
      winCondition: "Collect every item.",
      loseCondition: "Time expires.",
      targetDurationSeconds: 90,
    };
    expect(validateGameSpec(base).locale).toBeUndefined();
    expect(validateGameSpec({ ...base, locale: "en-US" }).locale).toBe("en-US");
    expect(() => validateGameSpec({ ...base, locale: "fr-FR" })).toThrow();
  });

  it("accepts a complete game specification", () => {
    const result = validateGameSpec({
      title: "Safety Sprint",
      genre: "arcade",
      objective: "Collect all safety equipment before the timer expires.",
      controls: ["Arrow keys to move", "Space to pause"],
      winCondition: "Collect five pieces of equipment.",
      loseCondition: "The timer reaches zero.",
      targetDurationSeconds: 90,
    });

    expect(result.title).toBe("Safety Sprint");
  });

  it("rejects an incomplete specification", () => {
    expect(() => validateGameSpec({ title: "Broken" })).toThrow();
  });

  it("accepts bounded gameplay tuning while preserving legacy specifications", () => {
    const base = {
      title: "Tuned Sprint",
      genre: "arcade" as const,
      objective: "Collect the requested targets before time expires.",
      controls: ["Arrow keys"],
      winCondition: "Collect every target.",
      loseCondition: "Lose all lives.",
      targetDurationSeconds: 90,
    };
    expect(validateGameSpec(base).gameplay).toBeUndefined();
    expect(validateGameSpec({
      ...base,
      gameplay: { collectibleCount: 2, hazardCount: 0, startingLives: 1, movementSpeed: 300 },
    }).gameplay).toEqual({ collectibleCount: 2, hazardCount: 0, startingLives: 1, movementSpeed: 300 });
    expect(() => validateGameSpec({
      ...base,
      gameplay: { collectibleCount: 11, hazardCount: 0, startingLives: 1, movementSpeed: 300 },
    })).toThrow();
  });

  it("accepts the versioned order-collect golden specification", () => {
    const result = validateGameSpec(orderCollectFixture);

    expect(result).toEqual(orderCollectFixture);
    expect(result.mechanicProfile).toBe("order-collect");
    expect(result.randomSeed).toBe(19016);
  });

  it("rejects incomplete or implicitly guessed order-collect specifications", () => {
    expect(() => validateGameSpec({
      ...orderCollectFixture,
      targetDurationSeconds: 90,
    })).toThrow(/75 second duration/);
    expect(() => validateGameSpec({
      ...orderCollectFixture,
      gameplay: { ...orderCollectFixture.gameplay, collectibleCount: 5 },
    })).toThrow(/requires 6 collectibles/);
    const { mechanicProfile: _profile, ...withoutProfile } = orderCollectFixture;
    expect(() => validateGameSpec(withoutProfile)).toThrow(/requires mechanicProfile/);
  });

  it("validates stable order-collect telemetry", () => {
    expect(orderCollectTelemetrySchema.parse({
      schemaVersion: "1.0",
      mechanicProfile: "order-collect",
      randomSeed: 19016,
      elapsedMs: 100,
      remainingMs: 74_900,
      score: 1,
      lives: 3,
      order: { collected: 1, total: 6, remainingIds: ["order-2", "order-3", "order-4", "order-5", "order-6"] },
      result: "running",
      endReason: null,
      player: { x: 270, y: 691.2 },
      collectibles: [{ id: "order-2", position: { x: 120, y: 240 } }],
      hazards: [{ id: "hazard-1", position: { x: 320, y: 400 } }],
    })).toMatchObject({ score: 1, order: { collected: 1 } });
  });
});
