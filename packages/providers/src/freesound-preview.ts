import { assetProvenanceSchema, type AssetProvenance } from "@gameforge/contracts";
import { z } from "zod";
import type { FreesoundFetchLike } from "./freesound.js";
import { fetchProvider, type ProviderRetryOptions } from "./transport.js";

const MAX_PREVIEW_BYTES = 16 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 30_000;

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
  readonly #retry: ProviderRetryOptions | undefined;
  readonly #timeoutMs: number;

  constructor(options: { fetch?: FreesoundFetchLike; timeoutMs?: number; retry?: ProviderRetryOptions } = {}) {
    this.#fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000) {
      throw new Error("Freesound preview timeoutMs must be an integer between 1 and 60000.");
    }
    this.#timeoutMs = timeoutMs;
    this.#retry = options.retry;
  }

  async execute(
    request: FreesoundPreviewRequest,
    classification: "sound" | "music" = "sound",
  ): Promise<FreesoundPreviewResult> {
    const input = freesoundPreviewRequestSchema.parse(request);
    const sourceUrl = officialUrl(input.sourceUrl, ["freesound.org"]);
    const previewUrl = officialUrl(input.previewUrl, ["freesound.org", "cdn.freesound.org"]);
    if (!previewUrl.pathname.includes("/previews/")) {
      throw new Error("Freesound preview URL must use an official previews path.");
    }

    const response = await fetchProvider({
      provider: "Freesound preview",
      fetch: this.#fetch,
      input: previewUrl,
      init: { method: "GET", redirect: "error" },
      timeoutMs: this.#timeoutMs,
      ...(this.#retry === undefined ? {} : { retry: this.#retry }),
    });
    const declaredLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > MAX_PREVIEW_BYTES) {
      if (response.body !== null) await response.body.cancel().catch(() => undefined);
      throw new Error("Freesound preview exceeds the byte limit.");
    }
    const bytes = await readBoundedBody(response, MAX_PREVIEW_BYTES);
    const mimeType = detectAudioMimeType(bytes);
    const license = `Freesound ${input.license}`;
    const attribution = `“${input.name}” by ${input.username} — ${input.license} — ${sourceUrl.href}`;
    const provenance = assetProvenanceSchema.parse({
      assetId: input.assetId,
      kind: classification,
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

async function readBoundedBody(response: Response, limit: number): Promise<Uint8Array> {
  if (response.body === null) throw new Error("Freesound preview is empty.");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  let completed = false;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        completed = true;
        break;
      }
      length += value.byteLength;
      if (length > limit) throw new Error("Freesound preview exceeds the byte limit.");
      chunks.push(value);
    }
  } finally {
    if (!completed) await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  if (length === 0) throw new Error("Freesound preview is empty.");
  const output = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}
