import { z } from "zod";
import { projectIdSchema } from "./project-generation.js";

const MAX_ARTIFACT_BYTES = 20 * 1024 * 1024;
const MAX_ARTIFACT_FILES = 4_096;

export const miniGameArtifactSha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
export const miniGameRemoteOperationsSchema = z.literal("forbidden");
export const miniGameDevToolVerificationSchema = z.literal("not-run");

export const miniGameHandoffFilePathSchema = z.string().min(1).max(512).superRefine((value, context) => {
  if (value !== value.normalize("NFC") || value.includes("\\") || /[\0-\x1f\x7f:*?"<>|]/.test(value)) {
    context.addIssue({ code: "custom", message: "Artifact file path must use normalized portable characters." });
    return;
  }
  if (value.startsWith("/") || value.endsWith("/") || value.split("/").some((segment) => segment === "" || segment === "." || segment === "..")) {
    context.addIssue({ code: "custom", message: "Artifact file path must be normalized and relative." });
  }
});

export const miniGameHandoffFileSchema = z.strictObject({
  path: miniGameHandoffFilePathSchema,
  bytes: z.number().int().nonnegative().max(MAX_ARTIFACT_BYTES),
  sha256: miniGameArtifactSha256Schema,
});

export const miniGameLocalHandoffManifestSchema = z.strictObject({
  schemaVersion: z.literal("1.0"),
  projectId: projectIdSchema,
  target: z.enum(["douyin-mini-game", "wechat-mini-game"]),
  artifactRoot: z.enum(["release/bytedancegame", "release/wxgame"]),
  engine: z.literal("layaair"),
  engineVersion: z.literal("3.4.0"),
  fileCount: z.number().int().positive().max(MAX_ARTIFACT_FILES),
  totalBytes: z.number().int().nonnegative().max(MAX_ARTIFACT_BYTES),
  files: z.array(miniGameHandoffFileSchema).min(1).max(MAX_ARTIFACT_FILES),
  aggregateSha256: miniGameArtifactSha256Schema,
  remoteOperations: miniGameRemoteOperationsSchema,
  devToolVerification: miniGameDevToolVerificationSchema,
}).superRefine((manifest, context) => {
  const expectedRoot = manifest.target === "douyin-mini-game" ? "release/bytedancegame" : "release/wxgame";
  if (manifest.artifactRoot !== expectedRoot) {
    context.addIssue({ code: "custom", path: ["artifactRoot"], message: "Artifact root does not match the target." });
  }
  if (manifest.fileCount !== manifest.files.length) {
    context.addIssue({ code: "custom", path: ["fileCount"], message: "Artifact file count does not match the file list." });
  }
  const totalBytes = manifest.files.reduce((total, file) => total + file.bytes, 0);
  if (manifest.totalBytes !== totalBytes) {
    context.addIssue({ code: "custom", path: ["totalBytes"], message: "Artifact byte total does not match the file list." });
  }
  const paths = manifest.files.map((file) => file.path);
  if (new Set(paths.map((value) => value.toLowerCase())).size !== paths.length) {
    context.addIssue({ code: "custom", path: ["files"], message: "Artifact file paths must be case-insensitively unique." });
  }
  for (let index = 1; index < paths.length; index += 1) {
    if ((paths[index - 1] as string) >= (paths[index] as string)) {
      context.addIssue({ code: "custom", path: ["files", index, "path"], message: "Artifact files must use code-point path order." });
      break;
    }
  }
});

export type MiniGameHandoffFile = z.infer<typeof miniGameHandoffFileSchema>;
export type MiniGameLocalHandoffManifest = z.infer<typeof miniGameLocalHandoffManifestSchema>;
