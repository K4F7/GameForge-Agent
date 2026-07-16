import { runIdSchema } from "@gameforge/contracts";

export function createWorkbenchRunId(
  now = Date.now(),
  randomId: string = globalThis.crypto.randomUUID(),
): string {
  if (!Number.isSafeInteger(now) || now < 0) throw new Error("Run ID time must be a nonnegative safe integer.");
  const entropy = randomId.replaceAll(/[^A-Za-z0-9]/g, "").slice(0, 12).toLowerCase();
  if (entropy.length < 8) throw new Error("Run ID entropy must contain at least eight alphanumeric characters.");
  return runIdSchema.parse(`run-${now.toString(36)}-${entropy}`);
}
