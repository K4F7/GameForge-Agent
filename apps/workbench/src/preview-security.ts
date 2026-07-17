import { gamePreviewUrlSchema } from "@gameforge/contracts";

const loopbackHosts = new Set(["localhost", "127.0.0.1"]);
export const previewFramePolicy = {
  sandbox: "allow-scripts allow-pointer-lock",
  referrerPolicy: "no-referrer" as const,
};
export const previewWindowRel = "noopener noreferrer";

export function configuredPreviewOrigins(value: string | undefined): string[] {
  if (value === undefined || value.trim().length === 0) return [];
  return [...new Set(value.split(",").map((item) => item.trim()).filter(Boolean).map((item) => {
    const url = new URL(item);
    if (url.username || url.password || url.search || url.hash || url.pathname !== "/") {
      throw new Error("Preview origins must not contain credentials, paths, query data, or fragments.");
    }
    if (url.protocol !== "https:") throw new Error("Remote preview origins must use HTTPS.");
    return url.origin;
  }))];
}

export function isAllowedPreviewUrl(value: string, remoteOrigins: readonly string[]): boolean {
  const parsed = gamePreviewUrlSchema.safeParse(value);
  if (!parsed.success) return false;
  const url = new URL(parsed.data);
  if (url.protocol === "http:" && loopbackHosts.has(url.hostname)) return true;
  return url.protocol === "https:" && remoteOrigins.includes(url.origin);
}

export function safePreviewUrl(candidate: string | undefined, fallback: string, remoteOrigins: readonly string[]): string {
  if (candidate !== undefined && isAllowedPreviewUrl(candidate, remoteOrigins)) return candidate;
  if (!isAllowedPreviewUrl(fallback, remoteOrigins)) throw new Error("Configured preview fallback is not allowed.");
  return fallback;
}

export function workbenchCsp(options: {
  previewOrigins: readonly string[];
  relayUrl?: string;
  allowDevScripts?: boolean;
  allowDevStyles?: boolean;
}): string {
  const frameSources = ["http://127.0.0.1:*", "http://localhost:*", ...options.previewOrigins];
  const connectSources = ["'self'", "http://127.0.0.1:*", "http://localhost:*"];
  if (options.relayUrl !== undefined && options.relayUrl.trim().length > 0) {
    const relay = new URL(options.relayUrl);
    if (relay.username || relay.password || relay.search || relay.hash) throw new Error("Relay URL is unsafe for CSP.");
    if (relay.protocol !== "https:" && !(relay.protocol === "http:" && loopbackHosts.has(relay.hostname))) {
      throw new Error("Relay URL must use HTTPS or loopback HTTP.");
    }
    connectSources.push(relay.origin);
  }
  return [
    "default-src 'self'",
    `script-src 'self'${options.allowDevScripts === true ? " 'unsafe-inline'" : ""}`,
    `style-src 'self'${options.allowDevStyles === true ? " 'unsafe-inline'" : ""}`,
    "img-src 'self' data: blob:",
    `connect-src ${[...new Set(connectSources)].join(" ")}`,
    `frame-src ${[...new Set(frameSources)].join(" ")}`,
    "object-src 'none'", "base-uri 'none'", "form-action 'none'",
  ].join("; ");
}
