/**
 * `account` single-resource write/checkpoint command flag suppression, and
 * the checkpoint-hint note in `link`/`reconnect` help.
 *
 * `link`, `connect-link`, `reconnect`, `refresh`, `update`, `disconnect`, and
 * `checkpoint submit`/`checkpoint poll` are all single-resource mutations —
 * pagination flags (`--limit`, `--cursor`, `--all`, `--max-pages`) have no
 * meaning on a one-row response, but `--fields` is still useful to project
 * it. They use the single-object write flag set (pagination suppressed,
 * `--fields` kept) instead of the full global flag set.
 *
 * `account list` is a genuine list read and is unaffected — kept here only
 * as a negative control so a future regression shows up immediately.
 *
 * `link`/`reconnect` also carry a one-line note in their description about
 * the checkpoint-required path: an interactive prompt on a TTY, or a
 * distinct exit code plus a follow-up command off one.
 *
 * Strategy: inspect the `args`/`meta` on each subcommand definition
 * directly. `defineCommand` is an identity function in citty, so
 * `.subCommands.<name>.args` is the raw args object whose keys ARE the
 * registered flags (same approach as the post/message/inbox flag-suppression
 * tests).
 */

import { describe, it, expect } from "vitest";

/** Flags that must NEVER appear on these commands (pagination-only; --fields is kept). */
const PAGINATION_ONLY_FLAGS = ["limit", "cursor", "all", "max-pages"] as const;

type SubCommandMap = Record<string, { args?: Record<string, unknown>; meta?: { description?: string }; subCommands?: SubCommandMap }>;

async function loadAccountSubCommands(): Promise<SubCommandMap> {
  const { accountCommand } = await import("../../src/commands/account.js");
  return (accountCommand as unknown as { subCommands: SubCommandMap }).subCommands;
}

const SINGLE_WRITE_COMMANDS = ["link", "connect-link", "reconnect", "refresh", "update", "disconnect"] as const;

describe("account single-resource write commands — pagination flags suppressed, --fields kept", () => {
  for (const name of SINGLE_WRITE_COMMANDS) {
    it(`account ${name} — args definition has no pagination-only flags, keeps --fields`, async () => {
      const subCmds = await loadAccountSubCommands();
      const args = subCmds[name]?.args ?? {};

      for (const flag of PAGINATION_ONLY_FLAGS) {
        expect(args, `account ${name} args must NOT include --${flag}`).not.toHaveProperty(flag);
      }
      expect(args, `account ${name} must keep --fields`).toHaveProperty("fields");
    });
  }
});

describe("account checkpoint submit/poll — pagination flags suppressed, --fields kept", () => {
  it("account checkpoint submit — args definition has no pagination-only flags, keeps --fields", async () => {
    const subCmds = await loadAccountSubCommands();
    const checkpointSub = subCmds["checkpoint"]?.subCommands ?? {};
    const args = checkpointSub["submit"]?.args ?? {};

    for (const flag of PAGINATION_ONLY_FLAGS) {
      expect(args, `account checkpoint submit args must NOT include --${flag}`).not.toHaveProperty(flag);
    }
    expect(args, "account checkpoint submit must keep --fields").toHaveProperty("fields");
  });

  it("account checkpoint poll — args definition has no pagination-only flags, keeps --fields", async () => {
    const subCmds = await loadAccountSubCommands();
    const checkpointSub = subCmds["checkpoint"]?.subCommands ?? {};
    const args = checkpointSub["poll"]?.args ?? {};

    for (const flag of PAGINATION_ONLY_FLAGS) {
      expect(args, `account checkpoint poll args must NOT include --${flag}`).not.toHaveProperty(flag);
    }
    expect(args, "account checkpoint poll must keep --fields").toHaveProperty("fields");
  });
});

describe("account list — negative control (list reads keep all pagination flags)", () => {
  it("account list — args definition DOES have all pagination flags", async () => {
    const subCmds = await loadAccountSubCommands();
    const args = subCmds["list"]?.args ?? {};

    for (const flag of PAGINATION_ONLY_FLAGS) {
      expect(args, `account list must include --${flag}`).toHaveProperty(flag);
    }
  });
});

describe("account link / reconnect — checkpoint-required hint in description", () => {
  it("account link description mentions the checkpoint exit code and follow-up command", async () => {
    const subCmds = await loadAccountSubCommands();
    const description = subCmds["link"]?.meta?.description ?? "";

    expect(description, "account link description should mention exit code 12").toMatch(/exits? 12/i);
    expect(description, "account link description should point at `account checkpoint submit`").toMatch(
      /checkpoint submit/,
    );
  });

  it("account reconnect description mentions the checkpoint exit code and follow-up command", async () => {
    const subCmds = await loadAccountSubCommands();
    const description = subCmds["reconnect"]?.meta?.description ?? "";

    expect(description, "account reconnect description should mention exit code 12").toMatch(/exits? 12/i);
    expect(description, "account reconnect description should point at `account checkpoint submit`").toMatch(
      /checkpoint submit/,
    );
  });

  it("account refresh description is unaffected (no checkpoint hint on a non-checkpoint command)", async () => {
    const subCmds = await loadAccountSubCommands();
    const description = subCmds["refresh"]?.meta?.description ?? "";

    expect(description).not.toMatch(/exits? 12/i);
  });
});

describe("account checkpoint submit — --code description", () => {
  it("does not mention the deferred switch-challenge-type escape hatch", async () => {
    const subCmds = await loadAccountSubCommands();
    const checkpointSub = subCmds["checkpoint"]?.subCommands ?? {};
    const args = (checkpointSub["submit"]?.args ?? {}) as Record<string, { description?: string }>;

    expect(String(args["code"]?.description ?? "")).not.toMatch(/TRY_ANOTHER_WAY/);
  });
});

describe("account checkpoint poll — --wait/--timeout flags", () => {
  it("exposes --wait (default off) and a millisecond --timeout with an explicit unit note", async () => {
    const subCmds = await loadAccountSubCommands();
    const checkpointSub = subCmds["checkpoint"]?.subCommands ?? {};
    const args = (checkpointSub["poll"]?.args ?? {}) as Record<string, { default?: unknown; description?: string }>;

    expect(args).toHaveProperty("wait");
    expect(args["wait"]?.default).toBe(false);
    expect(args).toHaveProperty("timeout");
    expect(String(args["timeout"]?.description ?? ""), "--timeout help text must say milliseconds explicitly").toMatch(
      /millisecond/i,
    );
  });
});
