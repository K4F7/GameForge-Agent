import { describe, expect, it } from "vitest";
import { classifyModelFailure, shouldFallback } from "./fallback.js";

describe("model fallback classification", () => {
  it.each(["HTTP 429", "Rate limit exceeded", "too many requests"])("accepts explicit rate limit: %s", (value) => {
    expect(classifyModelFailure(value)).toBe("rate-limit");
  });
  it.each(["insufficient_quota", "额度不足"])("accepts explicit quota exhaustion: %s", (value) => {
    expect(classifyModelFailure(value)).toBe("quota");
  });
  it.each(["Activity watchdog timed out", "Playwright timeout", "Relay request failed"])("rejects unrelated timeout: %s", (value) => {
    expect(shouldFallback(value)).toBe(false);
  });
});
