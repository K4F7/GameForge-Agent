import { describe, expect, it, vi } from "vitest";
import type { FetchLike } from "./seedream.js";
import { VolcengineAsyncTtsProvider } from "./volcengine-async-tts.js";

const token = "test-token-never-log";
const baseRequest = {
  projectId: "safety-sprint",
  assetId: "voices/guide",
  text: "请收集所有安全装备。",
  voiceType: "BV001_streaming",
  format: "mp3" as const,
};

function provider(fetch: FetchLike): VolcengineAsyncTtsProvider {
  return new VolcengineAsyncTtsProvider({
    apiToken: token,
    appId: "test-app-id",
    license: "volcengine-account-terms",
    allowedAudioHosts: ["audio.example.volces.com"],
    fetch,
  });
}

describe("VolcengineAsyncTtsProvider", () => {
  it("submits and queries one officially authenticated asynchronous job", async () => {
    const fetchMock = vi.fn<FetchLike>()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        task_id: "task-42",
        task_status: 0,
        text_length: 11,
      }), { status: 200, headers: { "Content-Type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        task_id: "task-42",
        task_status: 0,
        text_length: 11,
      }), { status: 200, headers: { "Content-Type": "application/json" } }));
    const tts = provider(fetchMock);

    const submitted = await tts.submit(baseRequest);
    const queried = await tts.query({ projectId: baseRequest.projectId, jobHandle: submitted.jobHandle });

    expect(submitted).toMatchObject({ taskId: "task-42", status: "processing" });
    expect(queried).toMatchObject({ taskId: "task-42", status: "processing" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [submitUrl, submitInit] = fetchMock.mock.calls[0] ?? [];
    expect(String(submitUrl)).toBe("https://openspeech.bytedance.com/api/v1/tts_async/submit");
    expect(submitInit?.headers).toMatchObject({
      Authorization: `Bearer; ${token}`,
      "Resource-Id": "volc.tts_async.default",
    });
    expect(JSON.parse(String(submitInit?.body))).toMatchObject({
      appid: "test-app-id",
      text: baseRequest.text,
      voice_type: baseRequest.voiceType,
      format: "mp3",
    });
    const queryUrl = new URL(String(fetchMock.mock.calls[1]?.[0]));
    expect(`${queryUrl.origin}${queryUrl.pathname}`).toBe("https://openspeech.bytedance.com/api/v1/tts_async/query");
    expect(queryUrl.searchParams.get("task_id")).toBe("task-42");
  });

  it("materializes one ready job with verified bytes and provenance", async () => {
    const audio = new Uint8Array([0x49, 0x44, 0x33, 0x04]);
    const fetchMock = vi.fn<FetchLike>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ task_id: "task-42", task_status: 0 }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        task_id: "task-42",
        task_status: 1,
        audio_url: "https://audio.example.volces.com/output/task-42.mp3?signature=safe",
        url_expire_time: 1_800_000_000,
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(audio, {
        status: 200,
        headers: { "Content-Type": "audio/mpeg", "Content-Length": String(audio.length) },
      }));
    const tts = provider(fetchMock);
    const submitted = await tts.submit(baseRequest);

    const result = await tts.materialize({ projectId: baseRequest.projectId, jobHandle: submitted.jobHandle });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(result).toMatchObject({
      mimeType: "audio/mpeg",
      provenance: {
        assetId: "voices/guide",
        kind: "voice",
        origin: "generated",
        provider: "volcengine-speech",
        model: "BV001_streaming",
      },
    });
    expect(result.provenance.prompt).toBe(baseRequest.text);
    expect(result.provenance.sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it("rejects tampered, cross-project, untrusted-host, and spoofed audio results", async () => {
    const fetchMock = vi.fn<FetchLike>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ task_id: "task-42", task_status: 0 }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        task_id: "task-42",
        task_status: 1,
        audio_url: "https://attacker.example/output.mp3",
      }), { status: 200 }));
    const tts = provider(fetchMock);
    const submitted = await tts.submit(baseRequest);
    const tampered = `${submitted.jobHandle.slice(0, -1)}${submitted.jobHandle.endsWith("a") ? "b" : "a"}`;

    await expect(tts.query({ projectId: baseRequest.projectId, jobHandle: tampered })).rejects.toThrow("invalid");
    await expect(tts.query({ projectId: "another-project", jobHandle: submitted.jobHandle })).rejects.toThrow("belong");
    await expect(tts.materialize({ projectId: baseRequest.projectId, jobHandle: submitted.jobHandle })).rejects.toThrow("allowed");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("redacts credentials from upstream errors", async () => {
    const fetchMock = vi.fn<FetchLike>(async () => new Response(token, { status: 401 }));
    let message = "";
    try {
      await provider(fetchMock).submit(baseRequest);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toContain("HTTP 401");
    expect(message).not.toContain(token);
  });
});
