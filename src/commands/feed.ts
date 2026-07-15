/**
 * `curviate feed` — the connected account's LinkedIn home feed.
 *
 * Subcommands:
 *   feed home [--sort recent|relevant]     — read the home feed (read, paginated)
 *
 * A read command: --preview is a usage error (exit 2). The feed is an
 * unbounded, reordering stream with no total count — walk it with the returned
 * cursor until cursor is null. Each post carries the numeric activity id you
 * pass to the `post` group to react, comment, or fetch detail.
 */

import { defineCommand } from "citty";
import { GLOBAL_FLAGS } from "../lib/global-flags.js";
import { streamAll, pageDelayFromFlags } from "../lib/paginate.js";
import { resolveEffectiveConfig } from "../lib/resolve.js";
import { createClient } from "../lib/client.js";
import { renderSuccess, renderError, renderUnexpectedError } from "../lib/output.js";
import type { Curviate, CurviateError } from "@curviate/sdk";

type FeedFlags = {
  sort?: string;
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

type FeedQuery = { sort?: "recent" | "relevant"; limit?: number; cursor?: string };

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

function resolveOutputOpts(flags: FeedFlags) {
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

/**
 * Run `feed home [--sort recent|relevant] [--limit] [--cursor] [--all]` — feed.home.
 * `--sort recent` (default) is reverse-chronological and always available;
 * `--sort relevant` is LinkedIn's ranked "top" feed (a throttled budget — can
 * rate-limit). When a cursor is supplied its carrier is authoritative and
 * --sort is ignored.
 */
export async function runFeedHome(
  client: Curviate,
  flags: FeedFlags,
  out: OutputStreams,
): Promise<void> {
  rejectPreviewOnRead(flags.preview, out);
  const accountId = requireAccount(flags.account, out);
  const ns = client.account(accountId);
  const outOpts = resolveOutputOpts(flags);
  const all = flags.all ?? false;
  const maxPages = flags["max-pages"] ? parseInt(flags["max-pages"], 10) : 100;
  const params: FeedQuery = {};
  // Forward the user's --sort verbatim; the server is authoritative and rejects
  // an out-of-enum value with INVALID_REQUEST (exit 2).
  if (flags.sort) params.sort = flags.sort as FeedQuery["sort"];
  if (flags.limit) params.limit = parseInt(flags.limit, 10);
  if (flags.cursor) params.cursor = flags.cursor;

  try {
    if (all) {
      const fn = (p: FeedQuery) => ns.feed.home(p) as Promise<{ items?: unknown[]; cursor?: string | null }>;
      for await (const item of streamAll(fn, params, {
        maxPages,
        out,
        pageDelayMs: pageDelayFromFlags(flags),
      })) {
        out.stdout.write(JSON.stringify(item) + "\n");
      }
    } else {
      const result = await ns.feed.home(params);
      renderSuccess(result, outOpts, out);
    }
  } catch (err: unknown) {
    await handleSdkError(err, outOpts, out);
  }
}

// ---------------------------------------------------------------------------
// Citty command definitions
// ---------------------------------------------------------------------------

const feedHomeCommand = defineCommand({
  meta: {
    name: "home",
    description:
      "Read your connected account's LinkedIn home feed as agent-actionable posts. " +
      "--sort recent (default) is reverse-chronological and always available; --sort relevant is LinkedIn's ranked 'top' feed (a throttled budget — can rate-limit). " +
      "The feed is an unbounded, reordering stream with no total count — walk it with the returned cursor until cursor is null (--all streams every page as NDJSON). " +
      "When a --cursor is supplied its carrier sets the sort and --sort is ignored. Each post carries the numeric activity id for the `post` group. " +
      "The feed is an index on the default recent sort — text is null by design (the body is never resolved there); hydrate the full post body via `post get <activity_urn_id>`. --sort relevant resolves text inline, so no hydration call is needed on that sort.",
  },
  args: {
    ...GLOBAL_FLAGS,
    sort: { type: "string", description: "Feed order: recent (default, reverse-chronological) or relevant (LinkedIn's ranked top feed)." },
  },
  async run({ args }) {
    const flags = args as FeedFlags;
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
    await runFeedHome(client, { ...flags, account: flags.account ?? cfg.account }, out);
  },
});

export const feedCommand = defineCommand({
  meta: { name: "feed", description: "Read the connected account's LinkedIn home feed." },
  subCommands: {
    home: feedHomeCommand,
  },
  async run() {
    process.stderr.write(
      "Usage: curviate feed <subcommand>\n" +
      "  home [--sort recent|relevant]    read the home feed (walk the cursor; --all to stream every page)\n",
    );
  },
});
