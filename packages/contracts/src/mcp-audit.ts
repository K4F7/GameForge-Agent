import { z } from "zod";

export const mcpToolAuditOutcomeSchema = z.enum(["success", "error"]);
export const mcpToolAuditCallSchema = z.strictObject({
  sequence: z.number().int().positive(),
  tool: z.string().min(1).max(120).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/),
  startedAt: z.string().datetime({ offset: true }),
  durationMs: z.number().int().nonnegative().max(86_400_000),
  outcome: mcpToolAuditOutcomeSchema,
});

export const mcpToolAuditSchema = z.strictObject({
  schemaVersion: z.literal(1),
  sessionId: z.string().uuid(),
  startedAt: z.string().datetime({ offset: true }),
  truncated: z.boolean(),
  calls: z.array(mcpToolAuditCallSchema).max(10_000),
}).superRefine((audit, context) => {
  audit.calls.forEach((call, index) => {
    if (call.sequence !== index + 1) {
      context.addIssue({ code: "custom", path: ["calls", index, "sequence"], message: "Audit call sequence must be contiguous." });
    }
  });
});

export type McpToolAudit = z.infer<typeof mcpToolAuditSchema>;
export type McpToolAuditCall = z.infer<typeof mcpToolAuditCallSchema>;
