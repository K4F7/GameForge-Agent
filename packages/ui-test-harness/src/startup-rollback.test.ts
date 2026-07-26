import { describe, expect, it } from "vitest";
import { rollbackStartupFailure } from "./startup-rollback.js";

describe("rollbackStartupFailure", () => {
  it("preserves both startup and resident cleanup failures", async () => {
    await expect(rollbackStartupFailure(new Error("OpenChamber registration failed"), async () => {
      throw new Error("authority-relay port was not released");
    })).rejects.toThrow(/OpenChamber registration failed.*rollback failed.*port was not released/);
  });
});
