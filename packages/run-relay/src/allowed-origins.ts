const loopbackHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);

export function parseRelayAllowedOrigins(value: string | undefined): ReadonlyArray<string> | undefined {
  if (value === undefined) return undefined;
  const inputs = value.split(",").map((item) => item.trim()).filter((item) => item.length > 0);
  if (inputs.length === 0) throw new Error("GAMEFORGE_RUN_RELAY_ALLOWED_ORIGINS must contain at least one origin.");
  return [...new Set(inputs.map(normalizeOrigin))];
}

function normalizeOrigin(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("GAMEFORGE_RUN_RELAY_ALLOWED_ORIGINS contains an invalid URL.");
  }
  if (url.username || url.password || url.search || url.hash || (url.pathname !== "" && url.pathname !== "/")) {
    throw new Error("Relay allowed origins must not contain credentials, paths, queries, or fragments.");
  }
  const secure = url.protocol === "https:";
  const loopback = url.protocol === "http:" && loopbackHosts.has(url.hostname);
  if (!secure && !loopback) {
    throw new Error("Relay allowed origins must use HTTPS or loopback HTTP.");
  }
  return url.origin;
}
