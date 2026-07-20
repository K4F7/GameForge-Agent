import { z } from "zod";

export const gameSpecSchema = z.strictObject({
  title: z.string().trim().min(1).max(80),
  locale: z.enum(["zh-CN", "en-US"]).optional(),
  genre: z.enum(["arcade", "platformer", "puzzle", "shooter", "strategy"]),
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
});

export type GameSpec = z.infer<typeof gameSpecSchema>;

export function validateGameSpec(input: unknown): GameSpec {
  return gameSpecSchema.parse(input);
}
