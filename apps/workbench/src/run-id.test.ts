import { describe, expect, it } from "vitest";
import { createWorkbenchRunId } from "./run-id.js";

describe("createWorkbenchRunId", () => {
  it("creates a deterministic schema-safe ID from explicit inputs", () => {
    expect(createWorkbenchRunId(1_784_211_352_608, "12345678-90ab-cdef-1234-567890abcdef"))
      .toBe("run-mrnldelc-1234567890ab");
  });

  it("changes when either time or entropy changes and rejects weak entropy", () => {
    const first = createWorkbenchRunId(1, "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");
    expect(createWorkbenchRunId(2, "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee")).not.toBe(first);
    expect(createWorkbenchRunId(1, "ffffffff-bbbb-cccc-dddd-eeeeeeeeeeee")).not.toBe(first);
    expect(() => createWorkbenchRunId(1, "---")).toThrow("entropy");
  });
});
