/**
 * Single-cue regression: the tier-1b interactive-TTY stdin read used to
 * print `STDIN_TTY_CUE` TWICE on a real terminal — once from this module's
 * own `out.stderr.write(STDIN_TTY_CUE)`, and a second time because the
 * default reader passed the cue text straight through to `readlineSync`,
 * which itself writes its `prompt` argument to stderr.
 *
 * Isolated in its own file (rather than added to credential-resolve.test.ts)
 * because it needs `readline.js` mocked at module scope to observe what the
 * library-internal `defaultReadSingleLine` passes through — none of the
 * other resolveSecret tests touch the real default (they always inject
 * `readSingleLine`), so this mock would otherwise sit unused noise in the
 * main file.
 */
import { describe, it, expect, vi } from "vitest";
import type { Mock } from "vitest";

vi.mock("../../src/lib/readline.js", () => ({
  readlineSync: vi.fn(async () => "TTY_VALUE"),
}));

describe("resolveSecret — single cue via the library's own default reader", () => {
  it("stdinRequested + isTTY, no readSingleLine override: out.stderr gets the cue exactly once, and the underlying readlineSync is called with an EMPTY prompt (not the cue)", async () => {
    const { resolveSecret } = await import("../../src/lib/credential-resolve.js");
    const { readlineSync } = await import("../../src/lib/readline.js");
    const out = { stderr: { write: vi.fn() } };

    const value = await resolveSecret({
      stdinRequested: true,
      isTTY: true,
      envVar: "CURVIATE_TEST_SECRET_CUE",
      required: true,
      failMessage: "no secret",
      out,
      // readSingleLine deliberately omitted — exercises defaultReadSingleLine.
    });

    expect(value).toBe("TTY_VALUE");

    const cueWrites = (out.stderr.write as Mock).mock.calls.filter(
      (c) => (c[0] as string) === "Reading secret from stdin (paste + Enter): ",
    );
    expect(cueWrites).toHaveLength(1);

    // The underlying readlineSync must never receive the cue text as its
    // prompt — it would write it to stderr again.
    expect(readlineSync).toHaveBeenCalledWith("", { mask: true });
  });
});
