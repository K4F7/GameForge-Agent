export function browserLaunchOptions(headless: boolean, channel?: string) {
  return { headless, channel: channel ?? "chrome", timeout: 30_000 };
}
