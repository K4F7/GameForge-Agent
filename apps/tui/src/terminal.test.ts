import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { attachTerminalControls, renderWatchFrame } from "./terminal.js";

describe("TUI terminal", () => {
  it("renders plain output when redirected and bounded ANSI output in a TTY", () => {
    expect(renderWatchFrame("one\ntwo", { isTTY: false })).toBe("one\ntwo\n");
    const frame = renderWatchFrame("1234567890123456789012345\ntwo\nthree\nfour", { isTTY: true, columns: 20, rows: 4 });
    expect(frame).toContain("\u001b[2J\u001b[H");
    expect(frame).toContain("1234567890123456789…");
    expect(frame).toContain("scroll");
    expect(frame).not.toContain("three");
    expect(renderWatchFrame("中文中文中文中文中文中文", { isTTY: true, columns: 20, rows: 4 }))
      .toContain("中文中文中文中文中…");
  });

  it("scrolls a bounded TTY frame without changing redirected output", () => {
    const text = "one\ntwo\nthree\nfour\nfive";
    const frame = renderWatchFrame(text, { isTTY: true, columns: 40, rows: 5 }, 2);
    expect(frame).toContain("three");
    expect(frame).toContain("five");
    expect(frame).not.toContain("one");
    expect(frame).toContain("3-5/5");
    expect(renderWatchFrame(text, { isTTY: false }, 3)).toBe(`${text}\n`);
    expect(renderWatchFrame("", { isTTY: true, columns: 30, rows: 5 })).toContain("0-0/0");
  });

  it("redraws on resize, aborts on q, and restores raw mode", () => {
    const input = new EventEmitter() as EventEmitter & NodeJS.ReadStream;
    Object.assign(input, { isTTY: true, setRawMode: vi.fn(), resume: vi.fn(), pause: vi.fn() });
    const output = new EventEmitter() as EventEmitter & NodeJS.WriteStream;
    Object.assign(output, { isTTY: true, columns: 80, rows: 24, write: vi.fn() });
    const onResize = vi.fn();
    const onScroll = vi.fn();
    const controls = attachTerminalControls({ input, output, onResize, onScroll });
    output.emit("resize");
    input.emit("data", Buffer.from("j"));
    input.emit("data", Buffer.from("\u001b[A"));
    input.emit("data", Buffer.from("\u001b[6~"));
    input.emit("data", Buffer.from("\u001b[5~"));
    input.emit("data", Buffer.from("\u001b["));
    input.emit("data", Buffer.from("B"));
    input.emit("data", Buffer.from("jj"));
    input.emit("data", Buffer.from("q"));
    expect(onResize).toHaveBeenCalledOnce();
    expect(controls.signal.aborted).toBe(true);
    expect(onScroll.mock.calls.map(([value]) => value)).toEqual([1, -1, 5, -5, 1, 1, 1]);
    controls.close();
    expect(input.setRawMode).toHaveBeenNthCalledWith(1, true);
    expect(input.setRawMode).toHaveBeenLastCalledWith(false);
  });
});
