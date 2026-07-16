import { describe, expect, it, vi } from "vitest";
import { FreesoundPreviewProvider } from "./freesound-preview.js";
import type { FreesoundFetchLike } from "./freesound.js";

const request = {
  assetId: "sounds/impact",
  soundId: 42,
  name: "Metal impact",
  username: "sound-author",
  license: "Attribution" as const,
  sourceUrl: "https://freesound.org/people/sound-author/sounds/42/",
  previewUrl: "https://cdn.freesound.org/previews/0/42_1-hq.mp3",
};

describe("FreesoundPreviewProvider", () => {
  it("downloads one official preview and records attribution", async () => {
    const fetchMock = vi.fn<FreesoundFetchLike>(async () =>
      new Response(new Uint8Array([0x49, 0x44, 0x33, 0x04]), { status: 200 }),
    );
    const result = await new FreesoundPreviewProvider({ fetch: fetchMock }).execute(request);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      mimeType: "audio/mpeg",
      provenance: { origin: "retrieved", license: "Freesound Attribution" },
    });
    expect(result.provenance.attribution).toContain("sound-author");
  });

  it("rejects redirects, untrusted hosts, and media spoofing", async () => {
    const fetchMock = vi.fn<FreesoundFetchLike>(async () =>
      new Response(new Uint8Array([1, 2, 3, 4]), { status: 200 }),
    );
    const provider = new FreesoundPreviewProvider({ fetch: fetchMock });
    await expect(provider.execute({ ...request, previewUrl: "https://attacker.example/previews/a.mp3" }))
      .rejects.toThrow("official");
    await expect(provider.execute(request)).rejects.toThrow("unsupported audio format");
  });
});
