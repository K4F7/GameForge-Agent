import { describe, expect, it } from "vitest";
import { configuredPreviewOrigins, isAllowedPreviewUrl, previewFramePolicy, previewWindowRel, safePreviewUrl, workbenchCsp } from "./preview-security.js";

describe("Workbench preview security", () => {
  it("allows loopback previews and explicit HTTPS origins only", () => {
    const origins = configuredPreviewOrigins("https://preview.example, https://preview.example");
    expect(origins).toEqual(["https://preview.example"]);
    expect(isAllowedPreviewUrl("http://127.0.0.1:5173/game", origins)).toBe(true);
    expect(isAllowedPreviewUrl("https://preview.example/game", origins)).toBe(true);
    expect(isAllowedPreviewUrl("https://attacker.example/game", origins)).toBe(false);
    expect(isAllowedPreviewUrl("http://192.168.1.10:5173/", origins)).toBe(false);
  });

  it("falls back instead of rendering an unauthorized event URL", () => {
    expect(safePreviewUrl("https://attacker.example/", "http://localhost:5173/", []))
      .toBe("http://localhost:5173/");
    expect(() => safePreviewUrl(undefined, "https://unlisted.example/", [])).toThrow("fallback");
  });

  it("rejects malformed remote origin configuration", () => {
    expect(() => configuredPreviewOrigins("http://preview.example")).toThrow("HTTPS");
    expect(() => configuredPreviewOrigins("https://preview.example/path")).toThrow("paths");
  });

  it("builds a narrow CSP without wildcard remote frames or privileged APIs", () => {
    const csp = workbenchCsp({ previewOrigins: ["https://preview.example"], relayUrl: "https://relay.example/api/" });
    expect(csp).toContain("frame-src http://127.0.0.1:* http://localhost:* https://preview.example");
    expect(csp).toContain("connect-src 'self'");
    expect(csp).toContain("https://relay.example");
    expect(csp).not.toContain("frame-src *");
    expect(csp).toContain("object-src 'none'");
    expect(csp).not.toContain("unsafe-inline");
    const devCsp = workbenchCsp({ previewOrigins: [], allowDevScripts: true, allowDevStyles: true });
    expect(devCsp).toContain("script-src 'self' 'unsafe-inline'");
    expect(devCsp).toContain("style-src 'self' 'unsafe-inline'");
  });

  it("keeps the iframe opaque and denies fullscreen and navigation capabilities", () => {
    expect(previewFramePolicy).toEqual({ sandbox: "allow-scripts allow-pointer-lock", referrerPolicy: "no-referrer" });
    expect(previewFramePolicy.sandbox).not.toContain("allow-same-origin");
    expect(previewFramePolicy.sandbox).not.toContain("allow-top-navigation");
    expect(previewFramePolicy.sandbox).not.toContain("allow-popups");
    expect(previewWindowRel).toBe("noopener noreferrer");
  });
});
