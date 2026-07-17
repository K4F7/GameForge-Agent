import { describe, expect, it } from "vitest";
import { classifyBrowserDoctorError } from "./browser-doctor-core.js";

describe("browser doctor error classification", () => {
  it("returns stable messages without local paths", () => {
    expect(classifyBrowserDoctorError(new Error("Failed to launch C:\\Users\\name\\chrome.exe")))
      .toEqual({ code: "launch", message: "Chrome could not be launched by Playwright." });
    expect(classifyBrowserDoctorError(new Error("Configured Chrome executable must be an accessible regular file.")))
      .toEqual({ code: "executable", message: "The configured Chrome executable is unavailable." });
  });
});
