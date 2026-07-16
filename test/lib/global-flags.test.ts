/**
 * Tests for the shared `--verbose` flag description in src/lib/global-flags.ts
 * (WP6-B Fix 4b).
 *
 * `GLOBAL_FLAGS.verbose` is spread into EVERY command's `args`, so its
 * description is the `--verbose` help text for every command in the CLI —
 * including the many list-read commands (`company followers`, `company
 * chats`, `company chat`, `company messages`, `company message`,
 * `company search-chats`, and others) that pass NO `slim` option to
 * `renderSuccess` at all, i.e. have no slim default whatsoever. The prior
 * text — "Output the full SDK response instead of the slim default." —
 * promised a bypass that does not exist for those commands: --verbose is a
 * silent no-op there. The description must not claim a universal behavior
 * the flag does not have on most commands; it must describe the flag itself,
 * conditionally.
 */

import { describe, it, expect } from "vitest";
import { GLOBAL_FLAGS } from "../../src/lib/global-flags.js";

describe("GLOBAL_FLAGS.verbose — honest description (WP6-B Fix 4b)", () => {
  it("does not unconditionally claim to bypass 'the slim default', as if every command has one", () => {
    // The old, over-promising text this test replaces.
    expect(GLOBAL_FLAGS.verbose.description).not.toBe(
      "Output the full SDK response instead of the slim default.",
    );
  });

  it("makes the conditional/no-op case explicit — a command with no slim default is unaffected", () => {
    expect(GLOBAL_FLAGS.verbose.description).toMatch(/no-op|no effect|only.*command.*slim|if.*has a slim/i);
  });
});
