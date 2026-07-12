import { describe, expect, it } from "vitest";
import { validateGameSpec } from "./index.js";

describe("validateGameSpec", () => {
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
});
