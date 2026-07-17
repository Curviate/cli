/**
 * `curviate company` — company profile + sub-resource reads + follow-invite write.
 *
 * Subcommands:
 *   company <id>                                          — retrieve (routes to companies.get)
 *   company employees <id> [--keywords] [--location]      — list employees (facade)
 *   company posts <id>                                     — list posts (facade)
 *   company jobs <id> [--keywords]                         — list open jobs (facade)
 *   company invitable-followers <id> [--limit] [--cursor]  — list invitable connections (facade)
 *   company follow-invite <id> --invitee <AC…> [...]       — invite connections to follow (write)
 *
 * All but `follow-invite` are read commands: --preview is a usage error
 * (exit 2). `follow-invite` is a write: --preview renders the resolved
 * request without sending.
 *
 * Retrieve keeps its broader identifier contract (URL, slug, or numeric id —
 * `resolveIdentifier` handles company URLs). The sub-resource endpoints
 * require the company's NUMERIC provider_id, but the CLI accepts the same
 * broad identifier as the bare retrieve: a URL/slug is normalized then resolved
 * to the numeric id via `companies.get` (the `id` field the retrieve returns)
 * before the sub-resource call, so `company employees <slug>` works the same as
 * `company <slug>`. A numeric id passes straight through with no extra call; a
 * genuinely unresolvable identifier surfaces `companies.get`'s CurviateError.
 * `follow-invite` resolves the identifier the same way, even under --preview
 * (the preview renders the request that would actually be sent — the resolved
 * numeric id, not the raw slug/URL).
 *
 * citty 0.1.6 cannot express a node that mixes a bare positional (`company
 * <id>`) with `subCommands` — see src/dispatch.ts for the pre-router that
 * makes this coexistence work (first-token-is-a-known-subcommand → descend;
 * otherwise → run the bare form). This command relies on that dispatcher;
 * DO NOT invoke citty's own `runCommand`/`runMain` directly on this tree.
 */

import { defineCommand } from "citty";
import { GLOBAL_FLAGS, WRITE_FLAGS } from "../lib/global-flags.js";
import { streamAll, pageDelayFromFlags } from "../lib/paginate.js";
import { resolveIdentifier } from "../lib/identifier.js";
import { resolveEffectiveConfig } from "../lib/resolve.js";
import { createClient } from "../lib/client.js";
import { renderSuccess, renderError, renderUnexpectedError } from "../lib/output.js";
import { buildPreviewOutput } from "../lib/preview.js";
import {
  slimCompany,
  slimSearchPeople,
  slimSearchPosts,
  slimSearchJobs,
  slimCompanyInvitableFollowers,
  reencodeInvitableFollowers,
  reencodeInviteTokenItem,
} from "../lib/slim.js";
import type { Curviate, CurviateError } from "@curviate/sdk";

type CompanyFlags = {
  id?: string;
  account?: string;
  json?: boolean;
  fields?: string;
  preview?: boolean;
  all?: boolean;
  limit?: string;
  cursor?: string;
  "max-pages"?: string;
  "page-delay"?: string;
  "api-key"?: string;
  "base-url"?: string;
  timeout?: string;
  profile?: string;
  verbose?: boolean;
  sections?: string;
  keywords?: string;
  location?: string;
  invitee?: string | string[];
};

type OutputStreams = {
  stdout: { write: (s: string) => void };
  stderr: { write: (s: string) => void };
};

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

function resolveOutputOpts(flags: CompanyFlags) {
  return {
    json: (flags.json ?? false) || !process.stdout.isTTY,
    isTTY: process.stdout.isTTY ?? false,
    fields: flags.fields,
    verbose: flags.verbose ?? false,
  };
}

/**
 * Normalize the repeatable `--invitee` flag to an array of member ids.
 * citty 0.1.6 has no native array arg type; a `type: "string"` arg that is
 * passed more than once (`--invitee A --invitee B`) accumulates into a
 * string[] at the parser level, while a single occurrence stays a bare
 * string — this collapses both shapes to a string[] (empty when omitted).
 */
function normalizeInviteeIds(invitee: string | string[] | undefined): string[] {
  if (!invitee) return [];
  return Array.isArray(invitee) ? invitee : [invitee];
}

/**
 * Resolve a company identifier to the numeric provider_id the sub-resource
 * endpoints (employees/posts/jobs/invitable-followers/follow-invite) require.
 * A bare numeric id passes through with no extra call; a URL/slug/URN is
 * normalized then resolved via `companies.get` — mirroring how the bare
 * `company <slug>` retrieve auto-resolves, so `company employees acme` works
 * the same as `company acme`. A genuinely unresolvable identifier surfaces
 * `companies.get`'s own CurviateError (404 → exit 4, 400 → exit 2) to the
 * caller, which routes it through `handleSdkError`. Must be called inside
 * the handler's try block.
 */
async function resolveCompanyId(
  ns: ReturnType<Curviate["account"]>,
  raw: string,
): Promise<string> {
  const normalized = resolveIdentifier(raw);
  if (/^\d+$/.test(normalized)) return normalized;
  const company = await ns.companies.get(normalized);
  return String(company.id);
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
 * Run `company <id>`.
 * Routes to `companies.get(identifier)` (hard-moved from the retired
 * `profiles.getCompany`). `identifier` accepts a public handle or numeric id
 * — `resolveIdentifier` normalizes a full company URL to its slug; a bare
 * slug or numeric id passes through unchanged.
 */
export async function runCompanyGet(
  client: Curviate,
  flags: CompanyFlags,
  out: OutputStreams,
): Promise<void> {
  rejectPreviewOnRead(flags.preview, out);
  if (flags.all) {
    out.stderr.write("error: --all is not supported on non-paginated commands.\n");
    process.exit(2);
  }
  if (flags.sections !== undefined) {
    out.stderr.write("error: --sections is not supported on company commands.\n");
    process.exit(2);
  }

  const accountId = requireAccount(flags.account, out);
  const rawId = flags.id ?? "";
  const resolvedId = resolveIdentifier(rawId);

  const outOpts = { ...resolveOutputOpts(flags), slim: slimCompany };

  try {
    const result = await client.account(accountId).companies.get(resolvedId);
    renderSuccess(result, outOpts, out);
  } catch (err: unknown) {
    await handleSdkError(err, outOpts, out);
  }
}

/**
 * Run `company employees <id> [--keywords] [--location] [--limit] [--cursor] [--all]`.
 * A facade over people search with the company filter applied.
 * `<id>` accepts a URL/slug/numeric id — a URL/slug is resolved to the
 * numeric provider_id via companies.get before the sub-resource call.
 */
export async function runCompanyEmployees(
  client: Curviate,
  flags: CompanyFlags,
  out: OutputStreams,
): Promise<void> {
  rejectPreviewOnRead(flags.preview, out);

  const accountId = requireAccount(flags.account, out);
  const ns = client.account(accountId);
  const outOpts = resolveOutputOpts(flags);

  const params: Record<string, unknown> = {};
  if (flags.limit) params["limit"] = parseInt(flags.limit, 10);
  if (flags.cursor) params["cursor"] = flags.cursor;
  if (flags.keywords) params["keywords"] = flags.keywords;
  if (flags.location) params["location"] = flags.location;

  try {
    const identifier = await resolveCompanyId(ns, flags.id ?? "");
    if (flags.all) {
      const maxPages = flags["max-pages"] ? parseInt(flags["max-pages"], 10) : 100;
      const fn = (p: Record<string, unknown>) =>
        ns.companies.employees(identifier, p) as Promise<{ items?: unknown[]; cursor?: string | null }>;
      for await (const item of streamAll(fn, params, {
        maxPages,
        out,
        pageDelayMs: pageDelayFromFlags(flags),
      })) {
        out.stdout.write(JSON.stringify(item) + "\n");
      }
      return;
    }
    const result = await ns.companies.employees(identifier, params);
    renderSuccess(result, { ...outOpts, slim: slimSearchPeople }, out);
  } catch (err: unknown) {
    await handleSdkError(err, outOpts, out);
  }
}

/**
 * Run `company posts <id> [--limit] [--cursor] [--all]`.
 * A facade over posts search with the company filter applied. Post text
 * passes through verbatim (content pass-through — never stored).
 */
export async function runCompanyPosts(
  client: Curviate,
  flags: CompanyFlags,
  out: OutputStreams,
): Promise<void> {
  rejectPreviewOnRead(flags.preview, out);

  const accountId = requireAccount(flags.account, out);
  const ns = client.account(accountId);
  const outOpts = resolveOutputOpts(flags);

  const params: Record<string, unknown> = {};
  if (flags.limit) params["limit"] = parseInt(flags.limit, 10);
  if (flags.cursor) params["cursor"] = flags.cursor;

  try {
    const identifier = await resolveCompanyId(ns, flags.id ?? "");
    if (flags.all) {
      const maxPages = flags["max-pages"] ? parseInt(flags["max-pages"], 10) : 100;
      const fn = (p: Record<string, unknown>) =>
        ns.companies.posts(identifier, p) as Promise<{ items?: unknown[]; cursor?: string | null }>;
      for await (const item of streamAll(fn, params, {
        maxPages,
        out,
        pageDelayMs: pageDelayFromFlags(flags),
      })) {
        out.stdout.write(JSON.stringify(item) + "\n");
      }
      return;
    }
    const result = await ns.companies.posts(identifier, params);
    renderSuccess(result, { ...outOpts, slim: slimSearchPosts }, out);
  } catch (err: unknown) {
    await handleSdkError(err, outOpts, out);
  }
}

/**
 * Run `company jobs <id> [--keywords] [--limit] [--cursor] [--all]`.
 * A facade over jobs search with the company filter applied. An empty
 * `items[]` (no open postings) is a valid result, not an error.
 */
export async function runCompanyJobs(
  client: Curviate,
  flags: CompanyFlags,
  out: OutputStreams,
): Promise<void> {
  rejectPreviewOnRead(flags.preview, out);

  const accountId = requireAccount(flags.account, out);
  const ns = client.account(accountId);
  const outOpts = resolveOutputOpts(flags);

  const params: Record<string, unknown> = {};
  if (flags.limit) params["limit"] = parseInt(flags.limit, 10);
  if (flags.cursor) params["cursor"] = flags.cursor;
  if (flags.keywords) params["keywords"] = flags.keywords;

  try {
    const identifier = await resolveCompanyId(ns, flags.id ?? "");
    if (flags.all) {
      const maxPages = flags["max-pages"] ? parseInt(flags["max-pages"], 10) : 100;
      const fn = (p: Record<string, unknown>) =>
        ns.companies.jobs(identifier, p) as Promise<{ items?: unknown[]; cursor?: string | null }>;
      for await (const item of streamAll(fn, params, {
        maxPages,
        out,
        pageDelayMs: pageDelayFromFlags(flags),
      })) {
        out.stdout.write(JSON.stringify(item) + "\n");
      }
      return;
    }
    const result = await ns.companies.jobs(identifier, params);
    renderSuccess(result, { ...outOpts, slim: slimSearchJobs }, out);
  } catch (err: unknown) {
    await handleSdkError(err, outOpts, out);
  }
}

/**
 * Run `company invitable-followers <id> [--limit] [--cursor] [--all]`.
 * A facade over the connections eligible to be invited to follow the page —
 * the read that seeds `company follow-invite`. `<id>` accepts a URL/slug/
 * numeric id, resolved to the numeric provider_id via companies.get before
 * the sub-resource call, same as employees/posts/jobs. `invite_token` is
 * always re-encoded as base64 (raw bytes are JSON/terminal-unsafe) — in
 * every output mode, including --verbose and --all/NDJSON.
 */
export async function runCompanyInvitableFollowers(
  client: Curviate,
  flags: CompanyFlags,
  out: OutputStreams,
): Promise<void> {
  rejectPreviewOnRead(flags.preview, out);

  const accountId = requireAccount(flags.account, out);
  const ns = client.account(accountId);
  const outOpts = resolveOutputOpts(flags);

  const params: Record<string, unknown> = {};
  if (flags.limit) params["limit"] = parseInt(flags.limit, 10);
  if (flags.cursor) params["cursor"] = flags.cursor;

  try {
    const identifier = await resolveCompanyId(ns, flags.id ?? "");
    if (flags.all) {
      const maxPages = flags["max-pages"] ? parseInt(flags["max-pages"], 10) : 100;
      const fn = (p: Record<string, unknown>) =>
        ns.companies.invitableFollowers(identifier, p) as Promise<{ items?: unknown[]; cursor?: string | null }>;
      for await (const item of streamAll(fn, params, {
        maxPages,
        out,
        pageDelayMs: pageDelayFromFlags(flags),
      })) {
        out.stdout.write(JSON.stringify(reencodeInviteTokenItem(item as Record<string, unknown>)) + "\n");
      }
      return;
    }
    const result = await ns.companies.invitableFollowers(identifier, params);
    const safeResult = reencodeInvitableFollowers(result);
    renderSuccess(safeResult, { ...outOpts, slim: slimCompanyInvitableFollowers }, out);
  } catch (err: unknown) {
    await handleSdkError(err, outOpts, out);
  }
}

/**
 * Run `company follow-invite <id> --invitee <AC…> [--invitee <AC…> …]`.
 * Write command — supports --preview. Invites one or more of the connected
 * account's 1st-degree connections (the `id` field from
 * `company invitable-followers`) to follow the administered page.
 * `<id>` accepts a URL/slug/numeric id, resolved to the numeric provider_id
 * the same way as the other company sub-resources — even under --preview,
 * so the preview renders the actual request that would be sent.
 */
export async function runCompanyFollowInvite(
  client: Curviate,
  flags: CompanyFlags,
  out: OutputStreams,
): Promise<void> {
  const accountId = requireAccount(flags.account, out);
  const ns = client.account(accountId);
  const outOpts = resolveOutputOpts(flags);

  const inviteeIds = normalizeInviteeIds(flags.invitee);
  if (inviteeIds.length === 0) {
    out.stderr.write("error: at least one --invitee is required.\n");
    process.exit(2);
    return;
  }

  try {
    const identifier = await resolveCompanyId(ns, flags.id ?? "");
    const body = { invitee_ids: inviteeIds };

    if (flags.preview) {
      const preview = buildPreviewOutput({
        method: "companies.followInvite",
        args: { identifier },
        body,
        account: accountId,
      });
      out.stdout.write(JSON.stringify(preview) + "\n");
      return;
    }

    const result = await ns.companies.followInvite(identifier, body);
    renderSuccess(result, outOpts, out);
  } catch (err: unknown) {
    await handleSdkError(err, outOpts, out);
  }
}

// ---------------------------------------------------------------------------
// Citty command definitions
// ---------------------------------------------------------------------------

const companyEmployeesCommand = defineCommand({
  meta: { name: "employees", description: "List people who currently work at the company." },
  args: {
    ...GLOBAL_FLAGS,
    id: { type: "positional", description: "Company identifier (URL, slug, or numeric id) — a slug/URL is resolved to the numeric id first." },
    keywords: { type: "string", description: "Free-text keyword filter across employee profile fields." },
    location: { type: "string", description: "Opaque location id from `search parameters --type LOCATION`." },
  },
  async run({ args }) {
    const flags = args as CompanyFlags;
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
    await runCompanyEmployees(client, { ...flags, account: flags.account ?? cfg.account }, out);
  },
});

const companyPostsCommand = defineCommand({
  meta: { name: "posts", description: "List the company's posts." },
  args: {
    ...GLOBAL_FLAGS,
    id: { type: "positional", description: "Company identifier (URL, slug, or numeric id) — a slug/URL is resolved to the numeric id first." },
  },
  async run({ args }) {
    const flags = args as CompanyFlags;
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
    await runCompanyPosts(client, { ...flags, account: flags.account ?? cfg.account }, out);
  },
});

const companyJobsCommand = defineCommand({
  meta: { name: "jobs", description: "List the company's open job postings." },
  args: {
    ...GLOBAL_FLAGS,
    id: { type: "positional", description: "Company identifier (URL, slug, or numeric id) — a slug/URL is resolved to the numeric id first." },
    keywords: { type: "string", description: "Free-text keyword filter across job postings." },
  },
  async run({ args }) {
    const flags = args as CompanyFlags;
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
    await runCompanyJobs(client, { ...flags, account: flags.account ?? cfg.account }, out);
  },
});

const companyInvitableFollowersCommand = defineCommand({
  meta: {
    name: "invitable-followers",
    description:
      "List the account's 1st-degree connections who are eligible to be invited to follow the company page. " +
      "This is the read that seeds `company follow-invite`. Items carry no name or headline (a wire limitation), " +
      "so hydrate a candidate via `profile <id>` before deciding who to invite. " +
      "`invite_token` is always returned as base64 (the raw value can carry binary bytes unsafe to print).",
  },
  args: {
    ...GLOBAL_FLAGS,
    id: { type: "positional", description: "Company identifier (URL, slug, or numeric id), resolved to the numeric id first." },
  },
  async run({ args }) {
    const flags = args as CompanyFlags;
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
    await runCompanyInvitableFollowers(client, { ...flags, account: flags.account ?? cfg.account }, out);
  },
});

const companyFollowInviteCommand = defineCommand({
  meta: {
    name: "follow-invite",
    description:
      "Invite the account's 1st-degree connections to follow the administered company page. " +
      "Write, admin-gated (the account must administer the page with invite rights). " +
      "Pass the AC… member ids from `company invitable-followers`, one --invitee per invitee. " +
      "All-or-nothing: for an all-valid request you get one outcome per invitee, in request order (invited/already_invited/ineligible/not_found); if any invitee id is invalid the whole request rejects with a 404, not a partial result. " +
      "Re-inviting an already-invited member is a safe no-op (the same invitation id, never a duplicate).",
  },
  args: {
    ...WRITE_FLAGS,
    id: { type: "positional", description: "Company identifier (URL, slug, or numeric id), resolved to the numeric id first, including under --preview." },
    invitee: {
      type: "string",
      description: "AC… member id to invite (from `company invitable-followers`). Repeatable, at least one required, max 50 per request.",
    },
  },
  async run({ args }) {
    const flags = args as CompanyFlags;
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
    await runCompanyFollowInvite(client, { ...flags, account: flags.account ?? cfg.account }, out);
  },
});

export const companyCommand = defineCommand({
  meta: { name: "company", description: "Fetch a company profile by URL, slug, or numeric id, and its sub-resources." },
  args: {
    ...GLOBAL_FLAGS,
    id: { type: "positional", description: "Company identifier (URL, slug, or native id)." },
    sections: { type: "string" as const, description: "Not supported on company commands — usage error (exit 2) if supplied." },
  },
  subCommands: {
    employees: companyEmployeesCommand,
    posts: companyPostsCommand,
    jobs: companyJobsCommand,
    "invitable-followers": companyInvitableFollowersCommand,
    "follow-invite": companyFollowInviteCommand,
  },
  async run({ args }) {
    const flags = args as CompanyFlags;
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
    await runCompanyGet(client, { ...flags, account: flags.account ?? cfg.account }, out);
  },
});
