import { describe, expect, it } from "vitest";
import { xtermWindowLaunchOptions } from "./xterm-window-launch.js";

describe("xtermWindowLaunchOptions", () => {
  it("uses installed Chrome for the headed xterm observer by default", () => {
    expect(xtermWindowLaunchOptions()).toEqual({
      headless: false,
      channel: "chrome",
      timeout: 30_000,
    });
  });
});
