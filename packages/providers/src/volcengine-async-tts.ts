import {
  assetProvenanceSchema,
  projectIdSchema,
  signedJobHandleSchema,
  type AssetProvenance,
} from "@gameforge/contracts";
import { z } from "zod";
import type { FetchLike } from "./seedream.js";
import { fetchProvider, type ProviderRetryOptions } from "./transport.js";

const SUBMIT_ENDPOINT = "https://openspeech.bytedance.com/api/v1/tts_async/submit";
const QUERY_ENDPOINT = "https://openspeech.bytedance.com/api/v1/tts_async/query";
const RESOURCE_ID = "volc.tts_async.default";
const MAX_AUDIO_BYTES = 64 * 1024 * 1024;
const MAX_JSON_BYTES = 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 30_000;

export const asyncTtsFormatSchema = z.enum(["wav", "mp3", "ogg_opus"]);
export const submitAsyncTtsRequestSchema = z.strictObject({
  projectId: projectIdSchema,
  assetId: assetProvenanceSchema.shape.assetId,
  text: z.string().trim().min(1).max(100_000),
  voiceType: z.string().trim().min(1).max(200),
  format: asyncTtsFormatSchema.default("mp3"),
  language: z.string().trim().min(1).max(40).default("zh-CN"),
  sampleRate: z.number().int().min(8_000).max(48_000).default(24_000),
  volume: z.number().min(0.1).max(3).default(1),
  speed: z.number().min(0.2).max(3).default(1),
  pitch: z.number().min(0.1).max(3).default(1),
  enableSubtitle: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]).default(0),
  sentenceInterval: z.number().int().min(0).max(3_000).default(0),
  style: z.string().trim().min(1).max(100).optional(),
});

export const asyncTtsJobRequestSchema = z.strictObject({
  projectId: projectIdSchema,
  jobHandle: signedJobHandleSchema,
});

const apiResponseSchema = z.object({
  task_id: z.string().trim().min(1).max(300).optional(),
  task_status: z.union([z.literal(0), z.literal(1), z.literal(2)]).optional(),
  text_length: z.number().int().nonnegative().optional(),
  audio_url: z.string().url().optional(),
  url_expire_time: z.number().int().positive().optional(),
  code: z.union([z.string(), z.number()]).optional(),
});

const jobPayloadSchema = z.strictObject({
  version: z.literal(1),
  projectId: projectIdSchema,
  assetId: assetProvenanceSchema.shape.assetId,
  taskId: z.string().trim().min(1).max(300),
  voiceType: z.string().trim().min(1).max(200),
  format: asyncTtsFormatSchema,
  promptExcerpt: z.string().trim().min(1).max(4_000),
  textSha256: z.string().regex(/^[a-f0-9]{64}$/),
});

export type SubmitAsyncTtsRequest = z.input<typeof submitAsyncTtsRequestSchema>;
export type AsyncTtsJobRequest = z.input<typeof asyncTtsJobRequestSchema>;
export type AsyncTtsJobStatus = "processing" | "succeeded" | "failed";
export type AsyncTtsJobResult = {
  jobHandle: string;
  taskId: string;
  status: AsyncTtsJobStatus;
  textLength?: number;
  audioUrlExpiresAt?: number;
};
export type AsyncTtsAudioResult = {
  bytes: Uint8Array;
  mimeType: "audio/mpeg" | "audio/ogg" | "audio/wav";
  provenance: AssetProvenance;
};
export type AsyncTtsJobIdentity = { assetId: string; taskId: string };

export type VolcengineAsyncTtsOptions = {
  apiToken: string;
  appId: string;
  license: string;
  allowedAudioHosts: ReadonlyArray<string>;
  fetch?: FetchLike;
  timeoutMs?: number;
  retry?: ProviderRetryOptions;
};

export class VolcengineAsyncTtsProvider {
  readonly id = "volcengine-speech";
  readonly capability = "tts" as const;

  readonly #apiToken: string;
  readonly #appId: string;
  readonly #license: string;
  readonly #allowedAudioHosts: ReadonlySet<string>;
  readonly #fetch: FetchLike;
  readonly #timeoutMs: number;
  readonly #retry: ProviderRetryOptions | undefined;

  constructor(options: VolcengineAsyncTtsOptions) {
    this.#apiToken = required(options.apiToken, "Volcengine speech API token");
    this.#appId = required(options.appId, "Volcengine speech app ID");
    this.#license = required(options.license, "TTS output license declaration");
    const hosts = options.allowedAudioHosts.map(normalizeHost);
    if (hosts.length === 0) throw new Error("At least one TTS audio host must be allowed.");
    this.#allowedAudioHosts = new Set(hosts);
    this.#fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 60_000) {
      throw new Error("TTS timeout must be an integer between 1000 and 60000 milliseconds.");
    }
    this.#timeoutMs = timeoutMs;
    this.#retry = options.retry;
  }

  async submit(request: SubmitAsyncTtsRequest): Promise<AsyncTtsJobResult> {
    const input = submitAsyncTtsRequestSchema.parse(request);
    const reqid = crypto.randomUUID().replaceAll("-", "");
    const response = await this.#request(SUBMIT_ENDPOINT, {
      method: "POST",
      headers: this.#headers({ "Content-Type": "application/json" }),
      body: JSON.stringify({
        appid: this.#appId,
        reqid,
        text: input.text,
        format: input.format,
        voice_type: input.voiceType,
        language: input.language,
        sample_rate: input.sampleRate,
        volume: input.volume,
        speed: input.speed,
        pitch: input.pitch,
        enable_subtitle: input.enableSubtitle,
        sentence_interval: input.sentenceInterval,
        ...(input.style === undefined ? {} : { style: input.style }),
      }),
    }, false);
    const parsed = await parseApiResponse(response, "submit");
    if (parsed.task_id === undefined || parsed.task_status === undefined) {
      throw new Error("TTS submit response did not contain a task ID and status.");
    }
    const textSha256 = await sha256(new TextEncoder().encode(input.text));
    const promptExcerpt = provenancePrompt(input.text, textSha256);
    const jobHandle = await this.#signJob({
      version: 1,
      projectId: input.projectId,
      assetId: input.assetId,
      taskId: parsed.task_id,
      voiceType: input.voiceType,
      format: input.format,
      promptExcerpt,
      textSha256,
    });
    return {
      jobHandle,
      taskId: parsed.task_id,
      status: statusName(parsed.task_status),
      ...(parsed.text_length === undefined ? {} : { textLength: parsed.text_length }),
    };
  }

  async query(request: AsyncTtsJobRequest): Promise<AsyncTtsJobResult> {
    const input = asyncTtsJobRequestSchema.parse(request);
    const job = await this.#verifyJob(input.jobHandle, input.projectId);
    const parsed = await this.#queryTask(job.taskId);
    if (parsed.task_status === undefined) throw new Error("TTS query response did not contain a task status.");
    return {
      jobHandle: input.jobHandle,
      taskId: job.taskId,
      status: statusName(parsed.task_status),
      ...(parsed.text_length === undefined ? {} : { textLength: parsed.text_length }),
      ...(parsed.url_expire_time === undefined ? {} : { audioUrlExpiresAt: parsed.url_expire_time }),
    };
  }

  async inspect(request: AsyncTtsJobRequest): Promise<AsyncTtsJobIdentity> {
    const input = asyncTtsJobRequestSchema.parse(request);
    const job = await this.#verifyJob(input.jobHandle, input.projectId);
    return { assetId: job.assetId, taskId: job.taskId };
  }

  async materialize(request: AsyncTtsJobRequest): Promise<AsyncTtsAudioResult> {
    const input = asyncTtsJobRequestSchema.parse(request);
    const job = await this.#verifyJob(input.jobHandle, input.projectId);
    const parsed = await this.#queryTask(job.taskId);
    if (parsed.task_status !== 1 || parsed.audio_url === undefined) {
      throw new Error(`TTS job is not ready for materialization (${statusName(parsed.task_status ?? 0)}).`);
    }
    const audioUrl = this.#verifiedAudioUrl(parsed.audio_url);
    const response = await this.#request(audioUrl.href, {
      method: "GET",
      redirect: "error",
    });
    const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
    if (contentType === undefined || ![
      "audio/mpeg", "audio/mp3", "audio/ogg", "audio/wav", "audio/x-wav", "application/octet-stream",
    ].includes(contentType)) {
      throw new Error("TTS audio response used an unsupported content type.");
    }
    const declaredLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > MAX_AUDIO_BYTES) {
      if (response.body !== null) await response.body.cancel().catch(() => undefined);
      throw new Error("TTS audio exceeds the byte limit.");
    }
    const bytes = await readBoundedBody(response, MAX_AUDIO_BYTES);
    const mimeType = detectAudioMimeType(bytes);
    if (mimeType !== mimeForFormat(job.format)) {
      throw new Error("TTS audio format does not match the submitted job.");
    }
    const provenance = assetProvenanceSchema.parse({
      assetId: job.assetId,
      kind: "voice",
      origin: "generated",
      provider: this.id,
      model: job.voiceType,
      prompt: job.promptExcerpt,
      license: this.#license,
      sha256: await sha256(bytes),
    });
    return { bytes, mimeType, provenance };
  }

  async #queryTask(taskId: string): Promise<z.infer<typeof apiResponseSchema>> {
    const url = new URL(QUERY_ENDPOINT);
    url.searchParams.set("appid", this.#appId);
    url.searchParams.set("task_id", taskId);
    const response = await this.#request(url.href, { method: "GET", headers: this.#headers() });
    return parseApiResponse(response, "query");
  }

  async #request(url: string, init: RequestInit, retryable = true): Promise<Response> {
    return fetchProvider({
      provider: "TTS",
      fetch: this.#fetch,
      input: url,
      init,
      timeoutMs: this.#timeoutMs,
      retry: retryable ? (this.#retry ?? {}) : { ...this.#retry, maxAttempts: 1 },
    });
  }

  #headers(extra: Record<string, string> = {}): Record<string, string> {
    return {
      Authorization: `Bearer; ${this.#apiToken}`,
      "Resource-Id": RESOURCE_ID,
      ...extra,
    };
  }

  #verifiedAudioUrl(value: string): URL {
    const url = new URL(value);
    if (
      url.protocol !== "https:" || url.username !== "" || url.password !== "" ||
      (url.port !== "" && url.port !== "443") || url.hash !== "" ||
      !this.#allowedAudioHosts.has(url.hostname.toLowerCase())
    ) {
      throw new Error("TTS audio URL is not on an allowed official HTTPS host.");
    }
    return url;
  }

  async #signJob(payload: z.infer<typeof jobPayloadSchema>): Promise<string> {
    const encoded = base64UrlEncode(new TextEncoder().encode(JSON.stringify(jobPayloadSchema.parse(payload))));
    const signature = await this.#hmac(new TextEncoder().encode(encoded));
    return `${encoded}.${base64UrlEncode(signature)}`;
  }

  async #verifyJob(handle: string, projectId: string): Promise<z.infer<typeof jobPayloadSchema>> {
    const [encoded, signature, extra] = handle.split(".");
    if (encoded === undefined || signature === undefined || extra !== undefined) {
      throw new Error("TTS job handle is invalid.");
    }
    const key = await this.#hmacKey(["verify"]);
    const valid = await crypto.subtle.verify(
      "HMAC",
      key,
      toArrayBuffer(base64UrlDecode(signature)),
      toArrayBuffer(new TextEncoder().encode(encoded)),
    );
    if (!valid) throw new Error("TTS job handle is invalid.");
    let payload: unknown;
    try {
      payload = JSON.parse(new TextDecoder().decode(base64UrlDecode(encoded))) as unknown;
    } catch {
      throw new Error("TTS job handle is invalid.");
    }
    const parsed = jobPayloadSchema.parse(payload);
    if (parsed.projectId !== projectId) throw new Error("TTS job does not belong to this project.");
    return parsed;
  }

  async #hmac(bytes: Uint8Array): Promise<Uint8Array> {
    const key = await this.#hmacKey(["sign"]);
    return new Uint8Array(await crypto.subtle.sign("HMAC", key, toArrayBuffer(bytes)));
  }

  async #hmacKey(_purpose: ReadonlyArray<string>): Promise<CryptoKey> {
    return crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(this.#apiToken),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign", "verify"],
    );
  }
}

async function parseApiResponse(response: Response, operation: string): Promise<z.infer<typeof apiResponseSchema>> {
  let input: unknown;
  try {
    const declaredLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > MAX_JSON_BYTES) {
      if (response.body !== null) await response.body.cancel().catch(() => undefined);
      throw new Error("oversized");
    }
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > MAX_JSON_BYTES) throw new Error("oversized");
    input = JSON.parse(text) as unknown;
  } catch {
    throw new Error(`TTS ${operation} response was not valid bounded JSON.`);
  }
  const parsed = apiResponseSchema.parse(input);
  if (parsed.task_id === undefined && parsed.code !== undefined) {
    throw new Error(`TTS ${operation} failed with API code ${String(parsed.code).slice(0, 40)}.`);
  }
  return parsed;
}

async function readBoundedBody(response: Response, limit: number): Promise<Uint8Array> {
  if (response.body === null) throw new Error("TTS audio response was empty.");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > limit) {
      await reader.cancel();
      throw new Error("TTS audio exceeds the byte limit.");
    }
    chunks.push(value);
  }
  if (length === 0) throw new Error("TTS audio response was empty.");
  const output = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

function detectAudioMimeType(bytes: Uint8Array): "audio/mpeg" | "audio/ogg" | "audio/wav" {
  const ascii = (start: number, end: number) => String.fromCharCode(...bytes.slice(start, end));
  if (bytes.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WAVE") return "audio/wav";
  if (bytes.length >= 4 && ascii(0, 4) === "OggS") return "audio/ogg";
  if (bytes.length >= 3 && (ascii(0, 3) === "ID3" || (bytes[0] === 0xff && ((bytes[1] ?? 0) & 0xe0) === 0xe0))) return "audio/mpeg";
  throw new Error("TTS response contained an unsupported audio format.");
}

function mimeForFormat(format: z.infer<typeof asyncTtsFormatSchema>): "audio/mpeg" | "audio/ogg" | "audio/wav" {
  if (format === "mp3") return "audio/mpeg";
  if (format === "ogg_opus") return "audio/ogg";
  return "audio/wav";
}

function statusName(status: 0 | 1 | 2): AsyncTtsJobStatus {
  return status === 0 ? "processing" : status === 1 ? "succeeded" : "failed";
}

function provenancePrompt(text: string, hash: string): string {
  if (text.length <= 4_000) return text;
  const suffix = `\n[full-text-sha256:${hash}]`;
  return `${text.slice(0, 4_000 - suffix.length)}${suffix}`;
}

function normalizeHost(host: string): string {
  const value = host.trim().toLowerCase();
  if (!/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(value)) {
    throw new Error(`Invalid TTS audio host: ${host}`);
  }
  if (value === "localhost" || value.endsWith(".localhost") || /^\d+(?:\.\d+){3}$/.test(value)) {
    throw new Error(`TTS audio host cannot be local or an IP address: ${host}`);
  }
  return value;
}

function required(value: string, label: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) throw new Error(`${label} is required.`);
  return normalized;
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function base64UrlDecode(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("TTS job handle is invalid.");
  const padded = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  let binary: string;
  try {
    binary = atob(padded);
  } catch {
    throw new Error("TTS job handle is invalid.");
  }
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const digest = await crypto.subtle.digest("SHA-256", copy.buffer);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}
