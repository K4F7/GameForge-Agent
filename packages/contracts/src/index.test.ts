import { describe, expect, it } from "vitest";
import { validateGameSpec } from "./index.js";

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
});
