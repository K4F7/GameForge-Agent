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

/**
 * testenv up/down manage LOCAL plain-HTTP listeners. The port may only come
 * from a credential-free plain-HTTP loopback URL: a remote host must never
 * cause a local service to start or die on its port, and an HTTPS URL would
 * report ready while every probe hits TLS failures on the plain listener.
 */
export function loopbackHttpPort(input: string, label: string): number {
  const url = new URL(input);
  if (url.username !== "" || url.password !== "") throw new Error(`${label} must not carry credentials.`);
  if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
    throw new Error(`${label} must be a loopback URL for testenv port management; got host ${url.hostname}.`);
  }
  if (url.protocol !== "http:") {
    throw new Error(`${label} must use plain HTTP for testenv port management; testenv:up serves plain HTTP only.`);
  }
  const port = url.port === "" ? 80 : Number(url.port);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error(`${label} has an invalid port.`);
  return port;
}

export function safeCodeArtsServerUrl(input: string): string {
  const url = new URL(input);
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "http:" || !loopback || url.username || url.password || url.search || url.hash) {
    throw new Error("CodeArts server URL must use HTTP on loopback without credentials, query, or fragment.");
  }
  if (!url.pathname.endsWith("/")) url.pathname += "/";
  return url.href;
}
