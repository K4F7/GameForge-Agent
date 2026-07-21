import { z } from "zod";

export const orderCollectMechanicProfileSchema = z.literal("order-collect");
export const orderCollectThemeSchema = z.enum(["garden", "restaurant", "department-store"]);
export const orderCollectInputActionSchema = z.enum([
  "move-pointer",
  "move-left",
  "move-right",
  "move-up",
  "move-down",
  "restart",
]);

export const orderCollectGameplaySchema = z.strictObject({
  collectibleCount: z.literal(6),
  hazardCount: z.literal(3),
  startingLives: z.literal(3),
  movementSpeed: z.number().int().min(100).max(360),
});

export const simulationPointSchema = z.strictObject({ x: z.number().finite(), y: z.number().finite() });
export const simulationEntitySchema = z.strictObject({
  id: z.string().regex(/^(?:order-[1-6]|hazard-[1-3])$/),
  position: simulationPointSchema,
});
export const orderCollectTelemetrySchema = z.strictObject({
  schemaVersion: z.literal("1.0"),
  mechanicProfile: orderCollectMechanicProfileSchema,
  randomSeed: z.number().int().min(0).max(0xffffffff),
  elapsedMs: z.number().nonnegative(),
  remainingMs: z.number().nonnegative(),
  score: z.number().int().min(0).max(6),
  lives: z.number().int().min(0).max(3),
  order: z.strictObject({
    collected: z.number().int().min(0).max(6),
    total: z.literal(6),
    remainingIds: z.array(z.string().regex(/^order-[1-6]$/)).max(6),
  }),
  result: z.enum(["running", "won", "lost"]),
  endReason: z.enum(["orders-complete", "time-expired", "lives-depleted"]).nullable(),
  player: simulationPointSchema,
  collectibles: z.array(simulationEntitySchema).max(6),
  hazards: z.array(simulationEntitySchema).max(3),
});

export const gameSpecSchema = z.strictObject({
  specVersion: z.literal("1.0").optional(),
  title: z.string().trim().min(1).max(80),
  locale: z.enum(["zh-CN", "en-US"]).optional(),
  genre: z.enum(["arcade", "platformer", "puzzle", "shooter", "strategy"]),
  mechanicProfile: orderCollectMechanicProfileSchema.optional(),
  theme: orderCollectThemeSchema.optional(),
  randomSeed: z.number().int().min(0).max(0xffffffff).optional(),
  inputActions: z.array(orderCollectInputActionSchema).min(1).max(6).optional(),
  objective: z.string().trim().min(10).max(500),
  controls: z.array(z.string().trim().min(1)).min(1).max(12),
  winCondition: z.string().trim().min(5).max(300),
  loseCondition: z.string().trim().min(5).max(300),
  targetDurationSeconds: z.number().int().min(30).max(1800),
  gameplay: z.strictObject({
    collectibleCount: z.number().int().min(1).max(10),
    hazardCount: z.number().int().min(0).max(6),
    startingLives: z.number().int().min(1).max(9),
    movementSpeed: z.number().int().min(100).max(360),
  }).optional(),
}).superRefine((spec, context) => {
  if (spec.mechanicProfile === undefined) {
    for (const field of ["specVersion", "theme", "randomSeed", "inputActions"] as const) {
      if (spec[field] !== undefined) {
        context.addIssue({
          code: "custom",
          path: [field],
          message: `${field} requires mechanicProfile=order-collect.`,
        });
      }
    }
    return;
  }

  const required = ["specVersion", "theme", "randomSeed", "inputActions", "gameplay"] as const;
  for (const field of required) {
    if (spec[field] === undefined) {
      context.addIssue({ code: "custom", path: [field], message: `${field} is required for order-collect.` });
    }
  }
  if (spec.genre !== "arcade") {
    context.addIssue({ code: "custom", path: ["genre"], message: "order-collect requires genre=arcade." });
  }
  if (spec.targetDurationSeconds !== 75) {
    context.addIssue({
      code: "custom",
      path: ["targetDurationSeconds"],
      message: "order-collect requires a 75 second duration.",
    });
  }
  if (spec.gameplay !== undefined) {
    const result = orderCollectGameplaySchema.safeParse(spec.gameplay);
    if (!result.success) {
      context.addIssue({
        code: "custom",
        path: ["gameplay"],
        message: "order-collect requires 6 collectibles, 3 hazards, and 3 starting lives.",
      });
    }
  }
  const actions = spec.inputActions ?? [];
  if (!actions.includes("move-pointer") || !actions.includes("restart")) {
    context.addIssue({
      code: "custom",
      path: ["inputActions"],
      message: "order-collect requires move-pointer and restart actions.",
    });
  }
});

export type GameSpec = z.infer<typeof gameSpecSchema>;
export type OrderCollectTelemetry = z.infer<typeof orderCollectTelemetrySchema>;

export function validateGameSpec(input: unknown): GameSpec {
  return gameSpecSchema.parse(input);
}
