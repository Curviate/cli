/**
 * Non-list command flag suppression tests.
 *
 * Write commands and single-object read commands must NOT expose pagination
 * flags (--limit, --cursor, --all, --max-pages) in their help. Write commands
 * additionally must NOT expose --fields. Single-object reads may keep --fields.
 *
 * Read list commands (inbox list, inbox messages) MUST retain all pagination
 * flags.
 *
 * Strategy: inspect the `args` object on each subcommand definition directly.
 * `defineCommand` is an identity function in citty, so `.subCommands.create.args`
 * is the raw args object whose keys ARE the registered flags.
 */

import { describe, it, expect } from "vitest";

/** Flags that must NEVER appear on write commands or single-object non-list reads. */
const PAGINATION_ONLY_FLAGS = ["limit", "cursor", "all", "max-pages"] as const;

/** Flags that must NEVER appear on write commands (superset of pagination-only). */
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

  it("post reactions (read) — args definition DOES have pagination flags (negative control)", async () => {
    const { postCommand } = await import("../../src/commands/post.js");
    const subCmds = (postCommand as Record<string, unknown>).subCommands as Record<string, { args?: Record<string, unknown> }>;
    const reactionsArgs = subCmds["reactions"]?.args ?? {};

    expect(reactionsArgs, "post reactions must have --limit").toHaveProperty("limit");
    expect(reactionsArgs, "post reactions must have --cursor").toHaveProperty("cursor");
    expect(reactionsArgs, "post reactions must have --all").toHaveProperty("all");
  });
});

// ---------------------------------------------------------------------------
// message write commands — no pagination or projection flags in help
// ---------------------------------------------------------------------------

describe("message write commands — no pagination flags in help", () => {
  it("message new (write) — args definition has no pagination or projection flags", async () => {
    const { messageCommand } = await import("../../src/commands/message.js");
    const subCmds = (messageCommand as Record<string, unknown>).subCommands as Record<string, { args?: Record<string, unknown> }>;
    const args = subCmds["new"]?.args ?? {};

    for (const flag of PAGINATION_FLAGS) {
      expect(args, `message new args must NOT include --${flag}`).not.toHaveProperty(flag);
    }
  });

  it("message edit (write) — args definition has no pagination or projection flags", async () => {
    const { messageCommand } = await import("../../src/commands/message.js");
    const subCmds = (messageCommand as Record<string, unknown>).subCommands as Record<string, { args?: Record<string, unknown> }>;
    const args = subCmds["edit"]?.args ?? {};

    for (const flag of PAGINATION_FLAGS) {
      expect(args, `message edit args must NOT include --${flag}`).not.toHaveProperty(flag);
    }
  });

  it("message delete (write) — args definition has no pagination or projection flags", async () => {
    const { messageCommand } = await import("../../src/commands/message.js");
    const subCmds = (messageCommand as Record<string, unknown>).subCommands as Record<string, { args?: Record<string, unknown> }>;
    const args = subCmds["delete"]?.args ?? {};

    for (const flag of PAGINATION_FLAGS) {
      expect(args, `message delete args must NOT include --${flag}`).not.toHaveProperty(flag);
    }
  });

  it("message react (write) — args definition has no pagination or projection flags", async () => {
    const { messageCommand } = await import("../../src/commands/message.js");
    const subCmds = (messageCommand as Record<string, unknown>).subCommands as Record<string, { args?: Record<string, unknown> }>;
    const args = subCmds["react"]?.args ?? {};

    for (const flag of PAGINATION_FLAGS) {
      expect(args, `message react args must NOT include --${flag}`).not.toHaveProperty(flag);
    }
  });

  it("message inmail (write) — args definition has no pagination or projection flags", async () => {
    const { messageCommand } = await import("../../src/commands/message.js");
    const subCmds = (messageCommand as Record<string, unknown>).subCommands as Record<string, { args?: Record<string, unknown> }>;
    const args = subCmds["inmail"]?.args ?? {};

    for (const flag of PAGINATION_FLAGS) {
      expect(args, `message inmail args must NOT include --${flag}`).not.toHaveProperty(flag);
    }
  });

  it("message send (root command, write) — root args definition has no pagination or projection flags", async () => {
    const { messageCommand } = await import("../../src/commands/message.js");
    const args = (messageCommand as Record<string, unknown>).args as Record<string, unknown>;

    for (const flag of PAGINATION_FLAGS) {
      expect(args, `message send (root args) must NOT include --${flag}`).not.toHaveProperty(flag);
    }
  });
});

// ---------------------------------------------------------------------------
// message single-object reads — no pagination flags (--fields allowed)
// ---------------------------------------------------------------------------

describe("message single-object read commands — no pagination flags in help (fields allowed)", () => {
  it("message get — no pagination-only flags", async () => {
    const { messageCommand } = await import("../../src/commands/message.js");
    const subCmds = (messageCommand as Record<string, unknown>).subCommands as Record<string, { args?: Record<string, unknown> }>;
    const args = subCmds["get"]?.args ?? {};

    for (const flag of PAGINATION_ONLY_FLAGS) {
      expect(args, `message get args must NOT include --${flag}`).not.toHaveProperty(flag);
    }
  });

  it("message attachment — no pagination-only flags", async () => {
    const { messageCommand } = await import("../../src/commands/message.js");
    const subCmds = (messageCommand as Record<string, unknown>).subCommands as Record<string, { args?: Record<string, unknown> }>;
    const args = subCmds["attachment"]?.args ?? {};

    for (const flag of PAGINATION_ONLY_FLAGS) {
      expect(args, `message attachment args must NOT include --${flag}`).not.toHaveProperty(flag);
    }
  });

  it("message inmail-balance — no pagination-only flags", async () => {
    const { messageCommand } = await import("../../src/commands/message.js");
    const subCmds = (messageCommand as Record<string, unknown>).subCommands as Record<string, { args?: Record<string, unknown> }>;
    const args = subCmds["inmail-balance"]?.args ?? {};

    for (const flag of PAGINATION_ONLY_FLAGS) {
      expect(args, `message inmail-balance args must NOT include --${flag}`).not.toHaveProperty(flag);
    }
  });
});

// ---------------------------------------------------------------------------
// inbox non-list commands — no pagination flags in help
// ---------------------------------------------------------------------------

describe("inbox non-list commands — no pagination flags in help", () => {
  it("inbox get (single-object read) — no pagination-only flags", async () => {
    const { inboxCommand } = await import("../../src/commands/inbox.js");
    const subCmds = (inboxCommand as Record<string, unknown>).subCommands as Record<string, { args?: Record<string, unknown> }>;
    const args = subCmds["get"]?.args ?? {};

    for (const flag of PAGINATION_ONLY_FLAGS) {
      expect(args, `inbox get args must NOT include --${flag}`).not.toHaveProperty(flag);
    }
  });

  it("inbox mark-read (write) — no pagination-only flags", async () => {
    const { inboxCommand } = await import("../../src/commands/inbox.js");
    const subCmds = (inboxCommand as Record<string, unknown>).subCommands as Record<string, { args?: Record<string, unknown> }>;
    const args = subCmds["mark-read"]?.args ?? {};

    for (const flag of PAGINATION_ONLY_FLAGS) {
      expect(args, `inbox mark-read args must NOT include --${flag}`).not.toHaveProperty(flag);
    }
  });

  it("inbox list (list read) — DOES have pagination flags (negative control)", async () => {
    const { inboxCommand } = await import("../../src/commands/inbox.js");
    const subCmds = (inboxCommand as Record<string, unknown>).subCommands as Record<string, { args?: Record<string, unknown> }>;
    const listArgs = subCmds["list"]?.args ?? {};

    expect(listArgs, "inbox list must have --limit").toHaveProperty("limit");
    expect(listArgs, "inbox list must have --cursor").toHaveProperty("cursor");
    expect(listArgs, "inbox list must have --all").toHaveProperty("all");
  });

  it("inbox messages (list read) — DOES have pagination flags (negative control)", async () => {
    const { inboxCommand } = await import("../../src/commands/inbox.js");
    const subCmds = (inboxCommand as Record<string, unknown>).subCommands as Record<string, { args?: Record<string, unknown> }>;
    const messagesArgs = subCmds["messages"]?.args ?? {};

    expect(messagesArgs, "inbox messages must have --limit").toHaveProperty("limit");
    expect(messagesArgs, "inbox messages must have --cursor").toHaveProperty("cursor");
    expect(messagesArgs, "inbox messages must have --all").toHaveProperty("all");
  });
});
