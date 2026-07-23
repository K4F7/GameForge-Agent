import { browserLaunchOptions } from "./browser-launch.js";

export function xtermWindowLaunchOptions(channel?: string) {
  return browserLaunchOptions(false, channel);
}
