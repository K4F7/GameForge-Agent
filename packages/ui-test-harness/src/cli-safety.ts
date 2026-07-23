export function safeEvidenceSegment(value: string, optionName: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value) || value === "." || value === "..") {
    throw new Error(`${optionName} must be a safe path segment.`);
  }
  return value;
}

export function safeRelayUrl(input: string): string {
  const url = new URL(input);
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.username || url.password || url.search || url.hash
    || (url.protocol !== "https:" && !(url.protocol === "http:" && loopback))) {
    throw new Error("Relay URL must use HTTPS, or HTTP on loopback, without credentials, query, or fragment.");
  }
  if (!url.pathname.endsWith("/")) url.pathname += "/";
  return url.href;
}
