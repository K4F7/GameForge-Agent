import { z } from "zod";
import { providerIdSchema, modelIdSchema } from "./providers.js";

export const assetIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(160)
  .regex(
    /^[a-z0-9][a-z0-9._-]*(?:\/[a-z0-9][a-z0-9._-]*)*$/,
    "Asset ID must be a normalized lowercase logical path.",
  );

const httpsUrlSchema = z
  .string()
  .trim()
  .url()
  .refine((value) => new URL(value).protocol === "https:", "Asset source URL must use HTTPS.");

export const assetKindSchema = z.enum(["image", "voice", "sound", "music"]);
export const assetOriginSchema = z.enum(["generated", "retrieved", "procedural"]);

export const assetProvenanceSchema = z
  .strictObject({
    assetId: assetIdSchema,
    kind: assetKindSchema,
    origin: assetOriginSchema,
    provider: providerIdSchema,
    model: modelIdSchema.optional(),
    prompt: z.string().trim().min(1).max(4_000).optional(),
    sourceUrl: httpsUrlSchema.optional(),
    license: z.string().trim().min(1).max(256),
    attribution: z.string().trim().min(1).max(1_000).optional(),
    sha256: z.string().regex(/^[a-f0-9]{64}$/, "SHA-256 must contain 64 lowercase hexadecimal characters."),
  })
  .superRefine((asset, context) => {
    if (asset.origin === "generated") {
      if (asset.model === undefined) {
        context.addIssue({
          code: "custom",
          path: ["model"],
          message: "Generated assets must record the model ID.",
        });
      }

      if (asset.prompt === undefined) {
        context.addIssue({
          code: "custom",
          path: ["prompt"],
          message: "Generated assets must record the prompt or source text.",
        });
      }
    }

    if (asset.origin === "retrieved" && asset.sourceUrl === undefined) {
      context.addIssue({
        code: "custom",
        path: ["sourceUrl"],
        message: "Retrieved assets must record an HTTPS source URL.",
      });
    }
  });

export type AssetProvenance = z.infer<typeof assetProvenanceSchema>;

export const assetManifestSchema = z
  .strictObject({
    schemaVersion: z.literal("1.0"),
    projectId: z
      .string()
      .trim()
      .min(1)
      .max(80)
      .regex(/^[a-z0-9][a-z0-9._-]*$/, "Project ID contains unsupported characters."),
    generatedAt: z.string().datetime({ offset: true }),
    assets: z.array(assetProvenanceSchema).max(1_000),
  })
  .superRefine((manifest, context) => {
    const seenAssetIds = new Set<string>();

    manifest.assets.forEach((asset, index) => {
      if (seenAssetIds.has(asset.assetId)) {
        context.addIssue({
          code: "custom",
          path: ["assets", index, "assetId"],
          message: `Duplicate asset ID: ${asset.assetId}`,
        });
      }

      seenAssetIds.add(asset.assetId);
    });
  });

export type AssetManifest = z.infer<typeof assetManifestSchema>;

export function validateAssetManifest(input: unknown): AssetManifest {
  return assetManifestSchema.parse(input);
}
