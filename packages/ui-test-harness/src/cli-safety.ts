export function safeEvidenceSegment(value: string, optionName: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value) || value === "." || value === "..") {
    throw new Error(`${optionName} must be a safe path segment.`);
  }
  return value;
}

/**
 * The one loopback host set every URL policy below shares. Node's URL keeps
 * IPv6 hostnames bracketed, so "[::1]" is the parsed form. Each policy still
 * spells out its own protocol and component rules - those differ on purpose -
 * but the host set stays a single list so no form can be accepted by one entry
 * point and rejected by another.
 */
const LOOPBACK_HOSTS = ["localhost", "127.0.0.1", "[::1]"];

function isLoopback(url: URL): boolean { return LOOPBACK_HOSTS.includes(url.hostname); }

function hasCredentials(url: URL): boolean { return url.username !== "" || url.password !== ""; }

export function safeRelayUrl(input: string): string {
  const url = new URL(input);
  if (hasCredentials(url) || url.search || url.hash
    || (url.protocol !== "https:" && !(url.protocol === "http:" && isLoopback(url)))) {
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
  if (hasCredentials(url)) throw new Error(`${label} must not carry credentials.`);
  if (!isLoopback(url)) {
    throw new Error(`${label} must be a loopback URL for testenv port management; got host ${url.hostname}.`);
  }
  if (url.hostname !== "127.0.0.1" && url.hostname !== "localhost") {
    throw new Error(`${label} must use 127.0.0.1 or localhost because managed services bind IPv4 loopback.`);
  }
  if (url.protocol !== "http:") {
    throw new Error(`${label} must use plain HTTP for testenv port management; testenv:up serves plain HTTP only.`);
  }
  if (url.pathname !== "/" || url.search !== "" || url.hash !== "") {
    throw new Error(`${label} must use the root path without query or fragment for testenv port management.`);
  }
  const port = url.port === "" ? 80 : Number(url.port);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error(`${label} has an invalid port.`);
  return port;
}

export function safeCodeArtsServerUrl(input: string): string {
  const url = new URL(input);
  if (url.protocol !== "http:" || !isLoopback(url) || hasCredentials(url) || url.search || url.hash) {
    throw new Error("CodeArts server URL must use HTTP on loopback without credentials, query, or fragment.");
  }
  if (url.pathname !== "/") throw new Error("CodeArts server URL must use the root path.");
  return url.href;
}

export function safeOpenChamberUrl(input: string): string {
  const url = new URL(input);
  if (!["http:", "https:"].includes(url.protocol) || !isLoopback(url) || hasCredentials(url) || url.search !== "" || url.hash !== "") {
    throw new Error("OpenChamber URL must be credential-free loopback HTTP(S).");
  }
  return url.href;
}
