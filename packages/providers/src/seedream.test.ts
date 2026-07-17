import { describe, expect, it, vi } from "vitest";
import { SeedreamProvider, type FetchLike } from "./seedream.js";

const apiKey = "test-api-key-not-a-real-secret";
const jpegBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0xff, 0xd9]);

function encodeBase64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

describe("SeedreamProvider", () => {
  it("requests Base64 output and records verifiable provenance", async () => {
    const fetchMock = vi.fn<FetchLike>(async () =>
      new Response(
        JSON.stringify({
          model: "doubao-seedream-4-0-250828",
          data: [{ b64_json: encodeBase64(jpegBytes), size: "2048x2048" }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    const provider = new SeedreamProvider({
      apiKey,
      model: "doubao-seedream-4-0-250828",
      license: "volcengine-generated-content-terms",
      fetch: fetchMock,
      allowedReferenceImageHosts: ["assets.example.com"],
    });

    const result = await provider.execute({
      assetId: "images/hero.jpg",
      prompt: "A brave pixel-art mechanic.",
      referenceImages: ["https://assets.example.com/hero-reference.png"],
    });

    expect(result.bytes).toEqual(jpegBytes);
    expect(result.mimeType).toBe("image/jpeg");
    expect(result.size).toBe("2048x2048");
    expect(result.provenance.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(result.provenance).toMatchObject({
      assetId: "images/hero.jpg",
      kind: "image",
      origin: "generated",
      provider: "volcengine-ark",
      model: "doubao-seedream-4-0-250828",
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [, init] = fetchMock.mock.calls[0] ?? [];
    expect(init?.headers).toMatchObject({
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.parse(String(init?.body))).toMatchObject({
      model: "doubao-seedream-4-0-250828",
      prompt: "A brave pixel-art mechanic.",
      image: "https://assets.example.com/hero-reference.png",
      size: "2K",
      response_format: "b64_json",
      sequential_image_generation: "disabled",
      stream: false,
      watermark: false,
    });
  });

  it("rejects unsafe endpoints before making a request", () => {
    expect(
      () =>
        new SeedreamProvider({
          apiKey,
          model: "doubao-seedream-4-0-250828",
          license: "provider-terms",
          endpoint: "http://example.com/images/generations",
        }),
    ).toThrow("HTTPS");

    expect(
      () =>
        new SeedreamProvider({
          apiKey,
          model: "doubao-seedream-4-0-250828",
          license: "provider-terms",
          endpoint: "https://attacker.example.com/api/v3/images/generations",
        }),
    ).toThrow("official");
  });

  it("rejects reference images from hosts that were not explicitly allowed", async () => {
    const fetchMock = vi.fn<FetchLike>();
    const provider = new SeedreamProvider({
      apiKey,
      model: "doubao-seedream-4-0-250828",
      license: "provider-terms",
      fetch: fetchMock,
    });

    await expect(
      provider.execute({
        assetId: "images/hero.jpg",
        prompt: "Hero",
        referenceImages: ["https://private.example.com/secret.png"],
      }),
    ).rejects.toThrow("not allowed");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports HTTP errors without exposing the API key", async () => {
    const fetchMock = vi.fn<FetchLike>(async () =>
      new Response(`{"error":"${apiKey}"}`, { status: 401 }),
    );
    const provider = new SeedreamProvider({
      apiKey,
      model: "doubao-seedream-4-0-250828",
      license: "provider-terms",
      fetch: fetchMock,
    });

    let message = "";
    try {
      await provider.execute({ assetId: "images/hero.jpg", prompt: "Hero" });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message).toContain("HTTP 401");
    expect(message).not.toContain(apiKey);
  });

  it("rejects image payloads above the configured byte limit before decoding", async () => {
    const fetchMock = vi.fn<FetchLike>(async () =>
      new Response(
        JSON.stringify({
          model: "doubao-seedream-4-0-250828",
          data: [{ b64_json: encodeBase64(jpegBytes) }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    const provider = new SeedreamProvider({
      apiKey,
      model: "doubao-seedream-4-0-250828",
      license: "provider-terms",
      maxOutputBytes: 4,
      fetch: fetchMock,
    });

    await expect(
      provider.execute({ assetId: "images/hero.jpg", prompt: "Hero" }),
    ).rejects.toThrow("oversized");
  });

  it("rejects malformed successful responses", async () => {
    const fetchMock = vi.fn<FetchLike>(async () =>
      new Response(JSON.stringify({ model: "doubao-seedream-4-0-250828", data: [{}] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const provider = new SeedreamProvider({
      apiKey,
      model: "doubao-seedream-4-0-250828",
      license: "provider-terms",
      fetch: fetchMock,
    });

    await expect(
      provider.execute({ assetId: "images/hero.jpg", prompt: "Hero" }),
    ).rejects.toThrow("Base64");
  });

  it("times out a hanging request with a stable redacted error", async () => {
    const fetchMock = vi.fn<FetchLike>(async (_input, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
      }),
    );
    const provider = new SeedreamProvider({
      apiKey,
      model: "doubao-seedream-4-0-250828",
      license: "provider-terms",
      timeoutMs: 5,
      fetch: fetchMock,
    });

    await expect(provider.execute({ assetId: "images/hero.jpg", prompt: "Hero" }))
      .rejects.toThrow("timed out");
  });

  it("redacts network failures and rejects declared oversized JSON before reading", async () => {
    const network = new SeedreamProvider({
      apiKey,
      model: "doubao-seedream-4-0-250828",
      license: "provider-terms",
      fetch: async () => { throw new Error(`socket failed with ${apiKey}`); },
    });
    await expect(network.execute({ assetId: "images/hero.jpg", prompt: "Hero" }))
      .rejects.toThrow("network request failed");
    try {
      await network.execute({ assetId: "images/hero.jpg", prompt: "Hero" });
    } catch (error) {
      expect(String(error)).not.toContain(apiKey);
    }

    let pulled = false;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled = true;
        controller.enqueue(new Uint8Array([123]));
        controller.close();
      },
    }, { highWaterMark: 0 });
    const oversized = new SeedreamProvider({
      apiKey,
      model: "doubao-seedream-4-0-250828",
      license: "provider-terms",
      maxOutputBytes: 4,
      fetch: async () => new Response(body, {
        status: 200,
        headers: { "Content-Length": "2000000" },
      }),
    });
    await expect(oversized.execute({ assetId: "images/hero.jpg", prompt: "Hero" }))
      .rejects.toThrow("JSON exceeded the byte limit");
    expect(pulled).toBe(false);
  });

  it("cancels chunked response JSON above its derived byte limit", async () => {
    let cancelled = false;
    let pulls = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1;
        controller.enqueue(new Uint8Array(600_000));
      },
      cancel() {
        cancelled = true;
      },
    });
    const provider = new SeedreamProvider({
      apiKey,
      model: "doubao-seedream-4-0-250828",
      license: "provider-terms",
      maxOutputBytes: 4,
      fetch: async () => new Response(body, { status: 200 }),
    });

    await expect(provider.execute({ assetId: "images/hero.jpg", prompt: "Hero" }))
      .rejects.toThrow("JSON exceeded the byte limit");
    expect(pulls).toBeLessThanOrEqual(3);
    expect(cancelled).toBe(true);
  });

  it("rejects a mismatched direct model but accepts endpoint model resolution", async () => {
    const response = () => new Response(JSON.stringify({
      model: "doubao-seedream-other",
      data: [{ b64_json: encodeBase64(jpegBytes) }],
    }), { status: 200 });
    const direct = new SeedreamProvider({
      apiKey,
      model: "doubao-seedream-4-0-250828",
      license: "provider-terms",
      fetch: async () => response(),
    });
    await expect(direct.execute({ assetId: "images/hero.jpg", prompt: "Hero" }))
      .rejects.toThrow("model did not match");

    const endpoint = new SeedreamProvider({
      apiKey,
      model: "ep-20260718000000-test",
      license: "provider-terms",
      fetch: async () => response(),
    });
    await expect(endpoint.execute({ assetId: "images/hero.jpg", prompt: "Hero" }))
      .resolves.toMatchObject({ provenance: { model: "doubao-seedream-other" } });
  });
});
