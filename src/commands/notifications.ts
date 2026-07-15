/**
 * `curviate notifications` — the connected account's own notification centre.
 *
 * Subcommands:
 *   notifications list [--filter <stream>]     — list notification cards (read, paginated)
 *   notifications delete <card_urn>            — delete one card (write, --preview-capable)
 *   notifications show-less <card_urn>         — "show less like this" on one card (write)
 *
 * Both writes are self-actions — they act only on the account's OWN cards and
 * never notify or touch a third party. Both are idempotent and effective within
 * a few seconds for an ORGANIC card (network-activity — a repost/comment/
 * reaction by your network): deleting (or show-lessing) a card that is already
 * gone succeeds, not an error; only a card_urn that never existed on this
 * account 404s. A `list` re-read immediately after a write may still show the
 * card for a moment — that is not a failure signal. `delete` on an
 * editorial/promotional card is honest about its limits: LinkedIn most likely
 * re-injects those cards, so a 200 is a correct accepted-request response, not
 * a guarantee the card stays gone — `show-less` is the reliable way to
 * suppress promo content (live-verified: an editorial card's delete was
 * accepted but the card persisted 15+ minutes, while show-less on the same
 * mutation path removed it). Following the destructive-write convention (see
 * `job close`): --preview renders the request, and there is no confirmation
 * prompt (the idempotent, reversible-in-spirit semantics make one redundant).
 *
 * Both writes take the card's ENTITY urn (`urn:li:fsd_notificationCard:(…)`, the
 * `card_urn` field of a `notifications list` item — NOT its `object_urn`, which
 * targets the wrong notification). A card urn embeds `(`, `)`, `:`, `,`; pass it
 * raw — the SDK percent-encodes it into the path segment and the server decodes
 * it back.
 */

import { defineCommand } from "citty";
import { GLOBAL_FLAGS, WRITE_SINGLE_FLAGS } from "../lib/global-flags.js";
import { buildPreviewOutput } from "../lib/preview.js";
import { streamAll, pageDelayFromFlags } from "../lib/paginate.js";
import { resolveEffectiveConfig } from "../lib/resolve.js";
import { createClient } from "../lib/client.js";
import { renderSuccess, renderError, renderUnexpectedError } from "../lib/output.js";
import type { Curviate, CurviateError } from "@curviate/sdk";

type NotificationsFlags = {
  cardUrn?: string;
  filter?: string;
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

type ListQuery = {
  filter?: "all" | "jobs" | "mentions" | "my_posts" | "my_posts_comments" | "my_posts_reactions" | "my_posts_reposts";
  limit?: number;
  cursor?: string;
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

function resolveOutputOpts(flags: NotificationsFlags) {
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
 * Run `notifications list [--filter <stream>] [--limit] [--cursor] [--all]` — notifications.list.
 * Prints the cards newest-first plus the account-level unread_count (the unseen
 * badge — NOT a count of items) and latest_published_at (a cheap poll
 * watermark). Injected/promo cards are included and flagged. This feed
 * throttles hard under fast polling — poll unread_count rather than deep-paging.
 */
export async function runNotificationsList(
  client: Curviate,
  flags: NotificationsFlags,
  out: OutputStreams,
): Promise<void> {
  rejectPreviewOnRead(flags.preview, out);
  const accountId = requireAccount(flags.account, out);
  const ns = client.account(accountId);
  const outOpts = resolveOutputOpts(flags);
  const all = flags.all ?? false;
  const maxPages = flags["max-pages"] ? parseInt(flags["max-pages"], 10) : 100;
  const params: ListQuery = {};
  // Forward the user's --filter verbatim; the server is authoritative and
  // rejects an out-of-enum value with INVALID_REQUEST (exit 2).
  if (flags.filter) params.filter = flags.filter as ListQuery["filter"];
  if (flags.limit) params.limit = parseInt(flags.limit, 10);
  if (flags.cursor) params.cursor = flags.cursor;

  try {
    if (all) {
      const fn = (p: ListQuery) => ns.notifications.list(p) as Promise<{ items?: unknown[]; cursor?: string | null }>;
      for await (const item of streamAll(fn, params, {
        maxPages,
        out,
        pageDelayMs: pageDelayFromFlags(flags),
      })) {
        out.stdout.write(JSON.stringify(item) + "\n");
      }
    } else {
      const result = await ns.notifications.list(params);
      renderSuccess(result, outOpts, out);
    }
  } catch (err: unknown) {
    await handleSdkError(err, outOpts, out);
  }
}

/**
 * Run `notifications delete <card_urn>` — notifications.delete (write).
 * Deletes one of the account's own cards by its card urn. A self-action — no
 * third party is notified. Idempotent (a repeat 200s), effective within a few
 * seconds. --preview renders the request without sending.
 */
export async function runNotificationsDelete(
  client: Curviate,
  flags: NotificationsFlags,
  out: OutputStreams,
): Promise<void> {
  const accountId = requireAccount(flags.account, out);
  const cardUrn = flags.cardUrn ?? "";

  if (flags.preview) {
    const preview = buildPreviewOutput({ method: "notifications.delete", args: { card_urn: cardUrn }, body: {}, account: accountId });
    out.stdout.write(JSON.stringify(preview) + "\n");
    return;
  }

  const ns = client.account(accountId);
  const outOpts = resolveOutputOpts(flags);
  try {
    const result = await ns.notifications.delete(cardUrn);
    renderSuccess(result, outOpts, out);
  } catch (err: unknown) {
    await handleSdkError(err, outOpts, out);
  }
}

/**
 * Run `notifications show-less <card_urn>` — notifications.showLess (write).
 * Applies "show less like this" to one of the account's own cards. For a
 * network-activity card this removes the card (LinkedIn exposes no softer
 * signal). Same self-action, card-handle, idempotency, and timing contract as
 * `delete`. --preview renders the request without sending.
 */
export async function runNotificationsShowLess(
  client: Curviate,
  flags: NotificationsFlags,
  out: OutputStreams,
): Promise<void> {
  const accountId = requireAccount(flags.account, out);
  const cardUrn = flags.cardUrn ?? "";

  if (flags.preview) {
    const preview = buildPreviewOutput({ method: "notifications.showLess", args: { card_urn: cardUrn }, body: {}, account: accountId });
    out.stdout.write(JSON.stringify(preview) + "\n");
    return;
  }

  const ns = client.account(accountId);
  const outOpts = resolveOutputOpts(flags);
  try {
    const result = await ns.notifications.showLess(cardUrn);
    renderSuccess(result, outOpts, out);
  } catch (err: unknown) {
    await handleSdkError(err, outOpts, out);
  }
}

// ---------------------------------------------------------------------------
// Citty command definitions
// ---------------------------------------------------------------------------

/** Shared config/client boilerplate for a subcommand's run(). */
async function withClient(
  flags: NotificationsFlags,
  fn: (client: Curviate, flags: NotificationsFlags, out: OutputStreams) => Promise<void>,
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

const notificationsListCommand = defineCommand({
  meta: {
    name: "list",
    description:
      "List your connected account's notification cards, newest first, plus the account-level unread_count (the unseen badge — NOT a count of items) and latest_published_at (a cheap poll watermark). " +
      "Injected/promo cards are included and flagged (injected:true), never filtered. Pass --filter to select one stream. " +
      "Paginate with the returned cursor (--all streams every page; walk until cursor is null) — but this feed throttles hard under fast polling, so poll unread_count rather than deep-paging.",
  },
  args: {
    ...GLOBAL_FLAGS,
    filter: {
      type: "string",
      description: "Notification stream (default all): all | jobs | mentions | my_posts | my_posts_comments | my_posts_reactions | my_posts_reposts.",
    },
  },
  async run({ args }) {
    await withClient(args as NotificationsFlags, runNotificationsList);
  },
});

const notificationsDeleteCommand = defineCommand({
  meta: {
    name: "delete",
    description:
      "Delete one of your connected account's own notification cards by its card urn — a self-action, notifies no one, cannot be undone. " +
      "Safe to retry: idempotent (deleting an already-gone card succeeds); only a card_urn that never existed 404s. Effective within a few seconds for an ORGANIC card (network-activity — a repost/comment/reaction by your network); a list re-read immediately after may still show the card briefly. " +
      "CAVEAT: LinkedIn may re-inject an editorial/promotional card, so its deletion may not stick even though the request itself succeeds — use `show-less` instead to suppress promo content. " +
      "Pass the card_urn (urn:li:fsd_notificationCard:(…)) from a `notifications list` item — NOT object_urn. Use --preview to render the request without sending.",
  },
  args: {
    ...WRITE_SINGLE_FLAGS,
    cardUrn: { type: "positional", description: "The card's entity urn (urn:li:fsd_notificationCard:(…)) from a `notifications list` item. Passed raw — the CLI encodes it." },
  },
  async run({ args }) {
    await withClient(args as NotificationsFlags, runNotificationsDelete);
  },
});

const notificationsShowLessCommand = defineCommand({
  meta: {
    name: "show-less",
    description:
      "Apply 'show less like this' to one of your connected account's own notification cards — a self-action, notifies no one, cannot be undone. " +
      "For a network-activity card (a repost/comment/reaction by your network) this removes the card, the same effect as delete (LinkedIn exposes no softer signal). " +
      "Same card handle, idempotency, and timing as delete. Pass the card_urn from a `notifications list` item. Use --preview to render the request without sending.",
  },
  args: {
    ...WRITE_SINGLE_FLAGS,
    cardUrn: { type: "positional", description: "The card's entity urn (urn:li:fsd_notificationCard:(…)) from a `notifications list` item. Passed raw — the CLI encodes it." },
  },
  async run({ args }) {
    await withClient(args as NotificationsFlags, runNotificationsShowLess);
  },
});

export const notificationsCommand = defineCommand({
  meta: { name: "notifications", description: "Read and manage the connected account's own notification centre." },
  subCommands: {
    list: notificationsListCommand,
    delete: notificationsDeleteCommand,
    "show-less": notificationsShowLessCommand,
  },
  async run() {
    process.stderr.write(
      "Usage: curviate notifications <subcommand>\n" +
      "  list [--filter <stream>]      list your notification cards (poll unread_count rather than deep-paging)\n" +
      "  delete <card_urn>             delete one of your own cards (idempotent; --preview to inspect)\n" +
      "  show-less <card_urn>          'show less like this' on one of your own cards (--preview to inspect)\n",
    );
  },
});
