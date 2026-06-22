/**
 * Minimal TTY readline helper for masked input (API key prompts).
 *
 * When mask=true: writes the prompt to stderr and reads input from stdin
 * without echoing — the key never appears on screen. Falls back to a plain
 * readline if setRawMode is unavailable (e.g. in some CI environments).
 */

import { createInterface } from "node:readline";

export interface ReadlineOptions {
  /** If true, suppress character echo (masked input). Default false. */
  mask?: boolean;
}

/**
 * Prompt the user for a line of input.
 * Output prompt is written to stderr; input is read from stdin.
 * When mask=true, characters are not echoed.
 */
export async function readlineSync(
  prompt: string,
  opts: ReadlineOptions = {},
): Promise<string> {
  return new Promise((resolve, reject) => {
    process.stderr.write(prompt);

    if (opts.mask && typeof process.stdin.setRawMode === "function") {
      // Raw mode: read char-by-char so we can suppress echo.
      process.stdin.setRawMode(true);
      process.stdin.resume();
      process.stdin.setEncoding("utf8");

      let input = "";
      const onData = (char: string) => {
        if (char === "\r" || char === "\n") {
          process.stdin.setRawMode(false);
          process.stdin.pause();
          process.stdin.removeListener("data", onData);
          process.stderr.write("\n");
          resolve(input);
        } else if (char === "") {
          // Ctrl+C
          process.stdin.setRawMode(false);
          process.stdin.pause();
          process.stdin.removeListener("data", onData);
          reject(new Error("Interrupted."));
        } else if (char === "" || char === "") {
          // Backspace
          input = input.slice(0, -1);
        } else {
          input += char;
        }
      };
      process.stdin.on("data", onData);
    } else {
      // Fallback: plain readline (visible input or non-TTY CI).
      const rl = createInterface({
        input: process.stdin,
        output: undefined, // suppress default echo (prompt already on stderr)
        terminal: false,
      });
      rl.once("line", (line) => {
        rl.close();
        resolve(line.trim());
      });
      rl.once("error", reject);
      rl.once("close", () => resolve(""));
    }
  });
}
