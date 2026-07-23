import { describe, expect, test } from "vitest";
import { safeEvidenceSegment, safeRelayUrl } from "./cli-safety.js";

describe("UI harness CLI safety", () => {
  test.each(["../outside", "..\\outside", "nested/path", "nested\\path", ".", "..", ""])
    ("rejects an unsafe evidence path segment: %j", (value) => {
      expect(() => safeEvidenceSegment(value, "--experiment")).toThrow(/safe path segment/i);
    });

  test.each(["http://example.com:8787/", "http://user:secret@127.0.0.1:8787/"])
    ("rejects an unsafe relay URL before credentials can be sent: %s", (value) => {
      expect(() => safeRelayUrl(value)).toThrow(/relay url/i);
    });

  test("accepts loopback HTTP and remote HTTPS relay URLs", () => {
    expect(safeRelayUrl("http://127.0.0.1:8787")).toBe("http://127.0.0.1:8787/");
    expect(safeRelayUrl("https://relay.example.com/api")).toBe("https://relay.example.com/api/");
  });
});
