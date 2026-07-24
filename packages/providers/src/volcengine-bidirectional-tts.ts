import { randomUUID } from "node:crypto";
import WebSocket, { type RawData } from "ws";
import { z } from "zod";

const DEFAULT_ENDPOINT = "wss://openspeech.bytedance.com/api/v3/tts/bidirection";
const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_AUDIO_BYTES = 64 * 1024 * 1024;
const MAX_QUEUED_MESSAGES = 256;
const MAX_QUEUED_MESSAGE_BYTES = 16 * 1024 * 1024;

export const volcengineBidirectionalTtsRequestSchema = z.strictObject({
  text: z.string().trim().min(1).max(5_000),
  speaker: z.string().trim().min(1).max(200),
  format: z.enum(["mp3", "pcm", "ogg_opus", "wav"]).default("mp3"),
  sampleRate: z.union([
    z.literal(8000), z.literal(16000), z.literal(22050), z.literal(24000),
    z.literal(32000), z.literal(44100), z.literal(48000),
  ]).default(24000),
  speechRate: z.number().int().min(-50).max(100).default(0),
  loudnessRate: z.number().int().min(-50).max(100).default(0),
  pitch: z.number().int().min(-12).max(12).default(0),
  contextTexts: z.array(z.string().trim().min(1).max(500)).max(4).default([]),
});

export type VolcengineBidirectionalTtsRequest = z.input<
  typeof volcengineBidirectionalTtsRequestSchema
>;

export type VolcengineBidirectionalTtsResult = {
  bytes: Uint8Array;
  mimeType: "audio/mpeg" | "audio/ogg" | "audio/wav" | "audio/pcm";
  model: "seed-tts-2.0";
  speaker: string;
  usageTextWords?: number;
};

export type VolcengineBidirectionalTtsProviderOptions = {
  apiKey: string;
  endpoint?: string;
  timeoutMs?: number;
};

enum MessageType {
  FullClientRequest = 1,
  FullServerResponse = 9,
  AudioOnlyServer = 11,
  Error = 15,
}

enum MessageFlag {
  WithEvent = 4,
}

export enum VolcengineTtsEvent {
  StartConnection = 1,
  FinishConnection = 2,
  ConnectionStarted = 50,
  ConnectionFailed = 51,
  ConnectionFinished = 52,
  StartSession = 100,
  FinishSession = 102,
  SessionStarted = 150,
  SessionFinished = 152,
  SessionFailed = 153,
  TaskRequest = 200,
  TTSResponse = 352,
}

export type DecodedVolcengineTtsMessage = {
  type: number;
  event?: number;
  sessionId?: string;
  connectId?: string;
  errorCode?: number;
  payload: Uint8Array;
};

export class VolcengineBidirectionalTtsProvider {
  readonly id = "volcengine-speech";
  readonly capability = "tts" as const;

  readonly #apiKey: string;
  readonly #endpoint: string;
  readonly #timeoutMs: number;

  constructor(options: VolcengineBidirectionalTtsProviderOptions) {
    const apiKey = options.apiKey.trim();
    if (apiKey.length === 0) throw new Error("Volcengine Speech API key is required at runtime.");
    const endpoint = new URL(options.endpoint ?? DEFAULT_ENDPOINT);
    if (
      endpoint.protocol !== "wss:" ||
      endpoint.hostname !== "openspeech.bytedance.com" ||
      endpoint.pathname !== "/api/v3/tts/bidirection" ||
      endpoint.username !== "" ||
      endpoint.password !== "" ||
      endpoint.search !== "" ||
      endpoint.hash !== ""
    ) {
      throw new Error("Volcengine bidirectional TTS endpoint must use the official WSS endpoint.");
    }
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120_000) {
      throw new Error("Volcengine TTS timeoutMs must be between 1 and 120000.");
    }
    this.#apiKey = apiKey;
    this.#endpoint = endpoint.href;
    this.#timeoutMs = timeoutMs;
  }

  async execute(request: VolcengineBidirectionalTtsRequest): Promise<VolcengineBidirectionalTtsResult> {
    const input = volcengineBidirectionalTtsRequestSchema.parse(request);
    const sessionId = randomUUID();
    const socket = new WebSocket(this.#endpoint, {
      headers: {
        "X-Api-Key": this.#apiKey,
        "X-Api-Resource-Id": "seed-tts-2.0",
        "X-Api-Connect-Id": randomUUID(),
        "X-Control-Require-Usage-Tokens-Return": "*",
      },
      maxPayload: MAX_AUDIO_BYTES,
    });
    const messages = createMessageQueue(socket, this.#timeoutMs);
    const audioChunks: Uint8Array[] = [];
    let audioBytes = 0;
    let usageTextWords: number | undefined;

    try {
      await waitForOpen(socket, this.#timeoutMs);
      socket.send(encodeVolcengineTtsMessage(VolcengineTtsEvent.StartConnection, new TextEncoder().encode("{}")));
      await messages.expect(VolcengineTtsEvent.ConnectionStarted);

      const baseRequest = {
        req_params: {
          speaker: input.speaker,
          audio_params: {
            format: input.format,
            sample_rate: input.sampleRate,
            speech_rate: input.speechRate,
            loudness_rate: input.loudnessRate,
          },
          post_process: { pitch: input.pitch },
          explicit_language: "zh-cn",
          context_texts: input.contextTexts,
        },
      };
      socket.send(encodeVolcengineTtsMessage(
        VolcengineTtsEvent.StartSession,
        encodeJson({ ...baseRequest, event: VolcengineTtsEvent.StartSession }),
        sessionId,
      ));
      await messages.expect(VolcengineTtsEvent.SessionStarted);

      socket.send(encodeVolcengineTtsMessage(
        VolcengineTtsEvent.TaskRequest,
        encodeJson({
          ...baseRequest,
          event: VolcengineTtsEvent.TaskRequest,
          req_params: { ...baseRequest.req_params, text: input.text },
        }),
        sessionId,
      ));
      socket.send(encodeVolcengineTtsMessage(
        VolcengineTtsEvent.FinishSession,
        encodeJson({ event: VolcengineTtsEvent.FinishSession }),
        sessionId,
      ));

      while (true) {
        const message = await messages.next();
        if (message.type === MessageType.Error || message.event === VolcengineTtsEvent.SessionFailed) {
          throw providerError(message);
        }
        if (message.event === VolcengineTtsEvent.TTSResponse) {
          audioBytes += message.payload.byteLength;
          if (audioBytes > MAX_AUDIO_BYTES) throw new Error("Volcengine TTS audio exceeded 64 MiB.");
          audioChunks.push(message.payload);
        }
        if (message.event === VolcengineTtsEvent.SessionFinished) {
          const payload = decodeJson(message.payload);
          const count = payload?.usage?.text_words;
          if (typeof count === "number" && Number.isSafeInteger(count) && count >= 0) usageTextWords = count;
          break;
        }
      }
      if (audioBytes === 0) throw new Error("Volcengine TTS returned no audio data.");

      socket.send(encodeVolcengineTtsMessage(
        VolcengineTtsEvent.FinishConnection,
        new TextEncoder().encode("{}"),
      ));
      await messages.expect(VolcengineTtsEvent.ConnectionFinished);
      return {
        bytes: concatenate(audioChunks, audioBytes),
        mimeType: mimeTypeFor(input.format),
        model: "seed-tts-2.0",
        speaker: input.speaker,
        ...(usageTextWords === undefined ? {} : { usageTextWords }),
      };
    } finally {
      messages.dispose();
      if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) socket.close();
    }
  }
}

export function encodeVolcengineTtsMessage(
  event: VolcengineTtsEvent,
  payload: Uint8Array,
  sessionId?: string,
): Uint8Array {
  const session = sessionId === undefined ? undefined : new TextEncoder().encode(sessionId);
  const includeSession = event !== VolcengineTtsEvent.StartConnection && event !== VolcengineTtsEvent.FinishConnection;
  if (includeSession && session === undefined) throw new Error("Volcengine TTS session event requires sessionId.");
  const size = 4 + 4 + (includeSession ? 4 + (session?.byteLength ?? 0) : 0) + 4 + payload.byteLength;
  const result = new Uint8Array(size);
  const view = new DataView(result.buffer);
  result[0] = 0x11;
  result[1] = (MessageType.FullClientRequest << 4) | MessageFlag.WithEvent;
  result[2] = 0x10;
  result[3] = 0;
  let offset = 4;
  view.setInt32(offset, event, false);
  offset += 4;
  if (includeSession && session !== undefined) {
    view.setUint32(offset, session.byteLength, false);
    offset += 4;
    result.set(session, offset);
    offset += session.byteLength;
  }
  view.setUint32(offset, payload.byteLength, false);
  offset += 4;
  result.set(payload, offset);
  return result;
}

export function decodeVolcengineTtsMessage(bytes: Uint8Array): DecodedVolcengineTtsMessage {
  if (bytes.byteLength < 8) throw new Error("Volcengine TTS frame is truncated.");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const headerBytes = (bytes[0]! & 0x0f) * 4;
  const type = bytes[1]! >> 4;
  const flags = bytes[1]! & 0x0f;
  if (headerBytes < 4 || headerBytes > bytes.byteLength) throw new Error("Volcengine TTS frame header is invalid.");
  let offset = headerBytes;
  let event: number | undefined;
  let sessionId: string | undefined;
  let connectId: string | undefined;
  let errorCode: number | undefined;
  if (flags === MessageFlag.WithEvent) {
    event = readInt32(view, offset);
    offset += 4;
    if (![VolcengineTtsEvent.ConnectionStarted, VolcengineTtsEvent.ConnectionFailed, VolcengineTtsEvent.ConnectionFinished].includes(event)) {
      [sessionId, offset] = readString(bytes, view, offset);
    } else {
      [connectId, offset] = readString(bytes, view, offset);
    }
  }
  if (type === MessageType.Error) {
    errorCode = readUint32(view, offset);
    offset += 4;
  }
  const length = readUint32(view, offset);
  offset += 4;
  if (offset + length !== bytes.byteLength) throw new Error("Volcengine TTS payload length is invalid.");
  return { type, ...(event === undefined ? {} : { event }), ...(sessionId === undefined ? {} : { sessionId }),
    ...(connectId === undefined ? {} : { connectId }), ...(errorCode === undefined ? {} : { errorCode }), payload: bytes.slice(offset) };
}

export function createMessageQueue(socket: WebSocket, timeoutMs: number) {
  const queue: DecodedVolcengineTtsMessage[] = [];
  const waiters: Array<{
    resolve: (message: DecodedVolcengineTtsMessage) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }> = [];
  let queuedBytes = 0;
  let terminalFailure: Error | undefined;
  const fail = (error: Error): void => {
    terminalFailure ??= error;
    while (waiters.length > 0) {
      const waiter = waiters.shift()!;
      clearTimeout(waiter.timer);
      waiter.reject(terminalFailure);
    }
  };
  const onMessage = (data: RawData) => {
    try {
      const message = decodeVolcengineTtsMessage(toBytes(data));
      const waiter = waiters.shift();
      if (waiter === undefined) {
        if (queue.length >= MAX_QUEUED_MESSAGES || queuedBytes + message.payload.byteLength > MAX_QUEUED_MESSAGE_BYTES) {
          fail(new Error("Volcengine TTS response queue exceeded the bounded buffer."));
          queue.splice(0); queuedBytes = 0;
          socket.close();
          return;
        }
        queue.push(message); queuedBytes += message.payload.byteLength;
      } else {
        clearTimeout(waiter.timer);
        waiter.resolve(message);
      }
    } catch (error) {
      const failure = error instanceof Error ? error : new Error("Invalid Volcengine TTS response.");
      queue.splice(0); queuedBytes = 0;
      fail(failure);
      socket.close();
    }
  };
  const onError = (): void => fail(new Error("Volcengine TTS connection failed."));
  const onClose = (): void => fail(new Error("Volcengine TTS connection closed."));
  socket.on("message", onMessage);
  socket.on("error", onError);
  socket.on("close", onClose);
  return {
    next: () => terminalFailure !== undefined
      ? Promise.reject(terminalFailure)
      : queue.length > 0
      ? Promise.resolve(queue.shift()!).then((message) => { queuedBytes -= message.payload.byteLength; return message; })
      : new Promise<DecodedVolcengineTtsMessage>((resolve, reject) => {
          const waiter = {
            resolve,
            reject,
            timer: setTimeout(() => {
              const index = waiters.indexOf(waiter);
              if (index >= 0) waiters.splice(index, 1);
              reject(new Error("Timed out waiting for Volcengine TTS response."));
            }, timeoutMs),
          };
          waiters.push(waiter);
        }),
    async expect(event: VolcengineTtsEvent) {
      const message = await this.next();
      if (message.type === MessageType.Error || message.event === VolcengineTtsEvent.ConnectionFailed || message.event === VolcengineTtsEvent.SessionFailed) throw providerError(message);
      if (message.event !== event) throw new Error(`Expected Volcengine TTS event ${event}, received ${message.event ?? "none"}.`);
      return message;
    },
    dispose: () => {
      socket.off("message", onMessage);
      socket.off("error", onError);
      socket.off("close", onClose);
      fail(new Error("Volcengine TTS response queue was disposed."));
    },
  };
}

function waitForOpen(socket: WebSocket, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Timed out connecting to Volcengine TTS.")), timeoutMs);
    socket.once("open", () => { clearTimeout(timer); resolve(); });
    socket.once("error", () => { clearTimeout(timer); reject(new Error("Volcengine TTS connection failed.")); });
  });
}

function toBytes(data: RawData): Uint8Array {
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (Array.isArray(data)) return new Uint8Array(Buffer.concat(data));
  return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
}

function readInt32(view: DataView, offset: number): number {
  if (offset + 4 > view.byteLength) throw new Error("Volcengine TTS frame is truncated.");
  return view.getInt32(offset, false);
}

function readUint32(view: DataView, offset: number): number {
  if (offset + 4 > view.byteLength) throw new Error("Volcengine TTS frame is truncated.");
  return view.getUint32(offset, false);
}

function readString(bytes: Uint8Array, view: DataView, offset: number): [string, number] {
  const length = readUint32(view, offset);
  offset += 4;
  if (offset + length > bytes.byteLength) throw new Error("Volcengine TTS string field is truncated.");
  return [new TextDecoder().decode(bytes.slice(offset, offset + length)), offset + length];
}

function encodeJson(value: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(value));
}

function decodeJson(payload: Uint8Array): any {
  if (payload.byteLength === 0) return undefined;
  try { return JSON.parse(new TextDecoder().decode(payload)); } catch { return undefined; }
}

function providerError(message: DecodedVolcengineTtsMessage): Error {
  const payload = decodeJson(message.payload);
  const detail = typeof payload?.message === "string" ? payload.message : "request rejected";
  return new Error(`Volcengine TTS ${detail}.`);
}

function concatenate(chunks: Uint8Array[], total: number): Uint8Array {
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength; }
  return result;
}

function mimeTypeFor(format: "mp3" | "pcm" | "ogg_opus" | "wav"): VolcengineBidirectionalTtsResult["mimeType"] {
  if (format === "mp3") return "audio/mpeg";
  if (format === "ogg_opus") return "audio/ogg";
  if (format === "wav") return "audio/wav";
  return "audio/pcm";
}
