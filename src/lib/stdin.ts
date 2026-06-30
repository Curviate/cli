/**
 * Stdin reading utility for CLI commands.
 *
 * Used when the TEXT positional is exactly "-": reads all of stdin until EOF,
 * strips trailing newlines, and returns the result. Empty input exits 2.
 */

/**
 * Read all bytes from stdin until EOF, strip trailing newlines, and return
 * the result as a UTF-8 string. Internal newlines are preserved.
 *
 * In tests, inject a mock reader instead of calling this directly so tests
 * remain hermetic (the real stdin blocks on a TTY).
 */
export async function defaultReadStdin(): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = [];
    process.stdin.on("data", (chunk: Buffer | string) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string));
    });
    process.stdin.on("end", () => {
      const full = Buffer.concat(chunks).toString("utf8");
      // Strip trailing newlines only — internal newlines are preserved.
      resolve(full.replace(/\n+$/, ""));
    });
    process.stdin.on("error", reject);
  });
}

/**
 * Resolve the TEXT positional: if exactly "-", call the injected stdin reader
 * (or `defaultReadStdin`). Exits 2 with "stdin: empty input" when stdin is
 * empty after trimming.
 *
 * @param rawText   The raw value from the positional argument.
 * @param onError   Writes the error message (stderr.write equivalent).
 * @param onExit    Calls process.exit with the given code.
 * @param readStdin Optional injected stdin reader (for tests).
 */
export async function resolveTextOrStdin(
  rawText: string,
  out: { stderr: { write: (s: string) => void } },
  readStdin?: () => Promise<string>,
): Promise<string> {
  if (rawText !== "-") return rawText;
  const reader = readStdin ?? defaultReadStdin;
  const text = await reader();
  if (!text) {
    out.stderr.write("error: stdin: empty input\n");
    process.exit(2);
  }
  return text;
}
