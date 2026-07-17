import { describe, expect, it, vi } from "vitest";
import { FreesoundProvider, type FreesoundFetchLike } from "./freesound.js";

const apiKey = "test-freesound-key-not-a-secret";

function sound(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 42,
    name: "Metal impact",
    username: "sound-author",
    license: "Creative Commons 0",
    url: "https://freesound.org/people/sound-author/sounds/42/",
    previews: {
      "preview-hq-mp3": "https://cdn.freesound.org/previews/0/42_1-hq.mp3",
    },
    description: "A short metal impact.",
    tags: ["metal", "impact"],
    duration: 0.75,
    type: "wav",
    ...overrides,
  };
}

describe("FreesoundProvider", () => {
  it("uses the official search API, token header, and CC0 filter", async () => {
    const fetchMock = vi.fn<FreesoundFetchLike>(async () =>
      new Response(JSON.stringify({ count: 1, results: [sound()] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const provider = new FreesoundProvider({ apiKey, apiUsage: "non-commercial", fetch: fetchMock });

    const result = await provider.execute({ query: "metal impact" });

    expect(result.total).toBe(1);
    expect(result.candidates[0]).toMatchObject({
      soundId: 42,
      license: "Creative Commons 0",
      previewUrl: "https://cdn.freesound.org/previews/0/42_1-hq.mp3",
    });
    expect(result.candidates[0]?.attribution).toContain("sound-author");

    const [request, init] = fetchMock.mock.calls[0] ?? [];
    const url = new URL(String(request));
    expect(`${url.origin}${url.pathname}`).toBe("https://freesound.org/apiv2/search/");
    expect(url.searchParams.get("query")).toBe("metal impact");
    expect(url.searchParams.get("filter")).toBe('license:"Creative Commons 0"');
    expect(url.searchParams.get("fields")).toContain("previews");
    expect(url.searchParams.has("token")).toBe(false);
    expect(init?.headers).toEqual({ Authorization: `Token ${apiKey}` });
  });

  it("supports CC BY and falls back through official preview fields", async () => {
    const fetchMock = vi.fn<FreesoundFetchLike>(async () =>
      new Response(JSON.stringify({
        count: 1,
        results: [sound({
          license: "Attribution",
          previews: {
            "preview-lq-ogg": "https://cdn.freesound.org/previews/0/42_1-lq.ogg",
          },
        })],
      }), { status: 200, headers: { "Content-Type": "application/json" } }),
    );
    const provider = new FreesoundProvider({ apiKey, apiUsage: "non-commercial", fetch: fetchMock });

    const result = await provider.execute({ query: "impact", license: "cc-by" });

    expect(result.candidates[0]).toMatchObject({
      license: "Attribution",
      previewUrl: "https://cdn.freesound.org/previews/0/42_1-lq.ogg",
    });
  });

  it("fails closed if the API returns a non-commercial result", async () => {
    const fetchMock = vi.fn<FreesoundFetchLike>(async () =>
      new Response(JSON.stringify({
        count: 1,
        results: [sound({ license: "Attribution NonCommercial" })],
      }), { status: 200, headers: { "Content-Type": "application/json" } }),
    );
    const provider = new FreesoundProvider({ apiKey, apiUsage: "non-commercial", fetch: fetchMock });

    await expect(
      provider.execute({ query: "impact", license: "cc0-or-cc-by" }),
    ).rejects.toThrow("outside the requested license policy");
  });

  it("omits results that have no playable preview", async () => {
    const fetchMock = vi.fn<FreesoundFetchLike>(async () =>
      new Response(JSON.stringify({ count: 1, results: [sound({ previews: {} })] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const provider = new FreesoundProvider({ apiKey, apiUsage: "non-commercial", fetch: fetchMock });

    const result = await provider.execute({ query: "impact" });

    expect(result).toMatchObject({ total: 1, candidates: [] });
  });

  it("rejects non-official endpoints", () => {
    expect(() => new FreesoundProvider({
      apiKey,
      apiUsage: "non-commercial",
      endpoint: "https://attacker.example.com/apiv2/search/",
    })).toThrow("official");
  });

  it("reports HTTP errors without exposing the token", async () => {
    const fetchMock = vi.fn<FreesoundFetchLike>(async () =>
      new Response(`token=${apiKey}`, { status: 401 }),
    );
    const provider = new FreesoundProvider({ apiKey, apiUsage: "non-commercial", fetch: fetchMock });

    let message = "";
    try {
      await provider.execute({ query: "impact" });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message).toContain("HTTP 401");
    expect(message).not.toContain(apiKey);
  });

  it("retries transient search failures and bounds the response body", async () => {
    const fetchMock = vi.fn<FreesoundFetchLike>()
      .mockResolvedValueOnce(new Response("busy", { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ count: 1, results: [sound()] }), { status: 200 }));
    const provider = new FreesoundProvider({
      apiKey,
      apiUsage: "non-commercial",
      fetch: fetchMock,
      retry: { baseDelayMs: 0, maxDelayMs: 0, sleep: async () => undefined },
    });
    await expect(provider.execute({ query: "impact" })).resolves.toMatchObject({ total: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const oversized = new FreesoundProvider({
      apiKey,
      apiUsage: "non-commercial",
      fetch: async () => new Response("{}", { status: 200, headers: { "Content-Length": String(5 * 1024 * 1024) } }),
    });
    await expect(oversized.execute({ query: "impact" })).rejects.toThrow("byte limit");
  });
});
