/**
 * `curviate profile` — member profile operations.
 *
 * Subcommands:
 *   profile me                                   — own profile
 *   profile <id> [--notify]                      — get member profile
 *   profile <id> --posts [--is-company]          — list posts
 *   profile <id> --comments                      — list comments
 *   profile <id> --reactions                     — list reactions
 *   profile <id> --followers                     — list followers
 *   profile connections                          — list connections
 *   profile endorse <id> --skill <sid>           — endorse a skill (write)
 *
 * All subcommands are account-scoped. `<id>` passes through resolveIdentifier.
 * Read commands reject --preview (exit 2). Write commands render --preview.
 * List reads support --all NDJSON streaming; profile me rejects --all (exit 2).
 */

import { defineCommand } from "citty";
import { GLOBAL_FLAGS } from "../lib/global-flags.js";
import { resolveIdentifier } from "../lib/identifier.js";
import { resolveEffectiveConfig } from "../lib/resolve.js";
import { createClient } from "../lib/client.js";
import { renderSuccess, renderError, renderUnexpectedError } from "../lib/output.js";
import { buildPreviewOutput } from "../lib/preview.js";
import { streamAll } from "../lib/paginate.js";
import type { CurviateError } from "@curviate/sdk";

// ---------------------------------------------------------------------------
// Types (minimal — enough for the run functions to be testable standalone)
// ---------------------------------------------------------------------------

type ProfileFlags = {
  id?: string;
  posts?: boolean;
  comments?: boolean;
  reactions?: boolean;
  followers?: boolean;
  "is-company"?: boolean;
  notify?: boolean;
  skill?: string;
  account?: string;
  json?: boolean;
  fields?: string;
  limit?: string;
  cursor?: string;
  all?: boolean;
  "max-pages"?: string;
  preview?: boolean;
  "api-key"?: string;
  "base-url"?: string;
  timeout?: string;
  profile?: string;
};

type SubFlags = {
  id?: string;
  skill?: string;
  notify?: boolean;
  account?: string;
  json?: boolean;
  all?: boolean;
  "max-pages"?: string;
  preview?: boolean;
  fields?: string;
  limit?: string;
  cursor?: string;
};

type OutputStreams = {
  stdout: { write: (s: string) => void };
  stderr: { write: (s: string) => void };
};

// Minimal client shape to avoid coupling to SDK internals in tests.
type MinimalClient = {
  account: (id: string) => {
    profiles: {
      getMe: () => Promise<unknown>;
      get: (id: string, params?: Record<string, unknown>) => Promise<unknown>;
      listPosts: (id: string, params?: Record<string, unknown>) => Promise<unknown>;
      listComments: (id: string, params?: Record<string, unknown>) => Promise<unknown>;
      listReactions: (id: string, params?: Record<string, unknown>) => Promise<unknown>;
      listFollowers: (id: string, params?: Record<string, unknown>) => Promise<unknown>;
      listConnections: (params?: Record<string, unknown>) => Promise<unknown>;
      endorse: (id: string, body: { skill_endorsement_id: string }) => Promise<unknown>;
    };
  };
};

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

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

function buildOutputStreams(): OutputStreams {
  return {
    stdout: { write: (s: string) => process.stdout.write(s) },
    stderr: { write: (s: string) => process.stderr.write(s) },
  };
}

function resolveOutputOpts(flags: ProfileFlags | SubFlags) {
  return {
    json: (flags.json ?? false) || !process.stdout.isTTY,
    isTTY: process.stdout.isTTY ?? false,
    fields: (flags as ProfileFlags).fields,
  };
}

// ---------------------------------------------------------------------------
// Exported run functions (testable without citty)
// ---------------------------------------------------------------------------

/**
 * Run `profile me`.
 * Exported for unit-testing.
 */
export async function runProfileMe(
  client: MinimalClient,
  flags: ProfileFlags,
  out: OutputStreams,
): Promise<void> {
  rejectPreviewOnRead(flags.preview, out);
  rejectAllOnNonPaginated(flags.all, out);

  const accountId = requireAccount(flags.account, out);
  const ns = client.account(accountId);

  try {
    const result = await ns.profiles.getMe();
    const opts = resolveOutputOpts(flags);
    renderSuccess(result, opts, out);
  } catch (err: unknown) {
    const { CurviateError } = await import("@curviate/sdk");
    if (err instanceof CurviateError) {
      const { getExitCode } = await import("../lib/exit-codes.js");
      renderError(err as CurviateError, resolveOutputOpts(flags), out);
      process.exit(getExitCode(err.code));
    }
    renderUnexpectedError(err, out);
    process.exit(1);
  }
}

/**
 * Run `profile <id> [--posts|--comments|--reactions|--followers] [--notify]`.
 * Exported for unit-testing.
 */
export async function runProfileGet(
  client: MinimalClient,
  flags: ProfileFlags,
  out: OutputStreams,
): Promise<void> {
  rejectPreviewOnRead(flags.preview, out);

  const accountId = requireAccount(flags.account, out);
  const rawId = flags.id ?? "";
  const resolvedId = resolveIdentifier(rawId);
  const ns = client.account(accountId);

  const outOpts = resolveOutputOpts(flags);
  const all = flags.all ?? false;
  const maxPages = flags["max-pages"] ? parseInt(flags["max-pages"], 10) : 100;
  const limit = flags.limit ? parseInt(flags.limit, 10) : undefined;
  const cursor = flags.cursor;

  try {
    // Select list method by flag
    if (flags.posts) {
      const params: Record<string, unknown> = {};
      if (flags["is-company"]) params["is_company"] = true;
      if (limit !== undefined) params["limit"] = limit;
      if (cursor) params["cursor"] = cursor;

      if (all) {
        const fn = (p: Record<string, unknown>) => ns.profiles.listPosts(resolvedId, p) as Promise<{ items?: unknown[]; cursor?: string | null }>;
        for await (const item of streamAll(fn, params, {
          maxPages,
          onTruncated: (msg) => out.stderr.write(msg + "\n"),
        })) {
          out.stdout.write(JSON.stringify(item) + "\n");
        }
      } else {
        const result = await ns.profiles.listPosts(resolvedId, params);
        renderSuccess(result, outOpts, out);
      }
    } else if (flags.comments) {
      const params: Record<string, unknown> = {};
      if (limit !== undefined) params["limit"] = limit;
      if (cursor) params["cursor"] = cursor;

      if (all) {
        const fn = (p: Record<string, unknown>) => ns.profiles.listComments(resolvedId, p) as Promise<{ items?: unknown[]; cursor?: string | null }>;
        for await (const item of streamAll(fn, params, {
          maxPages,
          onTruncated: (msg) => out.stderr.write(msg + "\n"),
        })) {
          out.stdout.write(JSON.stringify(item) + "\n");
        }
      } else {
        const result = await ns.profiles.listComments(resolvedId, params);
        renderSuccess(result, outOpts, out);
      }
    } else if (flags.reactions) {
      const params: Record<string, unknown> = {};
      if (limit !== undefined) params["limit"] = limit;
      if (cursor) params["cursor"] = cursor;

      if (all) {
        const fn = (p: Record<string, unknown>) => ns.profiles.listReactions(resolvedId, p) as Promise<{ items?: unknown[]; cursor?: string | null }>;
        for await (const item of streamAll(fn, params, {
          maxPages,
          onTruncated: (msg) => out.stderr.write(msg + "\n"),
        })) {
          out.stdout.write(JSON.stringify(item) + "\n");
        }
      } else {
        const result = await ns.profiles.listReactions(resolvedId, params);
        renderSuccess(result, outOpts, out);
      }
    } else if (flags.followers) {
      const params: Record<string, unknown> = {};
      if (limit !== undefined) params["limit"] = limit;
      if (cursor) params["cursor"] = cursor;

      if (all) {
        const fn = (p: Record<string, unknown>) => ns.profiles.listFollowers(resolvedId, p) as Promise<{ items?: unknown[]; cursor?: string | null }>;
        for await (const item of streamAll(fn, params, {
          maxPages,
          onTruncated: (msg) => out.stderr.write(msg + "\n"),
        })) {
          out.stdout.write(JSON.stringify(item) + "\n");
        }
      } else {
        const result = await ns.profiles.listFollowers(resolvedId, params);
        renderSuccess(result, outOpts, out);
      }
    } else {
      // Default: profiles.get
      rejectAllOnNonPaginated(flags.all, out);
      const params: Record<string, unknown> = {};
      if (flags.notify) params["notify"] = true;

      const result = await ns.profiles.get(resolvedId, params);
      renderSuccess(result, outOpts, out);
    }
  } catch (err: unknown) {
    const { CurviateError } = await import("@curviate/sdk");
    if (err instanceof CurviateError) {
      const { getExitCode } = await import("../lib/exit-codes.js");
      renderError(err as CurviateError, outOpts, out);
      process.exit(getExitCode(err.code));
    }
    renderUnexpectedError(err, out);
    process.exit(1);
  }
}

/**
 * Run `profile connections [--all] [--limit] [--cursor]`.
 * Exported for unit-testing.
 */
export async function runProfileConnections(
  client: MinimalClient,
  flags: SubFlags,
  out: OutputStreams,
): Promise<void> {
  rejectPreviewOnRead(flags.preview, out);

  const accountId = requireAccount(flags.account, out);
  const ns = client.account(accountId);
  const outOpts = resolveOutputOpts(flags);
  const all = flags.all ?? false;
  const maxPages = flags["max-pages"] ? parseInt(flags["max-pages"], 10) : 100;
  const limit = flags.limit ? parseInt(flags.limit, 10) : undefined;
  const cursor = (flags as ProfileFlags).cursor;
  const params: Record<string, unknown> = {};
  if (limit !== undefined) params["limit"] = limit;
  if (cursor) params["cursor"] = cursor;

  try {
    if (all) {
      const fn = (p: Record<string, unknown>) => ns.profiles.listConnections(p) as Promise<{ items?: unknown[]; cursor?: string | null }>;
      for await (const item of streamAll(fn, params, {
        maxPages,
        onTruncated: (msg) => out.stderr.write(msg + "\n"),
      })) {
        out.stdout.write(JSON.stringify(item) + "\n");
      }
    } else {
      const result = await ns.profiles.listConnections(params);
      renderSuccess(result, outOpts, out);
    }
  } catch (err: unknown) {
    const { CurviateError } = await import("@curviate/sdk");
    if (err instanceof CurviateError) {
      const { getExitCode } = await import("../lib/exit-codes.js");
      renderError(err as CurviateError, outOpts, out);
      process.exit(getExitCode(err.code));
    }
    renderUnexpectedError(err, out);
    process.exit(1);
  }
}

/**
 * Run `profile endorse <id> --skill <skill_endorsement_id>`.
 * Write command — supports --preview.
 * Exported for unit-testing.
 */
export async function runProfileEndorse(
  client: MinimalClient,
  flags: SubFlags,
  out: OutputStreams,
): Promise<void> {
  const accountId = requireAccount(flags.account, out);
  const rawId = flags.id ?? "";
  const resolvedId = resolveIdentifier(rawId);
  const skillId = flags.skill ?? "";
  const outOpts = resolveOutputOpts(flags);

  if (flags.preview) {
    const preview = buildPreviewOutput({
      method: "profiles.endorse",
      args: { id: resolvedId },
      body: { skill_endorsement_id: skillId },
      account: accountId,
    });
    out.stdout.write(JSON.stringify(preview) + "\n");
    return;
  }

  const ns = client.account(accountId);

  try {
    const result = await ns.profiles.endorse(resolvedId, { skill_endorsement_id: skillId });
    renderSuccess(result, outOpts, out);
  } catch (err: unknown) {
    const { CurviateError } = await import("@curviate/sdk");
    if (err instanceof CurviateError) {
      const { getExitCode } = await import("../lib/exit-codes.js");
      renderError(err as CurviateError, outOpts, out);
      process.exit(getExitCode(err.code));
    }
    renderUnexpectedError(err, out);
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Citty command definitions
// ---------------------------------------------------------------------------

const profileMeCommand = defineCommand({
  meta: { name: "me", description: "Get your own LinkedIn profile." },
  args: { ...GLOBAL_FLAGS },
  async run({ args }) {
    const flags = args as ProfileFlags;
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
    await runProfileMe(client as unknown as MinimalClient, { ...flags, account: flags.account ?? cfg.account }, out);
  },
});

const profileConnectionsCommand = defineCommand({
  meta: { name: "connections", description: "List your 1st-degree connections." },
  args: { ...GLOBAL_FLAGS },
  async run({ args }) {
    const flags = args as ProfileFlags;
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
    await runProfileConnections(client as unknown as MinimalClient, { ...flags, account: flags.account ?? cfg.account }, out);
  },
});

const profileEndorseCommand = defineCommand({
  meta: { name: "endorse", description: "Endorse a skill on a member's profile." },
  args: {
    ...GLOBAL_FLAGS,
    id: { type: "positional", description: "Member identifier (URL, slug, or URN)." },
    skill: { type: "string", description: "Skill endorsement ID to endorse.", required: true },
  },
  async run({ args }) {
    const flags = args as SubFlags;
    const cfg = await resolveEffectiveConfig({
      apiKey: (args as ProfileFlags)["api-key"],
      baseUrl: (args as ProfileFlags)["base-url"],
      timeout: (args as ProfileFlags).timeout,
      account: flags.account,
      profile: (args as ProfileFlags).profile,
    });
    if (!cfg.apiKey) {
      process.stderr.write("error: no API key — run `curviate login` or pass --api-key.\n");
      process.exit(3);
    }
    const client = createClient({ apiKey: cfg.apiKey, baseUrl: cfg.baseUrl, timeout: cfg.timeout });
    const out = buildOutputStreams();
    await runProfileEndorse(client as unknown as MinimalClient, { ...flags, account: flags.account ?? cfg.account }, out);
  },
});

export const profileCommand = defineCommand({
  meta: { name: "profile", description: "LinkedIn profile operations." },
  args: {
    ...GLOBAL_FLAGS,
    id: { type: "positional", description: "Member identifier (URL, slug, or URN). Optional for subcommands.", required: false },
    posts: { type: "boolean", description: "List the profile's posts.", default: false },
    comments: { type: "boolean", description: "List the profile's comments.", default: false },
    reactions: { type: "boolean", description: "List the profile's reactions.", default: false },
    followers: { type: "boolean", description: "List the profile's followers.", default: false },
    "is-company": { type: "boolean", description: "When listing posts, treat the profile as a company page.", default: false },
    notify: { type: "boolean", description: "Signal a profile view when fetching.", default: false },
  },
  subCommands: {
    me: profileMeCommand,
    connections: profileConnectionsCommand,
    endorse: profileEndorseCommand,
  },
  async run({ args }) {
    const flags = args as ProfileFlags;

    // If an <id> positional was given, we treat this as `profile <id> [flags]`.
    if (!flags.id) {
      process.stderr.write(
        "Usage: curviate profile <id> [--posts|--comments|--reactions|--followers]\n" +
        "       curviate profile me\n" +
        "       curviate profile connections\n" +
        "       curviate profile endorse <id> --skill <sid>\n",
      );
      return;
    }

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
    await runProfileGet(client as unknown as MinimalClient, { ...flags, account: flags.account ?? cfg.account }, out);
  },
});
