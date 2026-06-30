/**
 * `curviate inbox` — messaging inbox operations.
 *
 * Subcommands:
 *   inbox list                   — list chats (paginated, --all/--limit/--cursor)
 *   inbox get <chat_id>          — get a single chat (read, rejects --preview and --all)
 *   inbox messages <chat_id>     — list messages in a chat (paginated)
 *   inbox sync                   — re-sync account message history (read, rejects --preview/--all)
 *   inbox sync-chat <chat_id>    — re-sync a specific chat (read, rejects --preview/--all)
 *
 * <chat_id> on inbox get, inbox messages, and inbox sync-chat accepts a LinkedIn
 * messaging thread URL or bare provider ID. Thread URLs are normalized to the bare
 * provider ID (zero network calls).
 *
 * All subcommands are account-scoped.
 */

import { defineCommand } from "citty";
import { GLOBAL_FLAGS } from "../lib/global-flags.js";
import { normalizeChatId } from "../lib/identifier.js";
import { resolveEffectiveConfig } from "../lib/resolve.js";
import { createClient } from "../lib/client.js";
import { renderSuccess, renderError, renderUnexpectedError } from "../lib/output.js";
import { streamAll } from "../lib/paginate.js";
import type { CurviateError } from "@curviate/sdk";

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

type MinimalClient = {
  account: (id: string) => {
    messaging: {
      listChats: (params?: Record<string, unknown>) => Promise<unknown>;
      getChat: (chatId: string) => Promise<unknown>;
      listMessages: (chatId: string, params?: Record<string, unknown>) => Promise<unknown>;
      syncMessages: (params?: Record<string, unknown>) => Promise<unknown>;
      syncChat: (chatId: string) => Promise<unknown>;
    };
  };
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
  client: MinimalClient,
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
        onTruncated: (msg) => out.stderr.write(msg + "\n"),
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
  client: MinimalClient,
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
 * Run `inbox messages <chat_id> [--all] [--limit] [--cursor]`.
 * Read command — rejects --preview.
 *
 * <chat_id> accepts a LinkedIn messaging thread URL or bare provider ID.
 * Thread URLs are normalized to the bare provider ID (zero network calls).
 */
export async function runInboxMessages(
  client: MinimalClient,
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
        onTruncated: (msg) => out.stderr.write(msg + "\n"),
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

/**
 * Run `inbox sync`.
 * Read command — rejects --preview and --all.
 */
export async function runInboxSync(
  client: MinimalClient,
  flags: InboxFlags,
  out: OutputStreams,
): Promise<void> {
  rejectPreviewOnRead(flags.preview, out);
  rejectAllOnNonPaginated(flags.all, out);

  const accountId = requireAccount(flags.account, out);
  const ns = client.account(accountId);
  const outOpts = resolveOutputOpts(flags);

  try {
    const result = await ns.messaging.syncMessages();
    renderSuccess(result, outOpts, out);
  } catch (err: unknown) {
    await handleSdkError(err, outOpts, out);
  }
}

/** Terminal sync statuses that end --wait polling. */
const SYNC_TERMINAL_STATUSES = new Set(["done", "error", "chat_deleted"]);

/** Default poll interval for --wait mode. */
const SYNC_POLL_INTERVAL_MS = 2000;

/**
 * Run `inbox sync-chat <chat_id> [--wait] [--timeout <sec>]`.
 * Read command — rejects --preview and --all.
 *
 * <chat_id> accepts a LinkedIn messaging thread URL or bare provider ID.
 * Thread URLs are normalized to the bare provider ID (zero network calls).
 *
 * When --wait is set, polls every ~2s until status reaches a terminal value
 * (done | error | chat_deleted) or --timeout seconds elapse (exit 3 on timeout).
 *
 * The optional _sleep parameter replaces the real setTimeout in tests so the
 * hermetic suite does not wait real seconds between polls.
 */
export async function runInboxSyncChat(
  client: MinimalClient,
  flags: InboxFlags,
  out: OutputStreams,
  _sleep?: (ms: number) => Promise<void>,
): Promise<void> {
  rejectPreviewOnRead(flags.preview, out);
  rejectAllOnNonPaginated(flags.all, out);

  const accountId = requireAccount(flags.account, out);
  const chatId = normalizeChatId(flags.chatId ?? "");
  const ns = client.account(accountId);
  const outOpts = resolveOutputOpts(flags);

  if (!flags.wait) {
    // No --wait: single call, return immediately (back-compat)
    try {
      const result = await ns.messaging.syncChat(chatId);
      renderSuccess(result, outOpts, out);
    } catch (err: unknown) {
      await handleSdkError(err, outOpts, out);
    }
    return;
  }

  // --wait mode: poll until terminal status or timeout
  const sleep = _sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const timeoutSecs = parseInt(flags.timeout ?? "30", 10);
  const timeoutMs = (Number.isNaN(timeoutSecs) ? 30 : timeoutSecs) * 1000;
  const startTime = Date.now();

  while (true) {
    let result: unknown;
    try {
      result = await ns.messaging.syncChat(chatId);
    } catch (err: unknown) {
      await handleSdkError(err, outOpts, out);
    }
    const resp = result as { status?: string };
    if (resp.status !== undefined && SYNC_TERMINAL_STATUSES.has(resp.status)) {
      renderSuccess(result, outOpts, out);
      return;
    }
    if (Date.now() - startTime >= timeoutMs) {
      renderSuccess(result, outOpts, out);
      process.exit(3);
      return; // unreachable; satisfies TypeScript
    }
    await sleep(SYNC_POLL_INTERVAL_MS);
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
    await runInboxList(client as unknown as MinimalClient, { ...flags, account: flags.account ?? cfg.account }, out);
  },
});

const inboxGetCommand = defineCommand({
  meta: { name: "get", description: "Get details of a single chat." },
  args: {
    ...GLOBAL_FLAGS,
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
    await runInboxGet(client as unknown as MinimalClient, { ...flags, account: flags.account ?? cfg.account }, out);
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
    await runInboxMessages(client as unknown as MinimalClient, { ...flags, account: flags.account ?? cfg.account }, out);
  },
});

const inboxSyncCommand = defineCommand({
  meta: { name: "sync", description: "Re-sync account message history." },
  args: { ...GLOBAL_FLAGS },
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
    await runInboxSync(client as unknown as MinimalClient, { ...flags, account: flags.account ?? cfg.account }, out);
  },
});

const inboxSyncChatCommand = defineCommand({
  meta: { name: "sync-chat", description: "Re-sync a specific chat's message history." },
  args: {
    ...GLOBAL_FLAGS,
    chatId: { type: "positional", description: "Chat ID." },
    wait: {
      type: "boolean" as const,
      description: "Poll until sync completes (or --timeout elapses).",
      default: false,
    },
    // Override GLOBAL_FLAGS.timeout description: for this command --timeout is the
    // polling wait timeout in seconds (default: 30), not the SDK request timeout.
    timeout: {
      type: "string" as const,
      description: "Polling timeout in seconds (default: 30, requires --wait).",
    },
  },
  async run({ args }) {
    const flags = args as InboxFlags;
    // --timeout on this command is the wait polling timeout (seconds), not the SDK
    // request timeout. Resolve config without it so the SDK uses its default timeout.
    const cfg = await resolveEffectiveConfig({
      apiKey: flags["api-key"],
      baseUrl: flags["base-url"],
      account: flags.account,
      profile: flags.profile,
    });
    if (!cfg.apiKey) {
      process.stderr.write("error: no API key — run `curviate login` or pass --api-key.\n");
      process.exit(3);
    }
    const client = createClient({ apiKey: cfg.apiKey, baseUrl: cfg.baseUrl, timeout: cfg.timeout });
    const out = buildOutputStreams();
    await runInboxSyncChat(client as unknown as MinimalClient, { ...flags, account: flags.account ?? cfg.account }, out);
  },
});

export const inboxCommand = defineCommand({
  meta: { name: "inbox", description: "Read and sync LinkedIn message inbox." },
  subCommands: {
    list: inboxListCommand,
    get: inboxGetCommand,
    messages: inboxMessagesCommand,
    sync: inboxSyncCommand,
    "sync-chat": inboxSyncChatCommand,
  },
  async run() {
    process.stderr.write(
      "Usage: curviate inbox <subcommand>\n" +
      "  list\n" +
      "  get <chat_id>\n" +
      "  messages <chat_id>\n" +
      "  sync\n" +
      "  sync-chat <chat_id>\n",
    );
  },
});
