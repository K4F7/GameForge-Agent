export type TerminalInput = NodeJS.ReadStream;
export type TerminalOutput = Pick<NodeJS.WriteStream, "write" | "isTTY" | "columns" | "rows" | "on" | "off">;

export function renderWatchFrame(text: string, terminal: { isTTY?: boolean; columns?: number; rows?: number }): string {
  if (!terminal.isTTY) return `${text}\n`;
  const columns = Math.max(20, terminal.columns ?? 80);
  const rows = Math.max(4, terminal.rows ?? 24);
  const body = text.split("\n").slice(0, rows - 2).map((line) =>
    displayWidth(line) <= columns ? line : `${truncateCells(line, Math.max(1, columns - 1))}…`);
  body.push("q/Ctrl-C: exit");
  return `\u001b[2J\u001b[H${body.join("\n")}\n`;
}

function truncateCells(value: string, limit: number): string {
  let width = 0;
  let output = "";
  for (const character of value) {
    const next = characterWidth(character);
    if (width + next > limit) break;
    output += character;
    width += next;
  }
  return output;
}

function displayWidth(value: string): number {
  return [...value].reduce((total, character) => total + characterWidth(character), 0);
}

function characterWidth(character: string): number {
  const codePoint = character.codePointAt(0) ?? 0;
  if (/\p{Mark}/u.test(character)) return 0;
  return codePoint >= 0x1100 && (
    codePoint <= 0x115f || codePoint === 0x2329 || codePoint === 0x232a ||
    (codePoint >= 0x2e80 && codePoint <= 0xa4cf) ||
    (codePoint >= 0xac00 && codePoint <= 0xd7a3) ||
    (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
    (codePoint >= 0xfe10 && codePoint <= 0xfe6f) ||
    (codePoint >= 0xff00 && codePoint <= 0xff60) ||
    (codePoint >= 0x1f300 && codePoint <= 0x1faff)
  ) ? 2 : 1;
}

export function attachTerminalControls(options: {
  input: TerminalInput;
  output: TerminalOutput;
  onResize(): void;
}): { signal: AbortSignal; close(): void } {
  const controller = new AbortController();
  const interactive = options.input.isTTY === true && typeof options.input.setRawMode === "function";
  const onData = (chunk: Buffer | string): void => {
    const value = String(chunk);
    if (value.includes("q") || value.includes("Q") || value.includes("\u0003")) controller.abort();
  };
  if (interactive) {
    options.input.setRawMode(true);
    options.input.resume();
    options.input.on("data", onData);
  }
  options.output.on("resize", options.onResize);
  return {
    signal: controller.signal,
    close(): void {
      options.output.off("resize", options.onResize);
      if (interactive) {
        options.input.off("data", onData);
        options.input.setRawMode(false);
        options.input.pause();
      }
    },
  };
}
