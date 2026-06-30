/**
 * `curviate message` — LinkedIn message operations.
 *
 * Subcommands:
 *   message new --to <url|slug|provider_id> "<text>" [--attach <file>…] — start new chat (write)
 *   message <chat_id> "<text>" [--attach <file>…]              — send message to chat (write)
 *   message get <message_id>                                    — get a message (read)
 *   message edit <message_id> "<text>"                         — edit a message (write)
 *   message delete <message_id>                                 — delete a message (write)
 *   message react <message_id> --emoji <e>                     — react to message (write, body field: reaction)
 *   message attachment <message_id> <attachment_id> [-o <file>] — download attachment (binary)
 *   message inmail --to <url|slug|provider-id|urn> --surface <s> --subject <s> "<text>" — send InMail (write)
 *   message inmail-balance                                      — get InMail credit balance (read)
 *
 * chat_id / message_id / attachment_id pass through verbatim.
 * --to for `message new` accepts a LinkedIn URL, bare slug, or provider ID.
 *   URL/slug inputs resolve via profiles.get; provider-ID-shaped inputs pass through directly.
 * --to for `message inmail` accepts a LinkedIn URL, bare slug, provider ID, or member URN.
 *   URL/slug inputs resolve via profiles.get; URN and provider-ID pass through directly.
 * --surface for `message inmail` is required (sales_nav | recruiter | classic).
 * <chat_id> on `message send` accepts a LinkedIn messaging thread URL or bare provider ID;
 *   thread URLs are normalized to the bare provider ID (zero network calls).
 */

import { defineCommand } from "citty";
import { WRITE_FLAGS, READ_SINGLE_FLAGS } from "../lib/global-flags.js";
import { resolveIdentifier, normalizeChatId } from "../lib/identifier.js";
import { resolveTextOrStdin } from "../lib/stdin.js";
import { resolveEffectiveConfig } from "../lib/resolve.js";
import { createClient } from "../lib/client.js";
import { renderSuccess, renderError, renderUnexpectedError } from "../lib/output.js";
import { buildPreviewOutput } from "../lib/preview.js";
import { readAttachment, AttachError } from "../lib/attach.js";
import { writeBinaryOutput, BinaryOutputError } from "../lib/binary.js";
import type { CurviateError } from "@curviate/sdk";

type MessageFlags = {
  chatId?: string;
  messageId?: string;
  attachmentId?: string;
  to?: string;
  text?: string;
  emoji?: string;
  subject?: string;
  surface?: string;
  output?: string;
  attach?: string | string[];
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

type OutputStreams = {
  stdout: { write: (s: string) => void };
  stderr: { write: (s: string) => void };
};

type MinimalClient = {
  account: (id: string) => {
    profiles: {
      get: (id: string, params?: Record<string, unknown>) => Promise<Record<string, unknown>>;
    };
    messaging: {
      startChat: (body: Record<string, unknown>) => Promise<unknown>;
      sendMessage: (chatId: string, body: Record<string, unknown>) => Promise<unknown>;
      getMessage: (messageId: string) => Promise<unknown>;
      editMessage: (messageId: string, body: Record<string, unknown>) => Promise<unknown>;
      deleteMessage: (messageId: string) => Promise<unknown>;
      addReaction: (messageId: string, body: Record<string, unknown>) => Promise<unknown>;
      getAttachment: (messageId: string, attachmentId: string) => Promise<ArrayBuffer>;
      sendInMail: (body: Record<string, unknown>) => Promise<unknown>;
      getInMailBalance: (params?: Record<string, unknown>) => Promise<unknown>;
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

function resolveOutputOpts(flags: MessageFlags) {
  return {
    json: (flags.json ?? false) || !process.stdout.isTTY,
    isTTY: process.stdout.isTTY ?? false,
    fields: flags.fields,
  };
}

/** Normalize --attach flag to an array of paths. */
function normalizeAttachPaths(attach: string | string[] | undefined): string[] {
  if (!attach) return [];
  return Array.isArray(attach) ? attach : [attach];
}

/** Valid InMail surfaces — must match the API enum exactly. */
const INMAIL_SURFACES = ["sales_nav", "recruiter", "classic"] as const;


/** A LinkedIn member URN: urn:li:member:<digits>. */
const MEMBER_URN_RE = /^urn:li:member:\d+$/;

/**
 * A LinkedIn member provider id (e.g. ACoAAA…): "A", then C|D|E, then ≥4 id chars.
 * Provider IDs always start with an uppercase A followed by C, D, or E.
 * LinkedIn profile slugs are lowercase, so this prefix uniquely identifies provider IDs.
 */
const MEMBER_PROVIDER_ID_RE = /^A[CDE][A-Za-z0-9_-]{4,}$/;

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
 * Run `message new --to <url|slug|provider_id> "<text>" [--attach <file>…]`.
 * Write command — supports --preview.
 *
 * --to resolution:
 *   LinkedIn URL or bare slug → profiles.get(slug) → provider_id passed to startChat.
 *   Provider-ID-shaped input (uppercase AC/AD/AE prefix) → passed directly, no profiles.get call.
 *   profiles.get not-found → exit 4.
 */
export async function runMessageNew(
  client: MinimalClient,
  flags: MessageFlags,
  out: OutputStreams,
  _readStdin?: () => Promise<string>,
): Promise<void> {
  const accountId = requireAccount(flags.account, out);
  const rawTo = flags.to ?? "";
  const rawText = flags.text ?? "";
  const attachPaths = normalizeAttachPaths(flags.attach);

  // Load attachments before any SDK call.
  let attachBuffers: Buffer[] = [];
  try {
    attachBuffers = await Promise.all(attachPaths.map((p) => readAttachment(p)));
  } catch (err: unknown) {
    if (err instanceof AttachError) {
      out.stderr.write(`error: ${err.message}\n`);
      process.exit(err.exitCode);
    }
    throw err;
  }

  const ns = client.account(accountId);
  const outOpts = resolveOutputOpts(flags);

  // Resolve stdin sentinel: "-" reads all of stdin.
  const text = await resolveTextOrStdin(rawText, out, _readStdin);

  // Resolve the recipient to a provider ID.
  // URL/slug inputs call profiles.get; provider-ID-shaped inputs pass through directly.
  const resolvedSlugOrId = resolveIdentifier(rawTo);
  let providerId: string | undefined;

  if (MEMBER_PROVIDER_ID_RE.test(resolvedSlugOrId)) {
    // Already a provider ID — use directly without an extra SDK call.
    providerId = resolvedSlugOrId;
  } else {
    // Slug or other form — resolve via profiles.get.
    try {
      const profileData = await ns.profiles.get(resolvedSlugOrId, {});
      providerId = profileData["provider_id"] as string;
    } catch (err: unknown) {
      await handleSdkError(err, outOpts, out);
      return; // unreachable: handleSdkError always calls process.exit
    }
  }

  const body: Record<string, unknown> = {
    attendees_ids: [providerId!],
    text,
  };

  if (flags.preview) {
    const preview = buildPreviewOutput({
      method: "messaging.startChat",
      args: { attendees_ids: [providerId!] },
      body: { ...body },
      account: accountId,
      attachments: attachBuffers.map((buf, i) => ({
        name: attachPaths[i] ? attachPaths[i].split("/").pop() ?? attachPaths[i] : `attachment_${i}`,
        buffer: buf,
      })),
    });
    out.stdout.write(JSON.stringify(preview) + "\n");
    return;
  }

  if (attachBuffers.length > 0) {
    body["attachments"] = attachBuffers;
  }

  try {
    const result = await ns.messaging.startChat(body);
    renderSuccess(result, outOpts, out);
  } catch (err: unknown) {
    await handleSdkError(err, outOpts, out);
  }
}

/**
 * Run `message <chat_id> "<text>" [--attach <file>…]`.
 * Write command — supports --preview.
 *
 * <chat_id> accepts a LinkedIn messaging thread URL or bare provider ID.
 * Thread URLs are normalized to the bare provider ID (zero network calls).
 */
export async function runMessageSend(
  client: MinimalClient,
  flags: MessageFlags,
  out: OutputStreams,
  _readStdin?: () => Promise<string>,
): Promise<void> {
  const accountId = requireAccount(flags.account, out);
  const chatId = normalizeChatId(flags.chatId ?? "");
  const rawText = flags.text ?? "";
  const attachPaths = normalizeAttachPaths(flags.attach);

  // Resolve stdin sentinel: "-" reads all of stdin.
  const text = await resolveTextOrStdin(rawText, out, _readStdin);

  // Load attachments before any preview or SDK call.
  let attachBuffers: Buffer[] = [];
  try {
    attachBuffers = await Promise.all(attachPaths.map((p) => readAttachment(p)));
  } catch (err: unknown) {
    if (err instanceof AttachError) {
      out.stderr.write(`error: ${err.message}\n`);
      process.exit(err.exitCode);
    }
    throw err;
  }

  const body: Record<string, unknown> = { text };

  if (flags.preview) {
    const preview = buildPreviewOutput({
      method: "messaging.sendMessage",
      args: { chat_id: chatId },
      body: { ...body },
      account: accountId,
      attachments: attachBuffers.map((buf, i) => ({
        name: attachPaths[i] ? attachPaths[i].split("/").pop() ?? attachPaths[i] : `attachment_${i}`,
        buffer: buf,
      })),
    });
    out.stdout.write(JSON.stringify(preview) + "\n");
    return;
  }

  if (attachBuffers.length > 0) {
    body["attachments"] = attachBuffers;
  }

  const ns = client.account(accountId);
  const outOpts = resolveOutputOpts(flags);

  try {
    const result = await ns.messaging.sendMessage(chatId, body);
    renderSuccess(result, outOpts, out);
  } catch (err: unknown) {
    await handleSdkError(err, outOpts, out);
  }
}

/**
 * Run `message get <message_id>`.
 * Read command — rejects --preview and --all.
 */
export async function runMessageGet(
  client: MinimalClient,
  flags: MessageFlags,
  out: OutputStreams,
): Promise<void> {
  rejectPreviewOnRead(flags.preview, out);
  rejectAllOnNonPaginated(flags.all, out);

  const accountId = requireAccount(flags.account, out);
  const messageId = flags.messageId ?? "";
  const ns = client.account(accountId);
  const outOpts = resolveOutputOpts(flags);

  try {
    const result = await ns.messaging.getMessage(messageId);
    renderSuccess(result, outOpts, out);
  } catch (err: unknown) {
    await handleSdkError(err, outOpts, out);
  }
}

/**
 * Run `message edit <message_id> "<text>"`.
 * Write command — supports --preview.
 */
export async function runMessageEdit(
  client: MinimalClient,
  flags: MessageFlags,
  out: OutputStreams,
  _readStdin?: () => Promise<string>,
): Promise<void> {
  const accountId = requireAccount(flags.account, out);
  const messageId = flags.messageId ?? "";
  const rawText = flags.text ?? "";

  // Resolve stdin sentinel: "-" reads all of stdin.
  const text = await resolveTextOrStdin(rawText, out, _readStdin);

  if (flags.preview) {
    const preview = buildPreviewOutput({
      method: "messaging.editMessage",
      args: { message_id: messageId },
      body: { text },
      account: accountId,
    });
    out.stdout.write(JSON.stringify(preview) + "\n");
    return;
  }

  const ns = client.account(accountId);
  const outOpts = resolveOutputOpts(flags);

  try {
    const result = await ns.messaging.editMessage(messageId, { text });
    renderSuccess(result, outOpts, out);
  } catch (err: unknown) {
    await handleSdkError(err, outOpts, out);
  }
}

/**
 * Run `message delete <message_id>`.
 * Write command — supports --preview.
 */
export async function runMessageDelete(
  client: MinimalClient,
  flags: MessageFlags,
  out: OutputStreams,
): Promise<void> {
  const accountId = requireAccount(flags.account, out);
  const messageId = flags.messageId ?? "";

  if (flags.preview) {
    const preview = buildPreviewOutput({
      method: "messaging.deleteMessage",
      args: { message_id: messageId },
      body: {},
      account: accountId,
    });
    out.stdout.write(JSON.stringify(preview) + "\n");
    return;
  }

  const ns = client.account(accountId);
  const outOpts = resolveOutputOpts(flags);

  try {
    const result = await ns.messaging.deleteMessage(messageId);
    renderSuccess(result, outOpts, out);
  } catch (err: unknown) {
    await handleSdkError(err, outOpts, out);
  }
}

/**
 * Run `message react <message_id> --emoji <e>`.
 * Write command — supports --preview.
 * CLI flag is --emoji; the SDK body field is `reaction` (confirmed from AddReactionBody).
 */
export async function runMessageReact(
  client: MinimalClient,
  flags: MessageFlags,
  out: OutputStreams,
): Promise<void> {
  const accountId = requireAccount(flags.account, out);
  const messageId = flags.messageId ?? "";
  const reaction = flags.emoji ?? "";

  if (flags.preview) {
    const preview = buildPreviewOutput({
      method: "messaging.addReaction",
      args: { message_id: messageId },
      body: { reaction },
      account: accountId,
    });
    out.stdout.write(JSON.stringify(preview) + "\n");
    return;
  }

  const ns = client.account(accountId);
  const outOpts = resolveOutputOpts(flags);

  try {
    const result = await ns.messaging.addReaction(messageId, { reaction });
    renderSuccess(result, outOpts, out);
  } catch (err: unknown) {
    await handleSdkError(err, outOpts, out);
  }
}

/**
 * Run `message attachment <message_id> <attachment_id> [-o <file>]`.
 * Read command — binary response. Rejects --preview.
 * @param isTTY — injectable for tests (avoids reading process.stdout.isTTY)
 */
export async function runMessageAttachment(
  client: MinimalClient,
  flags: MessageFlags,
  out: OutputStreams,
  isTTY: boolean,
): Promise<void> {
  rejectPreviewOnRead(flags.preview, out);

  const accountId = requireAccount(flags.account, out);
  const messageId = flags.messageId ?? "";
  const attachmentId = flags.attachmentId ?? "";
  const ns = client.account(accountId);

  try {
    const data = await ns.messaging.getAttachment(messageId, attachmentId);
    await writeBinaryOutput(data, {
      outputPath: flags.output,
      isTTY,
      stdout: process.stdout,
    });
  } catch (err: unknown) {
    if (err instanceof BinaryOutputError) {
      out.stderr.write(`error: ${err.message}\n`);
      process.exit(err.exitCode);
    }
    const outOpts = resolveOutputOpts(flags);
    await handleSdkError(err, outOpts, out);
  }
}

/**
 * Run `message inmail --to <url|slug|provider-id|urn> --subject <s> "<text>"`.
 * Write command — supports --preview.
 *
 * --to resolution:
 *   LinkedIn URL or bare slug → profiles.get(slug) → provider_id used as recipient_urn.
 *   Provider ID (AC/AD/AE prefix) → passed directly as recipient_urn, no profiles.get call.
 *   Member URN (urn:li:member:<N>) → passed directly as recipient_urn, no profiles.get call.
 *   Empty string → exit 2.
 *   profiles.get not-found → exit 4.
 */
export async function runMessageInMail(
  client: MinimalClient,
  flags: MessageFlags,
  out: OutputStreams,
  _readStdin?: () => Promise<string>,
): Promise<void> {
  const accountId = requireAccount(flags.account, out);
  const surface = flags.surface ?? "";
  if (!(INMAIL_SURFACES as readonly string[]).includes(surface)) {
    out.stderr.write(
      `error: --surface is required and must be one of ${INMAIL_SURFACES.join(", ")}.\n`,
    );
    process.exit(2);
  }

  const rawTo = flags.to ?? "";
  if (!rawTo) {
    out.stderr.write(
      "error: --to: not a valid LinkedIn URL, slug, provider-id, or URN.\n",
    );
    process.exit(2);
    return;
  }

  const ns = client.account(accountId);
  const outOpts = resolveOutputOpts(flags);

  // Resolve --to to a recipient URN.
  const resolvedSlugOrId = resolveIdentifier(rawTo);
  let recipientUrn: string | undefined;

  if (MEMBER_URN_RE.test(resolvedSlugOrId)) {
    // Already a member URN — pass through directly.
    recipientUrn = resolvedSlugOrId;
  } else if (MEMBER_PROVIDER_ID_RE.test(resolvedSlugOrId)) {
    // Already a provider ID — pass through directly.
    recipientUrn = resolvedSlugOrId;
  } else {
    // Slug or URL-derived slug — resolve via profiles.get.
    try {
      const profileData = await ns.profiles.get(resolvedSlugOrId, {});
      recipientUrn = profileData["provider_id"] as string;
    } catch (err: unknown) {
      await handleSdkError(err, outOpts, out);
      return; // unreachable: handleSdkError always calls process.exit
    }
  }

  const subject = flags.subject ?? "";
  const rawText = flags.text ?? "";

  // Resolve stdin sentinel: "-" reads all of stdin.
  const text = await resolveTextOrStdin(rawText, out, _readStdin);

  const body: Record<string, unknown> = {
    recipient_urn: recipientUrn!,
    surface,
    subject,
    text,
  };

  if (flags.preview) {
    const preview = buildPreviewOutput({
      method: "messaging.sendInMail",
      args: { recipient_urn: recipientUrn! },
      body,
      account: accountId,
    });
    out.stdout.write(JSON.stringify(preview) + "\n");
    return;
  }

  try {
    const result = await ns.messaging.sendInMail(body);
    renderSuccess(result, outOpts, out);
  } catch (err: unknown) {
    await handleSdkError(err, outOpts, out);
  }
}

/**
 * Run `message inmail-balance`.
 * Read command — rejects --preview and --all.
 */
export async function runMessageInMailBalance(
  client: MinimalClient,
  flags: MessageFlags,
  out: OutputStreams,
): Promise<void> {
  rejectPreviewOnRead(flags.preview, out);
  rejectAllOnNonPaginated(flags.all, out);

  const accountId = requireAccount(flags.account, out);
  const ns = client.account(accountId);
  const outOpts = resolveOutputOpts(flags);

  try {
    const result = await ns.messaging.getInMailBalance();
    renderSuccess(result, outOpts, out);
  } catch (err: unknown) {
    await handleSdkError(err, outOpts, out);
  }
}

// ---------------------------------------------------------------------------
// Citty command definitions
// ---------------------------------------------------------------------------

const messageNewCommand = defineCommand({
  meta: { name: "new", description: "Start a new chat with one or more members." },
  args: {
    // Write command: WRITE_FLAGS omits pagination/projection flags
    ...WRITE_FLAGS,
    to: {
      type: "string",
      description:
        "Recipient: LinkedIn profile URL (e.g. https://www.linkedin.com/in/some-slug), bare slug (e.g. some-slug), or provider ID (e.g. ACoAAA…). URL and slug inputs resolve the provider ID automatically.",
      required: true,
    },
    text: { type: "positional", description: "Opening message text. Pass - to read from stdin (e.g. via heredoc or pipe)." },
    attach: { type: "string", description: "File to attach (repeatable)." },
  },
  async run({ args }) {
    const flags = args as MessageFlags;
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
    await runMessageNew(client as unknown as MinimalClient, { ...flags, account: flags.account ?? cfg.account }, out);
  },
});

const messageGetCommand = defineCommand({
  meta: { name: "get", description: "Get a message by ID." },
  args: {
    // Single-object read: READ_SINGLE_FLAGS omits pagination flags, keeps --fields
    ...READ_SINGLE_FLAGS,
    messageId: { type: "positional", description: "Message ID." },
  },
  async run({ args }) {
    const flags = args as MessageFlags;
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
    await runMessageGet(client as unknown as MinimalClient, { ...flags, account: flags.account ?? cfg.account }, out);
  },
});

const messageEditCommand = defineCommand({
  meta: { name: "edit", description: "Edit a message (within the allowed window)." },
  args: {
    // Write command: WRITE_FLAGS omits pagination/projection flags
    ...WRITE_FLAGS,
    messageId: { type: "positional", description: "Message ID." },
    text: { type: "positional", description: "Replacement text. Pass - to read from stdin." },
  },
  async run({ args }) {
    const flags = args as MessageFlags;
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
    await runMessageEdit(client as unknown as MinimalClient, { ...flags, account: flags.account ?? cfg.account }, out);
  },
});

const messageDeleteCommand = defineCommand({
  meta: { name: "delete", description: "Delete a message." },
  args: {
    // Write command: WRITE_FLAGS omits pagination/projection flags
    ...WRITE_FLAGS,
    messageId: { type: "positional", description: "Message ID." },
  },
  async run({ args }) {
    const flags = args as MessageFlags;
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
    await runMessageDelete(client as unknown as MinimalClient, { ...flags, account: flags.account ?? cfg.account }, out);
  },
});

const messageReactCommand = defineCommand({
  meta: { name: "react", description: "Add an emoji reaction to a message." },
  args: {
    // Write command: WRITE_FLAGS omits pagination/projection flags
    ...WRITE_FLAGS,
    messageId: { type: "positional", description: "Message ID." },
    emoji: { type: "string", description: "Native emoji reaction value (e.g. 👍).", required: true },
  },
  async run({ args }) {
    const flags = args as MessageFlags;
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
    await runMessageReact(client as unknown as MinimalClient, { ...flags, account: flags.account ?? cfg.account }, out);
  },
});

const messageAttachmentCommand = defineCommand({
  meta: { name: "attachment", description: "Download a message attachment." },
  args: {
    // Single-object read: READ_SINGLE_FLAGS omits pagination flags, keeps --fields
    ...READ_SINGLE_FLAGS,
    messageId: { type: "positional", description: "Message ID." },
    attachmentId: { type: "positional", description: "Attachment ID." },
    output: { type: "string", alias: "o", description: "Path to write the file to." },
  },
  async run({ args }) {
    const flags = args as MessageFlags;
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
    await runMessageAttachment(
      client as unknown as MinimalClient,
      { ...flags, account: flags.account ?? cfg.account },
      out,
      process.stdout.isTTY ?? false,
    );
  },
});

const messageInMailCommand = defineCommand({
  meta: { name: "inmail", description: "Send an InMail to a member." },
  args: {
    // Write command: WRITE_FLAGS omits pagination/projection flags
    ...WRITE_FLAGS,
    to: {
      type: "string",
      description:
        "Recipient: LinkedIn profile URL, bare slug, provider-id (ACoAAA…), or member URN (urn:li:member:<id>). URL and slug inputs resolve the provider ID automatically.",
      required: true,
    },
    surface: { type: "string", description: "InMail surface: sales_nav, recruiter, or classic (classic uses the account's own premium InMail credits).", required: true },
    subject: { type: "string", description: "InMail subject line.", required: true },
    text: { type: "positional", description: "InMail body text. Pass - to read from stdin." },
  },
  async run({ args }) {
    const flags = args as MessageFlags;
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
    await runMessageInMail(client as unknown as MinimalClient, { ...flags, account: flags.account ?? cfg.account }, out);
  },
});

const messageInMailBalanceCommand = defineCommand({
  meta: { name: "inmail-balance", description: "Get InMail credit balance." },
  args: {
    // Single-object read: READ_SINGLE_FLAGS omits pagination flags, keeps --fields
    ...READ_SINGLE_FLAGS,
  },
  async run({ args }) {
    const flags = args as MessageFlags;
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
    await runMessageInMailBalance(client as unknown as MinimalClient, { ...flags, account: flags.account ?? cfg.account }, out);
  },
});

export const messageCommand = defineCommand({
  meta: { name: "message", description: "Send and manage LinkedIn messages." },
  args: {
    // Write command (message send): WRITE_FLAGS omits pagination/projection flags
    ...WRITE_FLAGS,
    chatId: { type: "positional", description: "Chat ID to send a message to.", required: false },
    text: { type: "positional", description: "Message text. Pass - to read from stdin.", required: false },
    attach: { type: "string", description: "File to attach (repeatable)." },
  },
  subCommands: {
    new: messageNewCommand,
    get: messageGetCommand,
    edit: messageEditCommand,
    delete: messageDeleteCommand,
    react: messageReactCommand,
    attachment: messageAttachmentCommand,
    inmail: messageInMailCommand,
    "inmail-balance": messageInMailBalanceCommand,
  },
  async run({ args }) {
    const flags = args as MessageFlags;

    if (!flags.chatId) {
      process.stderr.write(
        "Usage: curviate message new --to <attendee> \"<text>\" [--attach <file>…]\n" +
        "       curviate message <chat_id> \"<text>\" [--attach <file>…]\n" +
        "       curviate message get <message_id>\n" +
        "       curviate message edit <message_id> \"<text>\"\n" +
        "       curviate message delete <message_id>\n" +
        "       curviate message react <message_id> --emoji <e>\n" +
        "       curviate message attachment <message_id> <attachment_id> [-o <file>]\n" +
        "       curviate message inmail --to <id> --subject <s> \"<text>\"\n" +
        "       curviate message inmail-balance\n",
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
    await runMessageSend(client as unknown as MinimalClient, { ...flags, account: flags.account ?? cfg.account }, out);
  },
});
