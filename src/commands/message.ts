/**
 * `curviate message` — LinkedIn message operations.
 *
 * Subcommands:
 *   message new --to <attendee> "<text>" [--attach <file>…]    — start new chat (write)
 *   message <chat_id> "<text>" [--attach <file>…]              — send message to chat (write)
 *   message get <message_id>                                    — get a message (read)
 *   message edit <message_id> "<text>"                         — edit a message (write)
 *   message delete <message_id>                                 — delete a message (write)
 *   message react <message_id> --emoji <e>                     — react to message (write, body field: reaction)
 *   message attachment <message_id> <attachment_id> [-o <file>] — download attachment (binary)
 *   message inmail --to <urn> --surface <s> --subject <s> "<text>" — send InMail (write; --to must be a member URN, --surface required)
 *   message inmail-balance                                      — get InMail credit balance (read)
 *
 * chat_id / message_id / attachment_id pass through verbatim.
 * --to for `message new` is an attendee provider ID, passed verbatim (NOT URL-resolved).
 * --to for `message inmail` passes through resolveIdentifier, then is validated as a
 *   member URN (urn:li:member:<id>); a URL or slug is rejected client-side (exit 2).
 * --surface for `message inmail` is required (sales_nav | recruiter).
 */

import { defineCommand } from "citty";
import { GLOBAL_FLAGS } from "../lib/global-flags.js";
import { resolveIdentifier } from "../lib/identifier.js";
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
const INMAIL_SURFACES = ["sales_nav", "recruiter"] as const;

/** A LinkedIn member URN: urn:li:member:<digits>. The InMail recipient must be a URN. */
const MEMBER_URN_RE = /^urn:li:member:\d+$/;

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
 * Run `message new --to <attendee_provider_id> "<text>" [--attach <file>…]`.
 * Write command — supports --preview.
 * --to is an attendee provider ID (e.g. ACo…); passed verbatim (NOT URL-resolved).
 */
export async function runMessageNew(
  client: MinimalClient,
  flags: MessageFlags,
  out: OutputStreams,
): Promise<void> {
  const accountId = requireAccount(flags.account, out);
  const attendeeId = flags.to ?? "";
  const text = flags.text ?? "";
  const attachPaths = normalizeAttachPaths(flags.attach);

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

  const body: Record<string, unknown> = {
    attendees_ids: [attendeeId],
    text,
  };

  if (flags.preview) {
    const preview = buildPreviewOutput({
      method: "messaging.startChat",
      args: { attendees_ids: [attendeeId] },
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
    const result = await ns.messaging.startChat(body);
    renderSuccess(result, outOpts, out);
  } catch (err: unknown) {
    await handleSdkError(err, outOpts, out);
  }
}

/**
 * Run `message <chat_id> "<text>" [--attach <file>…]`.
 * Write command — supports --preview.
 */
export async function runMessageSend(
  client: MinimalClient,
  flags: MessageFlags,
  out: OutputStreams,
): Promise<void> {
  const accountId = requireAccount(flags.account, out);
  const chatId = flags.chatId ?? "";
  const text = flags.text ?? "";
  const attachPaths = normalizeAttachPaths(flags.attach);

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
): Promise<void> {
  const accountId = requireAccount(flags.account, out);
  const messageId = flags.messageId ?? "";
  const text = flags.text ?? "";

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
 * Run `message inmail --to <id> --subject <s> "<text>"`.
 * Write command — supports --preview.
 * --to passes through resolveIdentifier (accepts LinkedIn URN / URL / slug).
 */
export async function runMessageInMail(
  client: MinimalClient,
  flags: MessageFlags,
  out: OutputStreams,
): Promise<void> {
  const accountId = requireAccount(flags.account, out);
  const surface = flags.surface ?? "";
  if (!(INMAIL_SURFACES as readonly string[]).includes(surface)) {
    out.stderr.write(
      `error: --surface is required and must be one of ${INMAIL_SURFACES.join(", ")}.\n`,
    );
    process.exit(2);
  }

  const recipientUrn = resolveIdentifier(flags.to ?? "");
  if (!MEMBER_URN_RE.test(recipientUrn)) {
    out.stderr.write(
      "error: --to must be a LinkedIn member URN (e.g. urn:li:member:99999), not a URL or slug.\n",
    );
    process.exit(2);
  }

  const subject = flags.subject ?? "";
  const text = flags.text ?? "";

  const body: Record<string, unknown> = {
    recipient_urn: recipientUrn,
    surface,
    subject,
    text,
  };

  if (flags.preview) {
    const preview = buildPreviewOutput({
      method: "messaging.sendInMail",
      args: { recipient_urn: recipientUrn },
      body,
      account: accountId,
    });
    out.stdout.write(JSON.stringify(preview) + "\n");
    return;
  }

  const ns = client.account(accountId);
  const outOpts = resolveOutputOpts(flags);

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
    ...GLOBAL_FLAGS,
    to: { type: "string", description: "Attendee provider ID (e.g. ACo…).", required: true },
    text: { type: "positional", description: "Opening message text." },
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
    ...GLOBAL_FLAGS,
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
    ...GLOBAL_FLAGS,
    messageId: { type: "positional", description: "Message ID." },
    text: { type: "positional", description: "Replacement text." },
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
    ...GLOBAL_FLAGS,
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
    ...GLOBAL_FLAGS,
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
    ...GLOBAL_FLAGS,
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
    ...GLOBAL_FLAGS,
    to: { type: "string", description: "Recipient member URN (urn:li:member:<id>). Must be a URN, not a URL or slug.", required: true },
    surface: { type: "string", description: "InMail surface: sales_nav or recruiter.", required: true },
    subject: { type: "string", description: "InMail subject line.", required: true },
    text: { type: "positional", description: "InMail body text." },
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
  args: { ...GLOBAL_FLAGS },
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
    ...GLOBAL_FLAGS,
    chatId: { type: "positional", description: "Chat ID to send a message to.", required: false },
    text: { type: "positional", description: "Message text.", required: false },
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
