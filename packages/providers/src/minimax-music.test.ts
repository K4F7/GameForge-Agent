import { describe, expect, it, vi } from "vitest";
import {
  MinimaxMusicProvider,
  type MinimaxMusicFetchLike,
} from "./minimax-music.js";

const apiKey = "test-minimax-key-not-real";
const mp3Bytes = new Uint8Array([0x49, 0x44, 0x33, 0x04, 0x00, 0x00, 0x00, 0x00]);
const audioHex = Array.from(mp3Bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");

function success(audio = audioHex): Response {
  return new Response(JSON.stringify({
    data: { audio, status: 2 },
    extra_info: { music_size: mp3Bytes.length, music_sample_rate: 44_100 },
    base_resp: { status_code: 0, status_msg: "success" },
    trace_id: "trace-safe-1",
  }), { status: 200, headers: { "Content-Type": "application/json" } });
}

describe("MinimaxMusicProvider", () => {
  it("generates bounded instrumental MP3 data with verifiable provenance", async () => {
    const fetchMock = vi.fn<MinimaxMusicFetchLike>(async () => success());
    const provider = new MinimaxMusicProvider({
      apiKey,
      license: "minimax-output-terms-confirmed-by-account-owner",
      fetch: fetchMock,
    });

    const result = await provider.execute({
      assetId: "audio/main-theme.mp3",
      prompt: "A seamless upbeat instrumental loop for a casual puzzle game.",
    });

    expect(result.bytes).toEqual(mp3Bytes);
    expect(result.mimeType).toBe("audio/mpeg");
    expect(result.traceId).toBe("trace-safe-1");
    expect(result.provenance).toMatchObject({
      assetId: "audio/main-theme.mp3",
      kind: "music",
      origin: "generated",
      provider: "minimax",
      model: "music-2.6",
      license: "minimax-output-terms-confirmed-by-account-owner",
    });
    expect(result.provenance.sha256).toMatch(/^[a-f0-9]{64}$/);

    const [, init] = fetchMock.mock.calls[0] ?? [];
    expect(init?.headers).toMatchObject({ Authorization: `Bearer ${apiKey}` });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.parse(String(init?.body))).toEqual({
      model: "music-2.6",
      prompt: "A seamless upbeat instrumental loop for a casual puzzle game.",
      stream: false,
      output_format: "hex",
      is_instrumental: true,
      aigc_watermark: false,
      audio_setting: { sample_rate: 44_100, bitrate: 256_000, format: "mp3" },
    });
  });

  it("accepts only official MiniMax music endpoints", () => {
    expect(() => new MinimaxMusicProvider({ apiKey, license: "terms", endpoint: "http://api.minimaxi.com/v1/music_generation" }))
      .toThrow("official HTTPS");
    expect(() => new MinimaxMusicProvider({ apiKey, license: "terms", endpoint: "https://attacker.example/v1/music_generation" }))
      .toThrow("official HTTPS");
    expect(() => new MinimaxMusicProvider({ apiKey, license: "terms", endpoint: "https://api.minimaxi.com/v1/other" }))
      .toThrow("official HTTPS");
  });

  it("requires an explicit output license and a supported 2.6 model", () => {
    expect(() => new MinimaxMusicProvider({ apiKey, license: "" })).toThrow("license");
    expect(() => new MinimaxMusicProvider({ apiKey: "", license: "terms" })).toThrow("API key");
    expect(() => new MinimaxMusicProvider({
      apiKey,
      license: "terms",
      model: "music-3.0" as "music-2.6",
    })).toThrow();
    expect(() => new MinimaxMusicProvider({ apiKey, license: "terms", maxOutputBytes: 16 * 1024 * 1024 + 1 }))
      .toThrow("maxOutputBytes");
  });

  it("rejects invalid, oversized, or non-MP3 audio", async () => {
    const invalidHex = new MinimaxMusicProvider({ apiKey, license: "terms", fetch: async () => success("xyz") });
    await expect(invalidHex.execute({ assetId: "audio/theme.mp3", prompt: "Theme" })).rejects.toThrow("hex audio");
    const oversized = new MinimaxMusicProvider({ apiKey, license: "terms", maxOutputBytes: 3, fetch: async () => success() });
    await expect(oversized.execute({ assetId: "audio/theme.mp3", prompt: "Theme" })).rejects.toThrow("oversized");
    const wrongMagic = new MinimaxMusicProvider({ apiKey, license: "terms", fetch: async () => success("00010203") });
    await expect(wrongMagic.execute({ assetId: "audio/theme.mp3", prompt: "Theme" })).rejects.toThrow("MP3");
  });

  it("rejects nonterminal provider statuses without exposing status messages", async () => {
    const provider = new MinimaxMusicProvider({
      apiKey,
      license: "terms",
      fetch: async () => new Response(JSON.stringify({
        data: { audio: audioHex, status: 1 },
        base_resp: { status_code: 1001, status_msg: `failed ${apiKey}` },
      })),
    });
    let message = "";
    try {
      await provider.execute({ assetId: "audio/theme.mp3", prompt: "Theme" });
    } catch (error) {
      message = String(error);
    }
    expect(message).toContain("status 1001");
    expect(message).not.toContain(apiKey);
  });

  it("does not retry generation by default and redacts HTTP failures", async () => {
    const fetchMock = vi.fn<MinimaxMusicFetchLike>(async () => new Response(`failed ${apiKey}`, { status: 503 }));
    const provider = new MinimaxMusicProvider({ apiKey, license: "terms", fetch: fetchMock });
    let message = "";
    try {
      await provider.execute({ assetId: "audio/theme.mp3", prompt: "Theme" });
    } catch (error) {
      message = String(error);
    }
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(message).toContain("HTTP 503");
    expect(message).not.toContain(apiKey);
  });

  it("times out a hanging request with a stable error", async () => {
    const provider = new MinimaxMusicProvider({
      apiKey,
      license: "terms",
      timeoutMs: 5,
      fetch: async (_input, init) => new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
      }),
    });
    await expect(provider.execute({ assetId: "audio/theme.mp3", prompt: "Theme" })).rejects.toThrow("timed out");
  });
});
