export const MAX_BROWSER_DIAGNOSTIC_ENTRIES = 256;
export const MAX_BROWSER_DIAGNOSTIC_CHARACTERS = 4_096;

export function appendBoundedDiagnostic(target: string[], value: string): void {
  const bounded = value.slice(0, MAX_BROWSER_DIAGNOSTIC_CHARACTERS);
  if (target.length >= MAX_BROWSER_DIAGNOSTIC_ENTRIES) target.splice(0, target.length - MAX_BROWSER_DIAGNOSTIC_ENTRIES + 1);
  target.push(bounded);
}

export function isExpectedOptionalConfigRead404(message: string): boolean {
  if (!message.includes("status of 404") || !message.startsWith("Failed to load resource:")) return false;
  const match = message.match(/@ (https?:\/\/\S+):\d+:\d+$/);
  if (match?.[1] === undefined) return false;
  try {
    const url = new URL(match[1]);
    if (url.pathname !== "/api/fs/read") return false;
    const requestedPath = url.searchParams.get("path")?.replaceAll("\\", "/");
    return requestedPath !== undefined && (
      /\/\.config\/openchamber\/projects\/[^/]+\.json$/.test(requestedPath)
      || requestedPath.endsWith("/.openchamber/openchamber.json")
    );
  } catch {
    return false;
  }
}

export function isExpectedOptionalConfigRead404Response(url: string, status: number): boolean {
  if (status !== 404) return false;
  try {
    const parsed = new URL(url);
    if (parsed.pathname !== "/api/fs/read") return false;
    const requestedPath = parsed.searchParams.get("path")?.replaceAll("\\", "/");
    return requestedPath !== undefined && (
      /\/\.config\/openchamber\/projects\/[^/]+\.json$/.test(requestedPath)
      || requestedPath.endsWith("/.openchamber/openchamber.json")
    );
  } catch {
    return false;
  }
}
