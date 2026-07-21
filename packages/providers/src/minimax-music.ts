import {
  assetProvenanceSchema,
  type AssetProvenance,
  type AudioGenerationProvider,
} from "@gameforge/contracts";
import { z } from "zod";
import { fetchProvider } from "./transport.js";

const DEFAULT_ENDPOINT = "https://api.minimaxi.com/v1/music_generation";
const DEFAULT_MAX_OUTPUT_BYTES = 16 * 1024 * 1024;
const MAX_CONFIGURABLE_OUTPUT_BYTES = 16 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 5 * 60_000;
const MAX_TIMEOUT_MS = 10 * 60_000;
const RESPONSE_ENVELOPE_BYTES = 1024 * 1024;
const OFFICIAL_ENDPOINT_HOSTS = new Set(["api.minimaxi.com", "api.minimax.io"]);
const minimaxMusicModelSchema = z.enum([
  "music-2.6",
  "music-2.6-free",
  "music-3.0",
  "music-3.0-free",
]);
type MinimaxMusicModel = z.infer<typeof minimaxMusicModelSchema>;

export const minimaxMusicRequestSchema = z.strictObject({
  assetId: z.string().trim().min(1).max(160),
  prompt: z.string().trim().min(1).max(2_000),
  watermark: z.boolean().default(false),
});

const minimaxMusicResponseSchema = z.object({
  data: z.object({
    audio: z.string().min(1),
    status: z.number().int(),
  }).nullable(),
  base_resp: z.object({
    status_code: z.number().int(),
    status_msg: z.string(),
  }),
  trace_id: z.string().optional(),
  extra_info: z.object({
    music_duration: z.number().nonnegative().optional(),
    music_sample_rate: z.number().int().positive().optional(),
    music_channel: z.number().int().positive().optional(),
    music_bitrate: z.number().int().positive().optional(),
    music_size: z.number().int().nonnegative().optional(),
  }).nullish(),
});

export type MinimaxMusicRequest = z.input<typeof minimaxMusicRequestSchema>;
export type MinimaxMusicResult = {
  bytes: Uint8Array;
  mimeType: "audio/mpeg";
  provenance: AssetProvenance;
  traceId?: string;
};
export type MinimaxMusicFetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;
export type MinimaxMusicProviderOptions = {
  apiKey: string;
  model?: MinimaxMusicModel;
  license: string;
  endpoint?: string;
  fetch?: MinimaxMusicFetchLike;
  maxOutputBytes?: number;
  timeoutMs?: number;
};

export class MinimaxMusicProvider
  implements AudioGenerationProvider<MinimaxMusicRequest, MinimaxMusicResult>
{
  readonly id = "minimax";
  readonly capability = "audio-generation" as const;

  readonly #apiKey: string;
  readonly #endpoint: string;
  readonly #fetch: MinimaxMusicFetchLike;
  readonly #license: string;
  readonly #maxOutputBytes: number;
  readonly #maxResponseBytes: number;
  readonly #model: MinimaxMusicModel;
  readonly #timeoutMs: number;

  constructor(options: MinimaxMusicProviderOptions) {
    const apiKey = options.apiKey.trim();
    const license = options.license.trim();
    if (apiKey.length === 0) throw new Error("MiniMax API key is required at runtime.");
    if (license.length === 0) throw new Error("MiniMax output license identifier is required.");

    const endpoint = new URL(options.endpoint ?? DEFAULT_ENDPOINT);
    if (endpoint.protocol !== "https:" || endpoint.username !== "" || endpoint.password !== "" ||
        (endpoint.port !== "" && endpoint.port !== "443") || !OFFICIAL_ENDPOINT_HOSTS.has(endpoint.hostname) ||
        endpoint.pathname !== "/v1/music_generation" || endpoint.search !== "" || endpoint.hash !== "") {
      throw new Error("MiniMax endpoint must use an official HTTPS music_generation API without credentials, query, or custom port.");
    }
    const maxOutputBytes = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
    if (!Number.isSafeInteger(maxOutputBytes) || maxOutputBytes < 1 || maxOutputBytes > MAX_CONFIGURABLE_OUTPUT_BYTES) {
      throw new Error(`MiniMax maxOutputBytes must be an integer between 1 and ${MAX_CONFIGURABLE_OUTPUT_BYTES}.`);
    }
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_TIMEOUT_MS) {
      throw new Error(`MiniMax timeoutMs must be an integer between 1 and ${MAX_TIMEOUT_MS}.`);
    }

    this.#apiKey = apiKey;
    this.#endpoint = endpoint.href;
    this.#fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.#license = license;
    this.#maxOutputBytes = maxOutputBytes;
    this.#maxResponseBytes = maxOutputBytes * 2 + RESPONSE_ENVELOPE_BYTES;
    this.#model = minimaxMusicModelSchema.parse(options.model ?? "music-2.6");
    this.#timeoutMs = timeoutMs;
  }

  async execute(request: MinimaxMusicRequest): Promise<MinimaxMusicResult> {
    const input = minimaxMusicRequestSchema.parse(request);
    const response = await fetchProvider({
      provider: "MiniMax Music",
      fetch: this.#fetch,
      input: this.#endpoint,
      init: {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.#apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: this.#model,
          prompt: input.prompt,
          stream: false,
          output_format: "hex",
          is_instrumental: true,
          aigc_watermark: input.watermark,
          audio_setting: { sample_rate: 44_100, bitrate: 256_000, format: "mp3" },
        }),
      },
      timeoutMs: this.#timeoutMs,
      retry: { maxAttempts: 1 },
    });
    const parsed = minimaxMusicResponseSchema.parse(await readBoundedJson(response, this.#maxResponseBytes));
    if (parsed.base_resp.status_code !== 0 || parsed.data === null || parsed.data.status !== 2) {
      throw new Error(`MiniMax music generation failed with provider status ${parsed.base_resp.status_code}.`);
    }
    const bytes = decodeHexAudio(parsed.data.audio, this.#maxOutputBytes);
    if (!isMp3(bytes)) throw new Error("MiniMax response did not contain MP3 audio.");
    if (parsed.extra_info?.music_size !== undefined && parsed.extra_info.music_size !== bytes.byteLength) {
      throw new Error("MiniMax response music size did not match the decoded audio.");
    }
    const provenance = assetProvenanceSchema.parse({
      assetId: input.assetId,
      kind: "music",
      origin: "generated",
      provider: this.id,
      model: this.#model,
      prompt: input.prompt,
      license: this.#license,
      sha256: await sha256(bytes),
    });
    return {
      bytes,
      mimeType: "audio/mpeg",
      provenance,
      ...(parsed.trace_id === undefined ? {} : { traceId: parsed.trace_id }),
    };
  }
}

function decodeHexAudio(value: string, maxOutputBytes: number): Uint8Array {
  if (value.length === 0 || value.length % 2 !== 0 || value.length > maxOutputBytes * 2 || !/^[a-fA-F0-9]+$/.test(value)) {
    throw new Error("MiniMax response contained invalid or oversized hex audio data.");
  }
  const bytes = new Uint8Array(value.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

function isMp3(bytes: Uint8Array): boolean {
  return (bytes.length >= 3 && bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) ||
    (bytes.length >= 2 && bytes[0] === 0xff && (bytes[1]! & 0xe0) === 0xe0);
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const copy = new Uint8Array(bytes);
  const digest = await crypto.subtle.digest("SHA-256", copy.buffer);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function readBoundedJson(response: Response, limit: number): Promise<unknown> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > limit) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error("MiniMax response JSON exceeded the byte limit.");
  }
  if (response.body === null) throw new Error("MiniMax response was empty.");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  let completed = false;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) { completed = true; break; }
      length += value.byteLength;
      if (length > limit) throw new Error("MiniMax response JSON exceeded the byte limit.");
      chunks.push(value);
    }
  } finally {
    if (!completed) await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  if (length === 0) throw new Error("MiniMax response was empty.");
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
  } catch {
    throw new Error("MiniMax response was not valid bounded JSON.");
  }
}
