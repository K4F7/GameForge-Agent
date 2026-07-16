import { assetProvenanceSchema, type AssetProvenance } from "@gameforge/contracts";
import { z } from "zod";
import type { FreesoundFetchLike } from "./freesound.js";

const MAX_PREVIEW_BYTES = 16 * 1024 * 1024;

export const freesoundPreviewRequestSchema = z.strictObject({
  assetId: z.string().trim().min(1).max(160),
  soundId: z.number().int().positive(),
  name: z.string().trim().min(1).max(300),
  username: z.string().trim().min(1).max(150),
  license: z.enum(["Creative Commons 0", "Attribution"]),
  sourceUrl: z.string().url(),
  previewUrl: z.string().url(),
});

export type FreesoundPreviewRequest = z.input<typeof freesoundPreviewRequestSchema>;
export type FreesoundPreviewResult = {
  bytes: Uint8Array;
  mimeType: "audio/mpeg" | "audio/ogg";
  provenance: AssetProvenance;
};

export class FreesoundPreviewProvider {
  readonly id = "freesound-preview";
  readonly capability = "sound-preview" as const;
  readonly #fetch: FreesoundFetchLike;

  constructor(options: { fetch?: FreesoundFetchLike } = {}) {
    this.#fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
  }

  async execute(request: FreesoundPreviewRequest): Promise<FreesoundPreviewResult> {
    const input = freesoundPreviewRequestSchema.parse(request);
    const sourceUrl = officialUrl(input.sourceUrl, ["freesound.org"]);
    const previewUrl = officialUrl(input.previewUrl, ["freesound.org", "cdn.freesound.org"]);
    if (!previewUrl.pathname.includes("/previews/")) {
      throw new Error("Freesound preview URL must use an official previews path.");
    }

    const response = await this.#fetch(previewUrl, { method: "GET", redirect: "error" });
    if (!response.ok) throw new Error(`Freesound preview request failed with HTTP ${response.status}.`);
    const declaredLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > MAX_PREVIEW_BYTES) {
      throw new Error("Freesound preview exceeds the byte limit.");
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_PREVIEW_BYTES) {
      throw new Error("Freesound preview is empty or exceeds the byte limit.");
    }
    const mimeType = detectAudioMimeType(bytes);
    const license = `Freesound ${input.license}`;
    const attribution = `“${input.name}” by ${input.username} — ${input.license} — ${sourceUrl.href}`;
    const provenance = assetProvenanceSchema.parse({
      assetId: input.assetId,
      kind: "sound",
      origin: "retrieved",
      provider: "freesound",
      sourceUrl: sourceUrl.href,
      license,
      attribution,
      sha256: await sha256(bytes),
    });
    return { bytes, mimeType, provenance };
  }
}

function officialUrl(value: string, hosts: ReadonlyArray<string>): URL {
  const url = new URL(value);
  if (
    url.protocol !== "https:" || url.username !== "" || url.password !== "" ||
    (url.port !== "" && url.port !== "443") || url.search !== "" || url.hash !== "" ||
    !hosts.includes(url.hostname.toLowerCase())
  ) {
    throw new Error("Freesound URL must use an official HTTPS host without credentials or parameters.");
  }
  return url;
}

function detectAudioMimeType(bytes: Uint8Array): "audio/mpeg" | "audio/ogg" {
  if (bytes.length >= 4 && String.fromCharCode(...bytes.slice(0, 4)) === "OggS") return "audio/ogg";
  if (
    bytes.length >= 3 &&
    (String.fromCharCode(...bytes.slice(0, 3)) === "ID3" ||
      (bytes[0] === 0xff && ((bytes[1] ?? 0) & 0xe0) === 0xe0))
  ) return "audio/mpeg";
  throw new Error("Freesound preview contained an unsupported audio format.");
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const digest = await crypto.subtle.digest("SHA-256", copy.buffer);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
