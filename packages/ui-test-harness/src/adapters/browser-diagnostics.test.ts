import { describe, expect, it } from "vitest";
import { appendBoundedDiagnostic, MAX_BROWSER_DIAGNOSTIC_CHARACTERS, MAX_BROWSER_DIAGNOSTIC_ENTRIES } from "./browser-diagnostics.js";

describe("browser diagnostics", () => {
  it("bounds retained entries and each diagnostic message", () => {
    const values: string[] = [];
    for (let index = 0; index <= MAX_BROWSER_DIAGNOSTIC_ENTRIES; index += 1) {
      appendBoundedDiagnostic(values, `${index}:` + "x".repeat(MAX_BROWSER_DIAGNOSTIC_CHARACTERS + 10));
    }
    expect(values).toHaveLength(MAX_BROWSER_DIAGNOSTIC_ENTRIES);
    expect(values[0]).toMatch(/^1:/);
    expect(values.every((value) => value.length <= MAX_BROWSER_DIAGNOSTIC_CHARACTERS)).toBe(true);
  });
});
