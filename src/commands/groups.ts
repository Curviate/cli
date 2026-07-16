/**
 * `curviate groups` — LinkedIn groups reads.
 *
 * Subcommands:
 *   groups list [--member <vanity|url|provider-id>]  — the groups a member belongs to (read, paginated)
 *   groups get <group>                               — one group's full detail (read, scalar)
 *   groups members <group> [--name <q>]               — a group's member roster (read, paginated)
 *
 * All three are read commands: --preview is a usage error (exit 2).
 *
 * `groups list` reads the connected account's own groups by default; pass
 * `--member` to read another member's public group set (a documented partial
 * read). `--member` accepts a vanity slug, a full /in/ URL, or a provider id
 * (ACoAA…/ADoAA…/AEoAA…) — the endpoint's own `profile` filter only accepts a
 * vanity slug/URL (it builds a `/in/<vanity>/…` request server-side), so a
 * provider id is resolved to its public identifier first via
 * `resolveMemberPublicIdentifier` (lib/member-id.ts) — the same
 * provider-id-shaped-input detection `profile follow`/`unfollow` use, just in
 * the opposite direction. Fed a raw provider id unresolved, the endpoint
 * previously 200'd with a silent `items: []` — indistinguishable from a real
 * empty list; an unresolvable identifier now exits 2 with a clear message
 * instead. `--member` maps to the endpoint's `profile` filter — the CLI's own
 * `--profile` flag is reserved for config-profile selection, so a distinct
 * flag name avoids the collision.
 *
 * `groups members --name <q>` is the folded-in member search — the SAME
 * endpoint with a name filter applied, not a separate command. The `<group>`
 * positional accepts the group's id or its LinkedIn group URL, passed verbatim.
 */

import { defineCommand } from "citty";
import { GLOBAL_FLAGS } from "../lib/global-flags.js";
import { streamAll, pageDelayFromFlags, sliceToLimit } from "../lib/paginate.js";
import { resolveMemberPublicIdentifier, MemberResolutionError } from "../lib/member-id.js";
import { resolveEffectiveConfig } from "../lib/resolve.js";
import { createClient } from "../lib/client.js";
import { renderSuccess, renderError, renderUnexpectedError } from "../lib/output.js";
import { slimGroup } from "../lib/slim.js";
import type { Curviate, CurviateError } from "@curviate/sdk";

type GroupsFlags = {
  group?: string;
  member?: string;
  name?: string;
  account?: string;
  json?: boolean;
  fields?: string;
  limit?: string;
  cursor?: string;
  all?: boolean;
  "max-pages"?: string;
  "page-delay"?: string;
  preview?: boolean;
  verbose?: boolean;
  "api-key"?: string;
  "base-url"?: string;
  timeout?: string;
  profile?: string;
};

type OutputStreams = {
  stdout: { write: (s: string) => void };
  stderr: { write: (s: string) => void };
};

type ListQuery = { profile?: string; name?: string; limit?: number; cursor?: string };

function buildOutputStreams(): OutputStreams {
  return {
    stdout: { write: (s: string) => process.stdout.write(s) },
    stderr: { write: (s: string) => process.stderr.write(s) },
  };
}

function requireAccount(account: string | undefined, out: OutputStreams): string {
  if (!account) {
    out.stderr.write("error: --account is required for this command. Set it via --account, CURVIATE_ACCOUNT, or `curviate config set-account`.\n");
    process.exit(2);
  }
  return account;
}

function rejectPreviewOnRead(preview: boolean | undefined, out: OutputStreams): void {
  if (preview) {
    out.stderr.write("error: --preview is only valid on write commands (mutations). Reads just run.\n");
    process.exit(2);
  }
}

function rejectAllOnNonPaginated(all: boolean | undefined, out: OutputStreams): void {
  if (all) {
    out.stderr.write("error: --all is not supported on non-paginated commands.\n");
    process.exit(2);
  }
}

function resolveOutputOpts(flags: GroupsFlags) {
  return {
    json: (flags.json ?? false) || !process.stdout.isTTY,
    isTTY: process.stdout.isTTY ?? false,
    fields: flags.fields,
    verbose: flags.verbose ?? false,
  };
}

async function handleSdkError(err: unknown, outOpts: ReturnType<typeof resolveOutputOpts>, out: OutputStreams): Promise<never> {
  const { CurviateError } = await import("@curviate/sdk");
  if (err instanceof CurviateError) {
    const { getExitCode } = await import("../lib/exit-codes.js");
    renderError(err as CurviateError, outOpts, out);
    process.exit(getExitCode(err.code));
  }
  renderUnexpectedError(err, out);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Exported run functions (testable without citty)
// ---------------------------------------------------------------------------

/**
 * Run `groups list [--member <vanity|url|provider-id>] [--limit] [--cursor] [--all]` — groups.list.
 * Reads the connected account's own groups by default; `--member` targets
 * another member's public group set (mapped to the endpoint's `profile`
 * filter). A provider-id-shaped `--member` is resolved to its public
 * identifier first (see resolveMemberPublicIdentifier) — the endpoint's
 * `profile` filter silently 200s with an empty list on a raw provider id, a
 * failure indistinguishable from a real empty result.
 */
export async function runGroupsList(
  client: Curviate,
  flags: GroupsFlags,
  out: OutputStreams,
): Promise<void> {
  rejectPreviewOnRead(flags.preview, out);
  const accountId = requireAccount(flags.account, out);
  const ns = client.account(accountId);
  const outOpts = resolveOutputOpts(flags);
  const all = flags.all ?? false;
  const maxPages = flags["max-pages"] ? parseInt(flags["max-pages"], 10) : 100;
  const params: ListQuery = {};
  if (flags.member) {
    try {
      params.profile = await resolveMemberPublicIdentifier(ns, flags.member);
    } catch (err: unknown) {
      if (err instanceof MemberResolutionError) {
        out.stderr.write("error: pass a vanity slug or /in/ URL, or a resolvable provider id.\n");
        process.exit(2);
        return;
      }
      throw err;
    }
  }
  if (flags.limit) params.limit = parseInt(flags.limit, 10);
  if (flags.cursor) params.cursor = flags.cursor;

  try {
    if (all) {
      const fn = (p: ListQuery) => ns.groups.list(p);
      for await (const item of streamAll(fn, params, {
        maxPages,
        out,
        pageDelayMs: pageDelayFromFlags(flags),
      })) {
        out.stdout.write(JSON.stringify(item) + "\n");
      }
    } else {
      const result = await ns.groups.list(params);
      renderSuccess(result, { ...outOpts, slim: slimGroup }, out);
    }
  } catch (err: unknown) {
    await handleSdkError(err, outOpts, out);
  }
}

/**
 * Run `groups get <group>` — groups.get (scalar read).
 * `<group>` is the group's id or its LinkedIn group URL, passed verbatim.
 */
export async function runGroupsGet(
  client: Curviate,
  flags: GroupsFlags,
  out: OutputStreams,
): Promise<void> {
  rejectPreviewOnRead(flags.preview, out);
  rejectAllOnNonPaginated(flags.all, out);
  const accountId = requireAccount(flags.account, out);
  const group = flags.group ?? "";
  const outOpts = resolveOutputOpts(flags);
  try {
    const result = await client.account(accountId).groups.get(group);
    renderSuccess(result, { ...outOpts, slim: slimGroup }, out);
  } catch (err: unknown) {
    await handleSdkError(err, outOpts, out);
  }
}

/**
 * Run `groups members <group> [--name <q>] [--limit] [--cursor] [--all]` — groups.members.
 * `--name` filters the roster by member name (the folded-in member search on
 * the SAME endpoint, not a separate one). A cursor is scoped to the `name` it
 * was minted under — replaying it with a different `name` is rejected upstream.
 */
export async function runGroupsMembers(
  client: Curviate,
  flags: GroupsFlags,
  out: OutputStreams,
): Promise<void> {
  rejectPreviewOnRead(flags.preview, out);
  const accountId = requireAccount(flags.account, out);
  const ns = client.account(accountId);
  const group = flags.group ?? "";
  const outOpts = resolveOutputOpts(flags);
  const all = flags.all ?? false;
  const maxPages = flags["max-pages"] ? parseInt(flags["max-pages"], 10) : 100;
  const params: ListQuery = {};
  if (flags.name !== undefined) params.name = flags.name;
  if (flags.limit) params.limit = parseInt(flags.limit, 10);
  if (flags.cursor) params.cursor = flags.cursor;

  try {
    if (all) {
      const fn = (p: ListQuery) => ns.groups.members(group, p);
      for await (const item of streamAll(fn, params, {
        maxPages,
        out,
        pageDelayMs: pageDelayFromFlags(flags),
      })) {
        out.stdout.write(JSON.stringify(item) + "\n");
      }
    } else {
      const result = await ns.groups.members(group, params);
      renderSuccess(sliceToLimit(result, params.limit), outOpts, out);
    }
  } catch (err: unknown) {
    await handleSdkError(err, outOpts, out);
  }
}

// ---------------------------------------------------------------------------
// Citty command definitions
// ---------------------------------------------------------------------------

/** Shared config/client boilerplate for a subcommand's run(). */
async function withClient(
  flags: GroupsFlags,
  fn: (client: Curviate, flags: GroupsFlags, out: OutputStreams) => Promise<void>,
): Promise<void> {
  const cfg = await resolveEffectiveConfig({
    apiKey: flags["api-key"],
    baseUrl: flags["base-url"],
    timeout: flags.timeout,
    account: flags.account,
    profile: flags.profile,
  });
  if (!cfg.apiKey) {
    process.stderr.write("error: no API key — run `curviate login` or pass --api-key.\n");
    process.exit(3);
  }
  const client = createClient({ apiKey: cfg.apiKey, baseUrl: cfg.baseUrl, timeout: cfg.timeout });
  const out = buildOutputStreams();
  await fn(client, { ...flags, account: flags.account ?? cfg.account }, out);
}

const groupsListCommand = defineCommand({
  meta: {
    name: "list",
    description:
      "List the LinkedIn groups a member belongs to, each enriched to full group detail. " +
      "Reads your connected account's own groups by default; pass --member <vanity | /in/ URL | provider id> to read another member's public group set (a partial read — that member's interests-groups section). " +
      "A provider id (ACoAA…/ADoAA…/AEoAA…) is resolved to a public identifier automatically before the request; an unresolvable identifier exits 2 rather than silently returning an empty list. " +
      "The id on each group is what `groups get` / `groups members` consume. Paginate with the returned cursor (--all streams every page as NDJSON; walk until cursor is null). " +
      "Default output is slim (id, name, member_count, admin, and the other small scalars); pass --verbose for the full item including sample_past_members[] (a partial ~12-item bare-id sample).",
  },
  args: {
    ...GLOBAL_FLAGS,
    member: {
      type: "string",
      description: "Target another member's groups: a vanity slug, a full /in/<vanity> URL, or a provider id (ACoAA…/ADoAA…/AEoAA…, auto-resolved to a public identifier). Omit to read your own account's groups.",
    },
  },
  async run({ args }) {
    await withClient(args as GroupsFlags, runGroupsList);
  },
});

const groupsGetCommand = defineCommand({
  meta: {
    name: "get",
    description:
      "Retrieve one LinkedIn group's full detail — name, description, member count, your membership status, and admin contact. " +
      "Default output is slim (id, name, member_count, admin, and the other small scalars); pass --verbose for the full item including sample_past_members[] (a partial ~12-item bare-id sample).",
  },
  args: {
    ...GLOBAL_FLAGS,
    group: { type: "positional", description: "Group id or LinkedIn group URL." },
  },
  async run({ args }) {
    await withClient(args as GroupsFlags, runGroupsGet);
  },
});

const groupsMembersCommand = defineCommand({
  meta: {
    name: "members",
    description:
      "List a group's members, cursor-paginated, each carrying its profile URL, name, and headline. " +
      "Pass --name <query> to search the roster by member name (prefix/substring, multi-word, case-insensitive) — the folded-in member search, not a separate endpoint. " +
      "Paginate with the returned cursor (--all streams every page; walk until cursor is null). A cursor is scoped to the --name it was minted under.",
  },
  args: {
    ...GLOBAL_FLAGS,
    group: { type: "positional", description: "Group id or LinkedIn group URL." },
    name: { type: "string", description: "Filter members by name (prefix/substring, case-insensitive). Omit for the full roster." },
  },
  async run({ args }) {
    await withClient(args as GroupsFlags, runGroupsMembers);
  },
});

export const groupsCommand = defineCommand({
  meta: { name: "groups", description: "Read LinkedIn groups: your own or a member's group set, a group's detail, and its members." },
  subCommands: {
    list: groupsListCommand,
    get: groupsGetCommand,
    members: groupsMembersCommand,
  },
  async run() {
    process.stderr.write(
      "Usage: curviate groups <subcommand>\n" +
      "  list [--member <vanity|url|provider-id>]  list the groups a member belongs to (your own by default)\n" +
      "  get <group>                               one group's full detail\n" +
      "  members <group> [--name <query>]          a group's members (--name folds in member search)\n",
    );
  },
});
