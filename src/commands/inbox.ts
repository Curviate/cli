/**
 * `curviate inbox` — messaging inbox operations.
 *
 * Subcommands:
 *   inbox list                   — list chats (paginated, --all/--limit/--cursor)
 *   inbox get <chat_id>          — get a single chat (read, rejects --preview and --all)
 *   inbox messages <chat_id>     — list messages in a chat (paginated)
 *   inbox mark-read <chat_id>    — mark a chat as read (write)
 *
 * <chat_id> on inbox get, inbox messages, and inbox mark-read accepts a LinkedIn
 * messaging thread URL or bare provider ID. Thread URLs are normalized to the bare
 * provider ID (zero network calls).
 *
 * All subcommands are account-scoped.
 */

import { defineCommand } from "citty";
import { GLOBAL_FLAGS, READ_SINGLE_FLAGS, WRITE_SINGLE_FLAGS } from "../lib/global-flags.js";
import { normalizeChatId } from "../lib/identifier.js";
import { resolveEffectiveConfig } from "../lib/resolve.js";
import { createClient } from "../lib/client.js";
import { renderSuccess, renderError, renderUnexpectedError } from "../lib/output.js";
import { buildPreviewOutput } from "../lib/preview.js";
import { streamAll } from "../lib/paginate.js";
import type { Curviate, CurviateError } from "@curviate/sdk";

type InboxFlags = {
  chatId?: string;
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
  // inbox list filter
  unread?: boolean;
  // inbox messages date filters
  before?: string;
  after?: string;
  // inbox sync-chat polling
  wait?: boolean;
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

function rejectAllOnNonPaginated(all: boolean | undefined, out: OutputStreams): void {
  if (all) {
    out.stderr.write("error: --all is not supported on non-paginated commands.\n");
    process.exit(2);
  }
}

function resolveOutputOpts(flags: InboxFlags) {
  return {
    json: (flags.json ?? false) || !process.stdout.isTTY,
    isTTY: process.stdout.isTTY ?? false,
    fields: flags.fields,
  };
}

function buildPaginationParams(flags: InboxFlags): Record<string, unknown> {
  const params: Record<string, unknown> = {};
  if (flags.limit !== undefined) params["limit"] = parseInt(flags.limit, 10);
  if (flags.cursor) params["cursor"] = flags.cursor;
  return params;
}

/**
 * Validate that a timestamp value is a UTC/Z-suffixed ISO-8601 string.
 * Writes an error and exits 2 on failure — call before any SDK call.
 */
function validateIsoZTimestamp(value: string, flagName: string, out: OutputStreams): void {
  if (Number.isNaN(new Date(value).getTime()) || !value.endsWith("Z")) {
    out.stderr.write(
      `error: --${flagName}: must be a UTC ISO-8601 timestamp ending in 'Z' (e.g. 2025-01-01T00:00:00Z).\n`,
    );
    process.exit(2);
  }
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
 * Run `inbox list [--all] [--limit] [--cursor]`.
 * Read command — rejects --preview.
 */
export async function runInboxList(
  client: Curviate,
  flags: InboxFlags,
  out: OutputStreams,
): Promise<void> {
  rejectPreviewOnRead(flags.preview, out);

  const accountId = requireAccount(flags.account, out);
  const ns = client.account(accountId);
  const outOpts = resolveOutputOpts(flags);
  const all = flags.all ?? false;
  const maxPages = flags["max-pages"] ? parseInt(flags["max-pages"], 10) : 100;
  const params = buildPaginationParams(flags);

  // Apply unread filter (three-way: true / false / omit — pass no key when undefined)
  if (flags.unread !== undefined) {
    params.unread = flags.unread;
  }

  try {
    if (all) {
      const fn = (p: Record<string, unknown>) =>
        ns.messaging.listChats(p) as Promise<{ items?: unknown[]; cursor?: string | null }>;
      for await (const item of streamAll(fn, params, {
        maxPages,
        out,
      })) {
        out.stdout.write(JSON.stringify(item) + "\n");
      }
    } else {
      const result = await ns.messaging.listChats(params);
      renderSuccess(result, outOpts, out);
    }
  } catch (err: unknown) {
    await handleSdkError(err, outOpts, out);
  }
}

/**
 * Run `inbox get <chat_id>`.
 * Read command — rejects --preview and --all.
 *
 * <chat_id> accepts a LinkedIn messaging thread URL or bare provider ID.
 * Thread URLs are normalized to the bare provider ID (zero network calls).
 */
export async function runInboxGet(
  client: Curviate,
  flags: InboxFlags,
  out: OutputStreams,
): Promise<void> {
  rejectPreviewOnRead(flags.preview, out);
  rejectAllOnNonPaginated(flags.all, out);

  const accountId = requireAccount(flags.account, out);
  const chatId = normalizeChatId(flags.chatId ?? "");
  const ns = client.account(accountId);
  const outOpts = resolveOutputOpts(flags);

  try {
    const result = await ns.messaging.getChat(chatId);
    renderSuccess(result, outOpts, out);
  } catch (err: unknown) {
    await handleSdkError(err, outOpts, out);
  }
}

/**
 * Run `inbox mark-read <chat_id>` — messaging.markChatRead(chatId, { read: true }).
 * Write command (mutation) — supports --preview. <chat_id> accepts a thread URL
 * or a bare provider id (normalized client-side, zero network calls).
 */
export async function runInboxMarkRead(
  client: Curviate,
  flags: InboxFlags,
  out: OutputStreams,
): Promise<void> {
  const accountId = requireAccount(flags.account, out);
  const chatId = normalizeChatId(flags.chatId ?? "");
  const body = { read: true };

  if (flags.preview) {
    const preview = buildPreviewOutput({ method: "messaging.markChatRead", args: { chat_id: chatId }, body, account: accountId });
    out.stdout.write(JSON.stringify(preview) + "\n");
    return;
  }

  const ns = client.account(accountId);
  const outOpts = resolveOutputOpts(flags);
  try {
    const result = await ns.messaging.markChatRead(chatId, body);
    renderSuccess(result, outOpts, out);
  } catch (err: unknown) {
    await handleSdkError(err, outOpts, out);
  }
}

/**
 * Run `inbox messages <chat_id> [--all] [--limit] [--cursor]`.
 * Read command — rejects --preview.
 *
 * <chat_id> accepts a LinkedIn messaging thread URL or bare provider ID.
 * Thread URLs are normalized to the bare provider ID (zero network calls).
 */
export async function runInboxMessages(
  client: Curviate,
  flags: InboxFlags,
  out: OutputStreams,
): Promise<void> {
  rejectPreviewOnRead(flags.preview, out);

  const accountId = requireAccount(flags.account, out);
  const chatId = normalizeChatId(flags.chatId ?? "");
  const ns = client.account(accountId);
  const outOpts = resolveOutputOpts(flags);
  const all = flags.all ?? false;
  const maxPages = flags["max-pages"] ? parseInt(flags["max-pages"], 10) : 100;
  const params = buildPaginationParams(flags);

  // Validate and apply date filters — validation exits 2 before any SDK call
  if (flags.before !== undefined) {
    validateIsoZTimestamp(flags.before, "before", out);
    params.before = flags.before;
  }
  if (flags.after !== undefined) {
    validateIsoZTimestamp(flags.after, "after", out);
    params.after = flags.after;
  }

  try {
    if (all) {
      const fn = (p: Record<string, unknown>) =>
        ns.messaging.listMessages(chatId, p) as Promise<{ items?: unknown[]; cursor?: string | null }>;
      for await (const item of streamAll(fn, params, {
        maxPages,
        out,
      })) {
        out.stdout.write(JSON.stringify(item) + "\n");
      }
    } else {
      const result = await ns.messaging.listMessages(chatId, params);
      renderSuccess(result, outOpts, out);
    }
  } catch (err: unknown) {
    await handleSdkError(err, outOpts, out);
  }
}

// ---------------------------------------------------------------------------
// Citty command definitions
// ---------------------------------------------------------------------------

const inboxListCommand = defineCommand({
  meta: { name: "list", description: "List inbox chats." },
  args: {
    ...GLOBAL_FLAGS,
    unread: {
      type: "boolean" as const,
      description: "Show unread chats only (--no-unread for read-only; omit for all).",
      // No default → three-way semantics: undefined when omitted, true for --unread, false for --no-unread
    },
  },
  async run({ args }) {
    const flags = args as InboxFlags;
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
    await runInboxList(client, { ...flags, account: flags.account ?? cfg.account }, out);
  },
});

const inboxGetCommand = defineCommand({
  meta: { name: "get", description: "Get details of a single chat." },
  args: {
    // Single-object read: READ_SINGLE_FLAGS omits pagination flags, keeps --fields
    ...READ_SINGLE_FLAGS,
    chatId: { type: "positional", description: "Chat ID." },
  },
  async run({ args }) {
    const flags = args as InboxFlags;
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
    await runInboxGet(client, { ...flags, account: flags.account ?? cfg.account }, out);
  },
});

const inboxMarkReadCommand = defineCommand({
  meta: { name: "mark-read", description: "Mark a chat as read." },
  args: {
    // Write command: WRITE_SINGLE_FLAGS omits pagination flags, keeps --fields
    ...WRITE_SINGLE_FLAGS,
    chatId: { type: "positional", description: "Chat ID or LinkedIn messaging thread URL." },
  },
  async run({ args }) {
    const flags = args as InboxFlags;
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
    await runInboxMarkRead(client, { ...flags, account: flags.account ?? cfg.account }, out);
  },
});

const inboxMessagesCommand = defineCommand({
  meta: { name: "messages", description: "List messages in a chat." },
  args: {
    ...GLOBAL_FLAGS,
    chatId: { type: "positional", description: "Chat ID." },
    before: {
      type: "string" as const,
      description:
        "Return messages before this timestamp (ISO-8601, UTC — Z suffix required, e.g. 2025-01-01T00:00:00Z).",
    },
    after: {
      type: "string" as const,
      description:
        "Return messages after this timestamp (ISO-8601, UTC — Z suffix required, e.g. 2025-01-01T00:00:00Z).",
    },
  },
  async run({ args }) {
    const flags = args as InboxFlags;
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
    await runInboxMessages(client, { ...flags, account: flags.account ?? cfg.account }, out);
  },
});

export const inboxCommand = defineCommand({
  meta: { name: "inbox", description: "Read LinkedIn message inbox." },
  subCommands: {
    list: inboxListCommand,
    get: inboxGetCommand,
    "mark-read": inboxMarkReadCommand,
    messages: inboxMessagesCommand,
  },
  async run() {
    process.stderr.write(
      "Usage: curviate inbox <subcommand>\n" +
      "  list\n" +
      "  get <chat_id>\n" +
      "  mark-read <chat_id>\n" +
      "  messages <chat_id>\n",
    );
  },
});
