import { describe, expect, it } from "vitest";
import { parseRelayAllowedOrigins } from "./allowed-origins.js";

describe("parseRelayAllowedOrigins", () => {
  it("keeps defaults when the environment override is absent", () => {
    expect(parseRelayAllowedOrigins(undefined)).toBeUndefined();
  });

  it("accepts and deduplicates HTTPS and loopback HTTP origins", () => {
    expect(parseRelayAllowedOrigins(
      "http://127.0.0.1:4177, https://client.example.com/, http://127.0.0.1:4177",
    )).toEqual(["http://127.0.0.1:4177", "https://client.example.com"]);
  });

  it.each([
    "http://example.com",
    "http://user:secret@127.0.0.1:4177",
    "http://127.0.0.1:4177/client",
    "http://127.0.0.1:4177?token=secret",
  ])("rejects unsafe origin %s", (value) => {
    expect(() => parseRelayAllowedOrigins(value)).toThrow();
  });
});
