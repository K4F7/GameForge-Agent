import { describe, expect, it } from "vitest";
import { browserLaunchOptions } from "./browser-launch.js";

describe("browser launch configuration", () => {
  it("uses installed Chrome when no channel is supplied", () => {
    expect(browserLaunchOptions(true)).toMatchObject({ headless: true, channel: "chrome", timeout: 30_000 });
  });

  it("preserves an explicitly selected installed-browser channel", () => {
    expect(browserLaunchOptions(false, "msedge")).toMatchObject({ headless: false, channel: "msedge", timeout: 30_000 });
  });
});
