export type FailureKind = "rate-limit" | "quota" | "other";

const rateLimitPatterns = [/\b429\b/i, /rate[ _-]?limit(?:ed| exceeded)?/i, /too many requests/i];
const quotaPatterns = [/\bquota\b/i, /insufficient[_ -]quota/i, /额度(?:不足|用尽|超限)/i];

export function classifyModelFailure(value: string): FailureKind {
  if (quotaPatterns.some((pattern) => pattern.test(value))) return "quota";
  if (rateLimitPatterns.some((pattern) => pattern.test(value))) return "rate-limit";
  return "other";
}

// A Task/Run is authoritative and non-idempotent. Classification is retained for
// diagnostics, but the harness must never start a second attempt for that Run.
export function shouldFallback(_value: string): boolean { return false; }
