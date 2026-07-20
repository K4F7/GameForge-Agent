import { describe, expect, it, vi } from "vitest";
import { BailianGameSpecProvider } from "./bailian-game-spec.js";
import type { FetchLike } from "./seedream.js";

const apiKey = "test-bailian-key-never-log";
const validSpec = {
  title: "安全冲刺",
  locale: "zh-CN",
  genre: "arcade",
  objective: "在倒计时结束前收集所有安全装备。",
  controls: ["方向键移动"],
  winCondition: "收集全部安全装备。",
  loseCondition: "倒计时结束或生命耗尽。",
  targetDurationSeconds: 90,
  gameplay: { collectibleCount: 5, hazardCount: 3, startingLives: 3, movementSpeed: 220 },
};

function response(content: unknown, model = "qwen3.6-flash"): Response {
  return new Response(JSON.stringify({
    model,
    choices: [{ message: { content: typeof content === "string" ? content : JSON.stringify(content) } }],
  }), { status: 200, headers: { "Content-Type": "application/json" } });
}

describe("BailianGameSpecProvider", () => {
  it("uses the official compatible endpoint and strict JSON Schema", async () => {
    const fetchMock = vi.fn<FetchLike>(async () => response(validSpec));
    const result = await new BailianGameSpecProvider({ apiKey, fetch: fetchMock }).execute({
      prompt: "制作一个90秒的安全训练小游戏，玩家收集装备并避开危险。",
    });
    expect(result).toEqual({ spec: validSpec, model: "qwen3.6-flash" });
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toBe("https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions");
    expect(init?.headers).toMatchObject({ Authorization: `Bearer ${apiKey}` });
    const body = JSON.parse(String(init?.body)) as Record<string, any>;
    expect(body).toMatchObject({ model: "qwen3.6-flash", stream: false, temperature: 0.2 });
    expect(body.response_format).toMatchObject({ type: "json_schema", json_schema: { strict: true } });
    expect(body.response_format.json_schema.schema.additionalProperties).toBe(false);
    expect(body.response_format.json_schema.schema.required).toContain("gameplay");
    expect(body.response_format.json_schema.schema.required).toContain("locale");
    expect(body.response_format.json_schema.schema.properties.locale).toEqual({
      type: "string",
      enum: ["zh-CN", "en-US"],
    });
    expect(body.response_format.json_schema.schema.properties.gameplay).toMatchObject({
      additionalProperties: false,
      required: ["collectibleCount", "hazardCount", "startingLives", "movementSpeed"],
    });
  });

  it("rejects schema-invalid model output", async () => {
    const fetchMock = vi.fn<FetchLike>(async () => response({ ...validSpec, genre: "rpg", extra: true }));
    await expect(new BailianGameSpecProvider({ apiKey, fetch: fetchMock }).execute({
      prompt: "制作一个角色扮演安全训练小游戏。",
    })).rejects.toThrow();
  });

  it("rejects model output in a different locale than requested", async () => {
    const fetchMock = vi.fn<FetchLike>(async () => response({ ...validSpec, locale: "zh-CN" }));
    await expect(new BailianGameSpecProvider({ apiKey, fetch: fetchMock }).execute({
      prompt: "Create a complete English safety-training browser game specification.",
      language: "en-US",
    })).rejects.toThrow("locale");
  });

  it("rejects an invalid model identifier reported by the upstream response", async () => {
    const fetchMock = vi.fn<FetchLike>(async () => response(validSpec, "invalid model id"));
    await expect(new BailianGameSpecProvider({ apiKey, fetch: fetchMock }).execute({
      prompt: "制作一个简单的安全训练小游戏，并输出严格的游戏规格。",
    })).rejects.toThrow();
  });

  it("reports HTTP errors without leaking credentials", async () => {
    const fetchMock = vi.fn<FetchLike>(async () => new Response(apiKey, { status: 401 }));
    let message = "";
    try {
      await new BailianGameSpecProvider({ apiKey, fetch: fetchMock }).execute({ prompt: "制作一个简单的安全训练小游戏。" });
    } catch (error) { message = error instanceof Error ? error.message : String(error); }
    expect(message).toContain("HTTP 401");
    expect(message).not.toContain(apiKey);
  });

  it("retries a transient rate limit with a bounded policy", async () => {
    const fetchMock = vi.fn<FetchLike>()
      .mockResolvedValueOnce(new Response("busy", { status: 429 }))
      .mockResolvedValueOnce(response(validSpec));
    const result = await new BailianGameSpecProvider({
      apiKey,
      fetch: fetchMock,
      retry: { baseDelayMs: 0, maxDelayMs: 0, sleep: async () => undefined },
    }).execute({ prompt: "制作一个简单且完整的安全训练小游戏规格。" });
    expect(result.spec.title).toBe(validSpec.title);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
