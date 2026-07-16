import { z } from "zod";
import { assetKindSchema, assetProvenanceSchema } from "./assets.js";
import { projectIdSchema } from "./project-generation.js";

export const runtimeAssetRoleSchema = z.enum([
  "player",
  "collectible",
  "hazard",
  "background",
  "collect-sound",
  "hit-sound",
  "voice",
  "bgm",
]);

export const runtimeAssetMimeTypeSchema = z.enum([
  "image/jpeg",
  "image/png",
  "image/webp",
  "audio/mpeg",
  "audio/ogg",
  "audio/wav",
]);

const publicAssetPathSchema = z
  .string()
  .regex(/^assets\/[a-z0-9][a-z0-9._-]*(?:\/[a-z0-9][a-z0-9._-]*)*$/);

export const runtimeAssetEntrySchema = z
  .strictObject({
    assetId: assetProvenanceSchema.shape.assetId,
    kind: assetKindSchema,
    role: runtimeAssetRoleSchema.optional(),
    path: publicAssetPathSchema,
    mimeType: runtimeAssetMimeTypeSchema,
    bytes: z.number().int().positive().max(64 * 1024 * 1024),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    provenance: assetProvenanceSchema,
  })
  .superRefine((entry, context) => {
    if (entry.assetId !== entry.provenance.assetId) {
      context.addIssue({ code: "custom", path: ["provenance", "assetId"], message: "Asset IDs must match." });
    }
    if (entry.kind !== entry.provenance.kind) {
      context.addIssue({ code: "custom", path: ["provenance", "kind"], message: "Asset kinds must match." });
    }
    if (entry.sha256 !== entry.provenance.sha256) {
      context.addIssue({ code: "custom", path: ["provenance", "sha256"], message: "Asset hashes must match." });
    }
  });

export const runtimeAssetManifestSchema = z
  .strictObject({
    schemaVersion: z.literal("1.0"),
    projectId: projectIdSchema,
    revision: z.number().int().nonnegative(),
    assets: z.array(runtimeAssetEntrySchema).max(1_000),
  })
  .superRefine((manifest, context) => {
    const ids = new Set<string>();
    const roles = new Set<string>();
    manifest.assets.forEach((asset, index) => {
      if (ids.has(asset.assetId)) {
        context.addIssue({ code: "custom", path: ["assets", index, "assetId"], message: "Asset ID must be unique." });
      }
      ids.add(asset.assetId);
      if (asset.role !== undefined && roles.has(asset.role)) {
        context.addIssue({ code: "custom", path: ["assets", index, "role"], message: "Runtime asset role must be unique." });
      }
      if (asset.role !== undefined) roles.add(asset.role);
    });
  });

export type RuntimeAssetRole = z.infer<typeof runtimeAssetRoleSchema>;
export type RuntimeAssetMimeType = z.infer<typeof runtimeAssetMimeTypeSchema>;
export type RuntimeAssetEntry = z.infer<typeof runtimeAssetEntrySchema>;
export type RuntimeAssetManifest = z.infer<typeof runtimeAssetManifestSchema>;
