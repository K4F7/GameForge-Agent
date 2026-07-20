export type TerminalInput = NodeJS.ReadStream;
export type TerminalOutput = Pick<NodeJS.WriteStream, "write" | "isTTY" | "columns" | "rows" | "on" | "off">;

export function renderWatchFrame(
  text: string,
  terminal: { isTTY?: boolean; columns?: number; rows?: number },
  lineOffset = 0,
): string {
  if (!terminal.isTTY) return `${text}\n`;
  const columns = Math.max(20, terminal.columns ?? 80);
  const rows = Math.max(4, terminal.rows ?? 24);
  const lines = text.length === 0 ? [] : text.split("\n");
  const capacity = rows - 2;
  const start = Math.min(Math.max(0, lineOffset), Math.max(0, lines.length - capacity));
  const body = lines.slice(start, start + capacity).map((line) =>
    displayWidth(line) <= columns ? line : `${truncateCells(line, Math.max(1, columns - 1))}…`);
  const range = `${lines.length === 0 ? 0 : start + 1}-${Math.min(lines.length, start + capacity)}/${lines.length}`;
  body.push(truncateCells(`↑↓/jk/Pg: scroll q:^C ${range}`, columns));
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
  onScroll?(lines: number): void;
}): { signal: AbortSignal; close(): void } {
  const controller = new AbortController();
  const interactive = options.input.isTTY === true && typeof options.input.setRawMode === "function";
  let inputBuffer = "";
  const onData = (chunk: Buffer | string): void => {
    inputBuffer += String(chunk);
    const consume = (token: string, lines: number): void => {
      let index = inputBuffer.indexOf(token);
      while (index >= 0) {
        options.onScroll?.(lines);
        inputBuffer = `${inputBuffer.slice(0, index)}${inputBuffer.slice(index + token.length)}`;
        index = inputBuffer.indexOf(token);
      }
    };
    consume("\u001b[6~", 5);
    consume("\u001b[5~", -5);
    consume("\u001b[B", 1);
    consume("\u001b[A", -1);
    consume("j", 1);
    consume("k", -1);
    if (inputBuffer.includes("q") || inputBuffer.includes("Q") || inputBuffer.includes("\u0003")) controller.abort();
    const escape = inputBuffer.lastIndexOf("\u001b");
    inputBuffer = escape < 0 ? "" : inputBuffer.slice(escape, escape + 8);
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
