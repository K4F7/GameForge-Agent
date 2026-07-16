import {
  assetProvenanceSchema,
  modelIdSchema,
  type AssetProvenance,
  type ImageGenerationProvider,
} from "@gameforge/contracts";
import { z } from "zod";

const DEFAULT_ENDPOINT = "https://ark.cn-beijing.volces.com/api/v3/images/generations";
const DEFAULT_MAX_OUTPUT_BYTES = 32 * 1024 * 1024;
const MAX_CONFIGURABLE_OUTPUT_BYTES = 64 * 1024 * 1024;
const TRUSTED_ENDPOINT_HOST = "ark.cn-beijing.volces.com";

const httpsUrlSchema = z
  .string()
  .trim()
  .url()
  .refine((value) => {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.username === "" &&
      url.password === "" &&
      (url.port === "" || url.port === "443")
    );
  }, "URL must use HTTPS without credentials or a custom port.");

export const seedreamImageRequestSchema = z.strictObject({
  assetId: z.string().trim().min(1).max(160),
  prompt: z.string().trim().min(1).max(4_000),
  size: z
    .string()
    .regex(/^(?:1K|2K|4K|[1-9]\d{2,4}x[1-9]\d{2,4})$/)
    .default("2K"),
  referenceImages: z.array(httpsUrlSchema).max(10).optional(),
  watermark: z.boolean().default(false),
});

const seedreamResponseSchema = z.object({
  model: z.string().trim().min(1),
  data: z
    .array(
      z.object({
        b64_json: z.string().min(1).optional(),
        size: z.string().min(1).optional(),
      }),
    )
    .min(1),
});

export type SeedreamImageRequest = z.input<typeof seedreamImageRequestSchema>;

export type SeedreamImageResult = {
  bytes: Uint8Array;
  mimeType: "image/jpeg" | "image/png" | "image/webp";
  provenance: AssetProvenance;
  size?: string;
};

export type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export type SeedreamProviderOptions = {
  apiKey: string;
  model: string;
  license: string;
  endpoint?: string;
  fetch?: FetchLike;
  allowedReferenceImageHosts?: ReadonlyArray<string>;
  maxOutputBytes?: number;
};

export class SeedreamProvider
  implements ImageGenerationProvider<SeedreamImageRequest, SeedreamImageResult>
{
  readonly id = "volcengine-ark";
  readonly capability = "image" as const;

  readonly #apiKey: string;
  readonly #allowedReferenceImageHosts: ReadonlySet<string>;
  readonly #endpoint: string;
  readonly #fetch: FetchLike;
  readonly #license: string;
  readonly #maxOutputBytes: number;
  readonly #model: string;

  constructor(options: SeedreamProviderOptions) {
    const apiKey = options.apiKey.trim();
    const license = options.license.trim();

    if (apiKey.length === 0) {
      throw new Error("Seedream API key is required at runtime.");
    }
    if (license.length === 0) {
      throw new Error("Seedream output license identifier is required.");
    }

    const endpoint = new URL(httpsUrlSchema.parse(options.endpoint ?? DEFAULT_ENDPOINT));
    if (
      endpoint.hostname !== TRUSTED_ENDPOINT_HOST ||
      endpoint.pathname !== "/api/v3/images/generations" ||
      endpoint.search !== "" ||
      endpoint.hash !== ""
    ) {
      throw new Error(`Seedream endpoint must use the official ${TRUSTED_ENDPOINT_HOST} image API.`);
    }

    const allowedReferenceImageHosts = new Set(
      (options.allowedReferenceImageHosts ?? []).map((host) => {
        const normalizedHost = host.trim().toLowerCase();
        if (!/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(normalizedHost)) {
          throw new Error(`Invalid reference image host: ${host}`);
        }
        return normalizedHost;
      }),
    );

    const maxOutputBytes = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
    if (
      !Number.isSafeInteger(maxOutputBytes) ||
      maxOutputBytes < 1 ||
      maxOutputBytes > MAX_CONFIGURABLE_OUTPUT_BYTES
    ) {
      throw new Error(
        `Seedream maxOutputBytes must be an integer between 1 and ${MAX_CONFIGURABLE_OUTPUT_BYTES}.`,
      );
    }

    this.#apiKey = apiKey;
    this.#allowedReferenceImageHosts = allowedReferenceImageHosts;
    this.#model = modelIdSchema.parse(options.model);
    this.#license = license;
    this.#endpoint = endpoint.href;
    this.#fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.#maxOutputBytes = maxOutputBytes;
  }

  async execute(request: SeedreamImageRequest): Promise<SeedreamImageResult> {
    const input = seedreamImageRequestSchema.parse(request);
    const requestBody: Record<string, unknown> = {
      model: this.#model,
      prompt: input.prompt,
      size: input.size,
      sequential_image_generation: "disabled",
      stream: false,
      response_format: "b64_json",
      watermark: input.watermark,
    };

    if (input.referenceImages !== undefined && input.referenceImages.length > 0) {
      for (const referenceImage of input.referenceImages) {
        const hostname = new URL(referenceImage).hostname.toLowerCase();
        if (!this.#allowedReferenceImageHosts.has(hostname)) {
          throw new Error(`Reference image host is not allowed: ${hostname}`);
        }
      }

      requestBody.image =
        input.referenceImages.length === 1
          ? input.referenceImages[0]
          : input.referenceImages;
    }

    const response = await this.#fetch(this.#endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.#apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      throw new Error(`Seedream request failed with HTTP ${response.status}.`);
    }

    const parsedResponse = seedreamResponseSchema.parse(await response.json());
    const firstImage = parsedResponse.data[0];
    if (firstImage?.b64_json === undefined) {
      throw new Error("Seedream response did not contain Base64 image data.");
    }

    const bytes = decodeBase64(firstImage.b64_json, this.#maxOutputBytes);
    const mimeType = detectImageMimeType(bytes);
    const provenance = assetProvenanceSchema.parse({
      assetId: input.assetId,
      kind: "image",
      origin: "generated",
      provider: this.id,
      model: parsedResponse.model,
      prompt: input.prompt,
      license: this.#license,
      sha256: await sha256(bytes),
    });

    return {
      bytes,
      mimeType,
      provenance,
      ...(firstImage.size === undefined ? {} : { size: firstImage.size }),
    };
  }
}

function decodeBase64(value: string, maxOutputBytes: number): Uint8Array {
  const maxBase64Characters = Math.ceil(maxOutputBytes / 3) * 4;
  if (
    value.length > maxBase64Characters ||
    value.length % 4 !== 0 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)
  ) {
    throw new Error("Seedream response contained invalid or oversized Base64 image data.");
  }

  let binary: string;
  try {
    binary = atob(value);
  } catch {
    throw new Error("Seedream response contained invalid Base64 image data.");
  }

  if (binary.length === 0 || binary.length > maxOutputBytes) {
    throw new Error("Seedream response contained empty or oversized image data.");
  }

  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function detectImageMimeType(
  bytes: Uint8Array,
): "image/jpeg" | "image/png" | "image/webp" {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "image/png";
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "image/webp";
  }

  throw new Error("Seedream response contained an unsupported image format.");
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digestInput = new Uint8Array(bytes.byteLength);
  digestInput.set(bytes);
  const digest = await crypto.subtle.digest("SHA-256", digestInput.buffer);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}
