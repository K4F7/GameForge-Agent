import { z } from "zod";
import { candidateContentFileSchema } from "./project-generation.js";

const bundleSizeSchema = z.strictObject({
  raw: z.number().int().nonnegative(),
  gzip: z.number().int().nonnegative(),
});

export const bundleMetricsSchema = z.strictObject({
  initial: bundleSizeSchema,
  async: bundleSizeSchema,
  total: bundleSizeSchema,
  files: z.array(z.strictObject({
    path: candidateContentFileSchema.shape.path,
    phase: z.enum(["initial", "async"]),
    raw: z.number().int().nonnegative(),
    gzip: z.number().int().nonnegative(),
  })).max(4_096),
}).superRefine((metrics, context) => {
  const sum = (phase?: "initial" | "async") => metrics.files
    .filter((file) => phase === undefined || file.phase === phase)
    .reduce((total, file) => ({ raw: total.raw + file.raw, gzip: total.gzip + file.gzip }), { raw: 0, gzip: 0 });
  const expected = { initial: sum("initial"), async: sum("async"), total: sum() };
  for (const section of ["initial", "async", "total"] as const) {
    for (const size of ["raw", "gzip"] as const) {
      if (metrics[section][size] !== expected[section][size]) {
        context.addIssue({
          code: "custom",
          path: [section, size],
          message: `Bundle ${section} ${size} must equal its file measurements.`,
        });
      }
    }
  }
});

export const bundleLimitsSchema = z.strictObject({
  initialRaw: z.number().int().nonnegative(),
  initialGzip: z.number().int().nonnegative(),
  asyncRaw: z.number().int().nonnegative(),
  asyncGzip: z.number().int().nonnegative(),
  totalRaw: z.number().int().nonnegative(),
  totalGzip: z.number().int().nonnegative(),
});

export const webGameBundleLimits = Object.freeze(bundleLimitsSchema.parse({
  initialRaw: 10_000,
  initialGzip: 5_000,
  asyncRaw: 1_450_000,
  asyncGzip: 380_000,
  totalRaw: 1_460_000,
  totalGzip: 385_000,
}));

export const bundleBudgetReportSchema = z.strictObject({
  metrics: bundleMetricsSchema,
  limits: bundleLimitsSchema,
  issues: z.array(z.string().trim().min(1).max(1_000)).max(100),
});

export type BundleMetrics = z.infer<typeof bundleMetricsSchema>;
export type BundleLimits = z.infer<typeof bundleLimitsSchema>;
export type BundleBudgetReport = z.infer<typeof bundleBudgetReportSchema>;

export function bundleBudgetIssues(metrics: BundleMetrics, limits: BundleLimits): string[] {
  const pairs: Array<[string, number, number]> = [
    ["initial raw", metrics.initial.raw, limits.initialRaw],
    ["initial gzip", metrics.initial.gzip, limits.initialGzip],
    ["async raw", metrics.async.raw, limits.asyncRaw],
    ["async gzip", metrics.async.gzip, limits.asyncGzip],
    ["total raw", metrics.total.raw, limits.totalRaw],
    ["total gzip", metrics.total.gzip, limits.totalGzip],
  ];
  return pairs.filter(([, actual, limit]) => actual > limit)
    .map(([name, actual, limit]) => `${name}: ${actual} > ${limit}`);
}
