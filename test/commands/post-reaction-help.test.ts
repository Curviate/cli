/**
 * TS-021 — AC-022 (FR-020, REQ-058)
 *
 * `post react --reaction` help must show the HONEST-SPLIT enum table:
 *   Write values (accepted): like, celebrate, support, love, insightful, funny
 *   Read values (reaction_type vocabulary): LIKE, PRAISE, APPRECIATION, EMPATHY, INTEREST, ENTERTAINMENT
 *   Confirmed mappings: like→LIKE, celebrate→PRAISE, insightful→INTEREST (stated as fact)
 *   Support/love/funny: valid write values; read pairings NOT confirmed → NOT presented as 1:1
 *   SUPPORT and FUNNY must NOT appear as uppercase read values (they are NOT in the read enum)
 *
 * Strategy: inspect the `description` of `--reaction` in the command args definition.
 */

import { describe, it, expect } from "vitest";

describe("post react --reaction description — honest-split enum table (AC-022, FR-020)", () => {
  it("description contains all 6 write-side values (lowercase)", async () => {
    const { postCommand } = await import("../../src/commands/post.js");
    const subCmds = (postCommand as Record<string, unknown>).subCommands as Record<
      string,
      { args?: Record<string, { description?: string }> }
    >;
    const reactArgs = subCmds["react"]?.args ?? {};
    const desc = reactArgs["reaction"]?.description ?? "";

    expect(desc).toContain("like");
    expect(desc).toContain("celebrate");
    expect(desc).toContain("support");
    expect(desc).toContain("love");
    expect(desc).toContain("insightful");
    expect(desc).toContain("funny");
  });

  it("description contains all 6 read-side values (uppercase)", async () => {
    const { postCommand } = await import("../../src/commands/post.js");
    const subCmds = (postCommand as Record<string, unknown>).subCommands as Record<
      string,
      { args?: Record<string, { description?: string }> }
    >;
    const reactArgs = subCmds["react"]?.args ?? {};
    const desc = reactArgs["reaction"]?.description ?? "";

    expect(desc).toContain("LIKE");
    expect(desc).toContain("PRAISE");
    expect(desc).toContain("APPRECIATION");
    expect(desc).toContain("EMPATHY");
    expect(desc).toContain("INTEREST");
    expect(desc).toContain("ENTERTAINMENT");
  });

  it("SUPPORT does NOT appear as uppercase read value (it is not in the read enum)", async () => {
    const { postCommand } = await import("../../src/commands/post.js");
    const subCmds = (postCommand as Record<string, unknown>).subCommands as Record<
      string,
      { args?: Record<string, { description?: string }> }
    >;
    const reactArgs = subCmds["react"]?.args ?? {};
    const desc = reactArgs["reaction"]?.description ?? "";

    // 'support' (lowercase) IS expected (write value); 'SUPPORT' (uppercase) must NOT appear
    expect(desc).not.toMatch(/\bSUPPORT\b/);
  });

  it("FUNNY does NOT appear as uppercase read value (it is not in the read enum)", async () => {
    const { postCommand } = await import("../../src/commands/post.js");
    const subCmds = (postCommand as Record<string, unknown>).subCommands as Record<
      string,
      { args?: Record<string, { description?: string }> }
    >;
    const reactArgs = subCmds["react"]?.args ?? {};
    const desc = reactArgs["reaction"]?.description ?? "";

    // 'funny' (lowercase) IS expected (write value); 'FUNNY' (uppercase) must NOT appear
    expect(desc).not.toMatch(/\bFUNNY\b/);
  });

  it("confirmed mappings stated: like→LIKE, celebrate→PRAISE, insightful→INTEREST", async () => {
    const { postCommand } = await import("../../src/commands/post.js");
    const subCmds = (postCommand as Record<string, unknown>).subCommands as Record<
      string,
      { args?: Record<string, { description?: string }> }
    >;
    const reactArgs = subCmds["react"]?.args ?? {};
    const desc = reactArgs["reaction"]?.description ?? "";

    // Confirmed mappings must appear — accept any separator (→, =, :, →)
    expect(desc).toMatch(/like.*LIKE|LIKE.*like/);
    expect(desc).toMatch(/celebrate.*PRAISE|PRAISE.*celebrate/);
    expect(desc).toMatch(/insightful.*INTEREST|INTEREST.*insightful/);
  });
});
