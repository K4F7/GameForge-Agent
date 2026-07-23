import { describe, expect, it } from "vitest";
import { isolatedOpenCodeEnvironment } from "./environment.js";

describe("OpenCode launch environment", () => {
  it("overrides a shared XDG data directory with the integration runtime", () => {
    expect(isolatedOpenCodeEnvironment({ XDG_DATA_HOME: "C:/shared" }, "C:/isolated").XDG_DATA_HOME).toBe("C:/isolated");
  });
});
