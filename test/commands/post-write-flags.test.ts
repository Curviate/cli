/**
 * post write commands — no pagination flags exposed in help
 *
 * Write commands (post create, post comment, post react) must NOT expose
 * pagination/projection flags in their help (citty args definition).
 *
 * Read commands (post list, post comments, post reactions) MUST have them.
 *
 * Strategy: inspect the `args` object on each subcommand definition directly.
 * `defineCommand` is an identity function in citty, so `.subCommands.create.args`
 * is the raw args object whose keys ARE the registered flags.
 */

import { describe, it, expect } from "vitest";

const PAGINATION_FLAGS = ["limit", "cursor", "all", "max-pages", "fields"] as const;

describe("post write commands — no pagination flags in help", () => {
  it("post create — args definition has no pagination/projection flags", async () => {
    const { postCommand } = await import("../../src/commands/post.js");
    const subCmds = (postCommand as Record<string, unknown>).subCommands as Record<string, { args?: Record<string, unknown> }>;
    const createArgs = subCmds["create"]?.args ?? {};

    for (const flag of PAGINATION_FLAGS) {
      expect(
        createArgs,
        `post create args must NOT include --${flag}`,
      ).not.toHaveProperty(flag);
    }
  });

  it("post comment (write) — args definition has no pagination/projection flags", async () => {
    const { postCommand } = await import("../../src/commands/post.js");
    const subCmds = (postCommand as Record<string, unknown>).subCommands as Record<string, { args?: Record<string, unknown> }>;
    const commentArgs = subCmds["comment"]?.args ?? {};

    for (const flag of PAGINATION_FLAGS) {
      expect(
        commentArgs,
        `post comment args must NOT include --${flag}`,
      ).not.toHaveProperty(flag);
    }
  });

  it("post react — args definition has no pagination/projection flags", async () => {
    const { postCommand } = await import("../../src/commands/post.js");
    const subCmds = (postCommand as Record<string, unknown>).subCommands as Record<string, { args?: Record<string, unknown> }>;
    const reactArgs = subCmds["react"]?.args ?? {};

    for (const flag of PAGINATION_FLAGS) {
      expect(
        reactArgs,
        `post react args must NOT include --${flag}`,
      ).not.toHaveProperty(flag);
    }
  });

  it("post list (read) — args definition DOES have pagination flags (negative control)", async () => {
    const { postCommand } = await import("../../src/commands/post.js");
    const subCmds = (postCommand as Record<string, unknown>).subCommands as Record<string, { args?: Record<string, unknown> }>;
    const listArgs = subCmds["list"]?.args ?? {};

    expect(listArgs, "post list must have --limit").toHaveProperty("limit");
    expect(listArgs, "post list must have --cursor").toHaveProperty("cursor");
    expect(listArgs, "post list must have --all").toHaveProperty("all");
  });

  it("post comments (read) — args definition DOES have pagination flags", async () => {
    const { postCommand } = await import("../../src/commands/post.js");
    const subCmds = (postCommand as Record<string, unknown>).subCommands as Record<string, { args?: Record<string, unknown> }>;
    const commentsArgs = subCmds["comments"]?.args ?? {};

    expect(commentsArgs, "post comments must have --limit").toHaveProperty("limit");
    expect(commentsArgs, "post comments must have --cursor").toHaveProperty("cursor");
    expect(commentsArgs, "post comments must have --all").toHaveProperty("all");
  });
});
