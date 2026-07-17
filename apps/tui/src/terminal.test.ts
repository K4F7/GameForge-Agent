import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { attachTerminalControls, renderWatchFrame } from "./terminal.js";

describe("TUI terminal", () => {
  it("renders plain output when redirected and bounded ANSI output in a TTY", () => {
    expect(renderWatchFrame("one\ntwo", { isTTY: false })).toBe("one\ntwo\n");
    const frame = renderWatchFrame("1234567890123456789012345\ntwo\nthree\nfour", { isTTY: true, columns: 20, rows: 4 });
    expect(frame).toContain("\u001b[2J\u001b[H");
    expect(frame).toContain("1234567890123456789…");
    expect(frame).toContain("q/Ctrl-C: exit");
    expect(frame).not.toContain("three");
    expect(renderWatchFrame("中文中文中文中文中文中文", { isTTY: true, columns: 20, rows: 4 }))
      .toContain("中文中文中文中文中…");
  });

  it("redraws on resize, aborts on q, and restores raw mode", () => {
    const input = new EventEmitter() as EventEmitter & NodeJS.ReadStream;
    Object.assign(input, { isTTY: true, setRawMode: vi.fn(), resume: vi.fn(), pause: vi.fn() });
    const output = new EventEmitter() as EventEmitter & NodeJS.WriteStream;
    Object.assign(output, { isTTY: true, columns: 80, rows: 24, write: vi.fn() });
    const onResize = vi.fn();
    const controls = attachTerminalControls({ input, output, onResize });
    output.emit("resize");
    input.emit("data", Buffer.from("q"));
    expect(onResize).toHaveBeenCalledOnce();
    expect(controls.signal.aborted).toBe(true);
    controls.close();
    expect(input.setRawMode).toHaveBeenNthCalledWith(1, true);
    expect(input.setRawMode).toHaveBeenLastCalledWith(false);
  });
});
