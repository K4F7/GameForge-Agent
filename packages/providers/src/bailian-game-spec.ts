import { gameSpecSchema, modelIdSchema, type GameSpec, type LlmProvider } from "@gameforge/contracts";
import { z } from "zod";
import type { FetchLike } from "./seedream.js";
import { fetchProvider, type ProviderRetryOptions } from "./transport.js";

const ENDPOINT = "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions";
const MAX_JSON_BYTES = 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 60_000;

export const draftGameSpecRequestSchema = z.strictObject({
  prompt: z.string().trim().min(10).max(12_000),
  language: z.enum(["zh-CN", "en-US"]).default("zh-CN"),
});

const responseSchema = z.object({
  model: z.string().trim().min(1).optional(),
  choices: z.array(z.object({
    message: z.object({ content: z.string().min(1) }),
  })).min(1),
});

export type DraftGameSpecRequest = z.input<typeof draftGameSpecRequestSchema>;
export type DraftGameSpecResult = { spec: GameSpec; model: string };

export class BailianGameSpecProvider implements LlmProvider<DraftGameSpecRequest, DraftGameSpecResult> {
  readonly id = "bailian";
  readonly capability = "llm" as const;
  readonly #apiKey: string;
  readonly #model: string;
  readonly #fetch: FetchLike;
  readonly #retry: ProviderRetryOptions | undefined;
  readonly #timeoutMs: number;

  constructor(options: { apiKey: string; model?: string; fetch?: FetchLike; timeoutMs?: number; retry?: ProviderRetryOptions }) {
    const apiKey = options.apiKey.trim();
    if (apiKey.length === 0) throw new Error("Bailian API key is required at runtime.");
    this.#apiKey = apiKey;
    this.#model = modelIdSchema.parse(options.model ?? "qwen3.6-flash");
    this.#fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 10 * 60_000) {
      throw new Error("Bailian timeoutMs must be an integer between 1 and 600000.");
    }
    this.#timeoutMs = timeoutMs;
    this.#retry = options.retry;
  }

  async execute(request: DraftGameSpecRequest): Promise<DraftGameSpecResult> {
    const input = draftGameSpecRequestSchema.parse(request);
    const schema = gameSpecJsonSchema();
    const response = await fetchProvider({
      provider: "Bailian",
      fetch: this.#fetch,
      input: ENDPOINT,
      init: {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.#apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
        model: this.#model,
        messages: [
          {
            role: "system",
            content: input.language === "zh-CN"
              ? "你是游戏规格工程师。仅根据用户需求输出符合 JSON Schema 的小游戏规格；不要输出代码、Markdown 或额外字段。"
              : "You are a game specification engineer. Return only a small-game specification matching the JSON Schema; no code, Markdown, or extra fields.",
          },
          { role: "user", content: input.prompt },
        ],
        response_format: {
          type: "json_schema",
          json_schema: { name: "game_spec", strict: true, schema },
        },
        stream: false,
        temperature: 0.2,
        }),
      },
      timeoutMs: this.#timeoutMs,
      ...(this.#retry === undefined ? {} : { retry: this.#retry }),
    });
    const text = await boundedText(response, MAX_JSON_BYTES);
    let raw: unknown;
    try { raw = JSON.parse(text) as unknown; }
    catch { throw new Error("Bailian response was not valid JSON."); }
    const parsed = responseSchema.parse(raw);
    const content = parsed.choices[0]?.message.content;
    if (content === undefined) throw new Error("Bailian response contained no assistant content.");
    let specInput: unknown;
    try { specInput = JSON.parse(content) as unknown; }
    catch { throw new Error("Bailian assistant content was not valid JSON."); }
    const spec = gameSpecSchema.parse(specInput);
    if (spec.locale !== input.language) {
      throw new Error("Bailian GameSpec locale did not match the requested language.");
    }
    return {
      spec,
      model: modelIdSchema.parse(parsed.model ?? this.#model),
    };
  }
}

function gameSpecJsonSchema(): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: false,
    required: ["title", "locale", "genre", "objective", "controls", "winCondition", "loseCondition", "targetDurationSeconds", "gameplay"],
    properties: {
      title: { type: "string", minLength: 1, maxLength: 80 },
      locale: { type: "string", enum: ["zh-CN", "en-US"] },
      genre: { type: "string", enum: ["arcade", "platformer", "puzzle", "shooter", "strategy"] },
      objective: { type: "string", minLength: 10, maxLength: 500 },
      controls: { type: "array", minItems: 1, maxItems: 12, items: { type: "string", minLength: 1 } },
      winCondition: { type: "string", minLength: 5, maxLength: 300 },
      loseCondition: { type: "string", minLength: 5, maxLength: 300 },
      targetDurationSeconds: { type: "integer", minimum: 30, maximum: 1800 },
      gameplay: {
        type: "object",
        additionalProperties: false,
        required: ["collectibleCount", "hazardCount", "startingLives", "movementSpeed"],
        properties: {
          collectibleCount: { type: "integer", minimum: 1, maximum: 10 },
          hazardCount: { type: "integer", minimum: 0, maximum: 6 },
          startingLives: { type: "integer", minimum: 1, maximum: 9 },
          movementSpeed: { type: "integer", minimum: 100, maximum: 360 },
        },
      },
    },
  };
}

async function boundedText(response: Response, limit: number): Promise<string> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > limit) {
    if (response.body !== null) await response.body.cancel().catch(() => undefined);
    throw new Error("Bailian response exceeds the byte limit.");
  }
  const text = await response.text();
  if (new TextEncoder().encode(text).byteLength > limit) throw new Error("Bailian response exceeds the byte limit.");
  return text;
}
