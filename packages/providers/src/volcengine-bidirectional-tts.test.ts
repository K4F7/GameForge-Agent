import { describe, expect, it } from "vitest";
import {
  decodeVolcengineTtsMessage,
  encodeVolcengineTtsMessage,
  VolcengineTtsEvent,
} from "./volcengine-bidirectional-tts.js";

describe("Volcengine bidirectional TTS protocol", () => {
  it("encodes the official StartConnection frame", () => {
    const frame = encodeVolcengineTtsMessage(
      VolcengineTtsEvent.StartConnection,
      new TextEncoder().encode("{}"),
    );
    expect([...frame]).toEqual([
      0x11, 0x14, 0x10, 0x00,
      0x00, 0x00, 0x00, 0x01,
      0x00, 0x00, 0x00, 0x02,
      0x7b, 0x7d,
    ]);
  });

  it("encodes session ids for session events", () => {
    const frame = encodeVolcengineTtsMessage(
      VolcengineTtsEvent.StartSession,
      new TextEncoder().encode("{}"),
      "session-1",
    );
    expect(new DataView(frame.buffer).getInt32(4, false)).toBe(100);
    expect(new DataView(frame.buffer).getUint32(8, false)).toBe(9);
    expect(new TextDecoder().decode(frame.slice(12, 21))).toBe("session-1");
  });

  it("decodes an audio response with session and payload", () => {
    const session = new TextEncoder().encode("session-1");
    const payload = Uint8Array.from([1, 2, 3]);
    const frame = new Uint8Array(4 + 4 + 4 + session.length + 4 + payload.length);
    const view = new DataView(frame.buffer);
    frame.set([0x11, 0xb4, 0x00, 0x00]);
    view.setInt32(4, VolcengineTtsEvent.TTSResponse, false);
    view.setUint32(8, session.length, false);
    frame.set(session, 12);
    view.setUint32(12 + session.length, payload.length, false);
    frame.set(payload, 16 + session.length);
    const decoded = decodeVolcengineTtsMessage(frame);
    expect(decoded.event).toBe(VolcengineTtsEvent.TTSResponse);
    expect(decoded.sessionId).toBe("session-1");
    expect([...decoded.payload]).toEqual([1, 2, 3]);
  });
});
