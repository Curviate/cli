/**
 * Pre-router unit tests — the extra-positional class (D4a).
 *
 * `resolveLeaf` resolves a command tree + rawArgs down to the single leaf to
 * run and the args that belong to it, WITHOUT executing any handler. That makes
 * the routing DECISION assertable directly: which leaf, with which args — the
 * precise thing a spawn-the-bin test against an unroutable base URL cannot show
 * (a rerouted employees list and a base company retrieve both network-fail with
 * exit 1, so exit code alone can't tell them apart).
 *
 * The defect (D4a): a bare-form command that also has subcommands
 * (`company <id>` + `company employees|posts|jobs`) silently swallowed a
 * trailing extra positional — `company <id> employees` returned the BASE
 * company profile (exit 0), ignoring `employees`. The fix reroutes the
 * id-first ergonomic form to the named subcommand, or exits 2 — never a silent
 * swallow.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import type { CommandDef } from "citty";
import { resolveLeaf } from "../src/dispatch.js";
import { companyCommand } from "../src/commands/company.js";
import { connectCommand } from "../src/commands/connect.js";
import { messageCommand } from "../src/commands/message.js";
import { profileCommand } from "../src/commands/profile.js";

// citty types each command as `CommandDef<ItsOwnArgs>`; the contravariant
// run/setup context makes those specific types non-assignable to the plain
// `CommandDef` the router walks. The router itself casts subcommands to the
// plain form (dispatch.ts) — mirror that here for the tree roots under test.
const asCmd = (c: unknown): CommandDef => c as CommandDef;

async function nameOf(cmd: CommandDef): Promise<string | undefined> {
  const meta = typeof cmd.meta === "function" ? await (cmd.meta as () => Promise<{ name?: string }>)() : cmd.meta;
  return (meta as { name?: string } | undefined)?.name;
}

function mockExit() {
  return vi.spyOn(process, "exit").mockImplementation(((code?: number | string | null) => {
    throw new Error(`process.exit(${code})`);
  }) as never);
}

describe("pre-router — id-first reroute (D4a)", () => {
  afterEach(() => vi.restoreAllMocks());

  // [label, tree, rawArgs, expected leaf name, expected leaf args]
  const reroutes: Array<[string, CommandDef, string[], string, string[]]> = [
    ["company <id> employees", asCmd(companyCommand), ["1035", "employees"], "employees", ["1035"]],
    ["company <slug> posts", asCmd(companyCommand), ["t-systems", "posts"], "posts", ["t-systems"]],
    ["company <id> jobs", asCmd(companyCommand), ["1035", "jobs"], "jobs", ["1035"]],
    [
      "company <id> employees --keywords eng (subflag preserved)",
      asCmd(companyCommand),
      ["1035", "employees", "--keywords", "eng"],
      "employees",
      ["1035", "--keywords", "eng"],
    ],
    [
      "company <id> employees --account acc_x (global flag preserved)",
      asCmd(companyCommand),
      ["1035", "employees", "--account", "acc_x"],
      "employees",
      ["1035", "--account", "acc_x"],
    ],
    ["profile <id> followers", asCmd(profileCommand), ["jdoe", "followers"], "followers", ["jdoe"]],
  ];

  it.each(reroutes)("%s reroutes to the named subcommand, id preserved", async (_label, tree, rawArgs, leafName, leafArgs) => {
    const { leaf, leafArgs: got } = await resolveLeaf(tree, rawArgs);
    expect(await nameOf(leaf)).toBe(leafName);
    expect(got).toEqual(leafArgs);
  });
});

describe("pre-router — bare form with no extra still resolves to the bare node", () => {
  afterEach(() => vi.restoreAllMocks());

  it("company <id> (no extra) → the bare company node, id intact", async () => {
    const { leaf, leafArgs } = await resolveLeaf(asCmd(companyCommand), ["1035"]);
    expect(await nameOf(leaf)).toBe("company");
    expect(leafArgs).toEqual(["1035"]);
  });

  it("company <id> --account acc_x → the bare company node", async () => {
    const { leaf, leafArgs } = await resolveLeaf(asCmd(companyCommand), ["1035", "--account", "acc_x"]);
    expect(await nameOf(leaf)).toBe("company");
    expect(leafArgs).toEqual(["1035", "--account", "acc_x"]);
  });

  it("message <chat> <text> → the bare message node (2 positionals, no extra)", async () => {
    const { leaf, leafArgs } = await resolveLeaf(asCmd(messageCommand), ["chat_9", "hello world"]);
    expect(await nameOf(leaf)).toBe("message");
    expect(leafArgs).toEqual(["chat_9", "hello world"]);
  });
});

describe("pre-router — non-subcommand extra positional exits 2, never silent-swallow (D4a)", () => {
  afterEach(() => vi.restoreAllMocks());

  const badCases: Array<[string, CommandDef, string[]]> = [
    ["company <id> <bogus>", asCmd(companyCommand), ["1035", "bogus"]],
    ["connect <slug> <bogus>", asCmd(connectCommand), ["jdoe", "bogus"]],
    ["message <chat> <text> <bogus>", asCmd(messageCommand), ["chat_9", "hi", "bogus"]],
    ["profile <id> <bogus>", asCmd(profileCommand), ["jdoe", "bogus"]],
  ];

  it.each(badCases)("%s → process.exit(2)", async (_label, tree, rawArgs) => {
    vi.spyOn(process.stderr, "write").mockReturnValue(true);
    const exit = mockExit();
    await expect(resolveLeaf(tree, rawArgs)).rejects.toThrow("process.exit(2)");
    exit.mockRestore();
  });
});
