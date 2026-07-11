/**
 * `curviate connect` — connection invitation operations.
 *
 * Subcommands:
 *   connect <id> [--note <text>]            — send invitation (write, --preview OK)
 *   connect sent                            — list sent invitations (read)
 *   connect received                        — list received invitations (read)
 *   connect respond <id> --action <a>       — accept/decline (write, --preview OK)
 *   connect cancel <id>                     — cancel sent invitation (write, --preview OK)
 *
 * <id> for `connect <id>` passes through resolveIdentifier (member URL/slug/URN).
 * <id> for `respond` and `cancel` is an invitation_id — passed verbatim, NOT resolved.
 * All subcommands are account-scoped.
 *
 * v2: the old combined `invites.respond(id, {action, shared_secret})`
 * split into two dedicated, BODYLESS ops — `invites.accept` / `invites.decline`.
 * `respond` keeps its noun (the command surface stays stable) but now
 * branches on --action to call the right one; --shared-secret has no v2 home
 * (the accept/decline ops take no body at all) and is no longer accepted.
 */

import { defineCommand } from "citty";
import { GLOBAL_FLAGS, WRITE_FLAGS } from "../lib/global-flags.js";
import { slimInviteSent, slimInviteReceived, slimInviteSentItem, slimInviteReceivedItem } from "../lib/slim.js";
import { resolveIdentifier } from "../lib/identifier.js";
import { resolveEffectiveConfig } from "../lib/resolve.js";
import { createClient } from "../lib/client.js";
import { renderSuccess, renderError, renderUnexpectedError } from "../lib/output.js";
import { buildPreviewOutput } from "../lib/preview.js";
import { streamAll } from "../lib/paginate.js";
import type { Curviate, CurviateError } from "@curviate/sdk";

type ConnectFlags = {
  id?: string;
  note?: string;
  action?: string;
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
  verbose?: boolean;
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

function resolveOutputOpts(flags: ConnectFlags) {
  return {
    json: (flags.json ?? false) || !process.stdout.isTTY,
    isTTY: process.stdout.isTTY ?? false,
    fields: flags.fields,
    verbose: flags.verbose ?? false,
  };
}

// ---------------------------------------------------------------------------
// Exported run functions (testable without citty)
// ---------------------------------------------------------------------------

/**
 * Run `connect <id> [--note <text>]`.
 * Write command — supports --preview.
 */
export async function runConnectSend(
  client: Curviate,
  flags: ConnectFlags,
  out: OutputStreams,
): Promise<void> {
  const accountId = requireAccount(flags.account, out);
  const rawId = flags.id ?? "";
  const resolvedId = resolveIdentifier(rawId);

  const body = {
    recipient_identifier: resolvedId,
    ...(flags.note ? { message: flags.note } : {}),
  };

  if (flags.preview) {
    const preview = buildPreviewOutput({
      method: "invites.send",
      args: { id: resolvedId },
      body,
      account: accountId,
    });
    out.stdout.write(JSON.stringify(preview) + "\n");
    return;
  }

  const ns = client.account(accountId);
  const outOpts = resolveOutputOpts(flags);

  try {
    const result = await ns.invites.send(body);
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

/**
 * Run `connect sent [--all] [--limit] [--cursor]`.
 * Read command — rejects --preview.
 */
export async function runConnectSent(
  client: Curviate,
  flags: ConnectFlags,
  out: OutputStreams,
): Promise<void> {
  rejectPreviewOnRead(flags.preview, out);

  const accountId = requireAccount(flags.account, out);
  const ns = client.account(accountId);
  const outOpts = resolveOutputOpts(flags);
  const all = flags.all ?? false;
  const maxPages = flags["max-pages"] ? parseInt(flags["max-pages"], 10) : 100;
  const limit = flags.limit ? parseInt(flags.limit, 10) : undefined;
  const cursor = flags.cursor;
  const params: Record<string, unknown> = {};
  if (limit !== undefined) params["limit"] = limit;
  if (cursor) params["cursor"] = cursor;

  try {
    if (all) {
      const fn = (p: Record<string, unknown>) => ns.invites.listSent(p) as Promise<{ items?: unknown[]; cursor?: string | null }>;
      for await (const item of streamAll(fn, params, {
        maxPages,
        onTruncated: (n) => out.stderr.write(`Streaming truncated at ${n} page(s). Use --all --max-pages or --cursor for manual paging.\n`),
      })) {
        // streamAll yields individual items; project per-item (the envelope
        // projector slimInviteSent expects a { items } wrapper and would erase
        // a bare item to an empty envelope).
        const projected = !flags.verbose ? slimInviteSentItem(item as Record<string, unknown>) : item;
        out.stdout.write(JSON.stringify(projected) + "\n");
      }
    } else {
      const result = await ns.invites.listSent(params);
      renderSuccess(result, { ...outOpts, slim: slimInviteSent }, out);
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
 * Run `connect received [--all] [--limit] [--cursor]`.
 * Read command — rejects --preview.
 */
export async function runConnectReceived(
  client: Curviate,
  flags: ConnectFlags,
  out: OutputStreams,
): Promise<void> {
  rejectPreviewOnRead(flags.preview, out);

  const accountId = requireAccount(flags.account, out);
  const ns = client.account(accountId);
  const outOpts = resolveOutputOpts(flags);
  const all = flags.all ?? false;
  const maxPages = flags["max-pages"] ? parseInt(flags["max-pages"], 10) : 100;
  const limit = flags.limit ? parseInt(flags.limit, 10) : undefined;
  const cursor = flags.cursor;
  const params: Record<string, unknown> = {};
  if (limit !== undefined) params["limit"] = limit;
  if (cursor) params["cursor"] = cursor;

  try {
    if (all) {
      const fn = (p: Record<string, unknown>) => ns.invites.listReceived(p) as Promise<{ items?: unknown[]; cursor?: string | null }>;
      for await (const item of streamAll(fn, params, {
        maxPages,
        onTruncated: (n) => out.stderr.write(`Streaming truncated at ${n} page(s). Use --all --max-pages or --cursor for manual paging.\n`),
      })) {
        // streamAll yields individual items; project per-item (the envelope
        // projector slimInviteReceived expects a { items } wrapper and would
        // erase a bare item to an empty envelope).
        const projected = !flags.verbose ? slimInviteReceivedItem(item as Record<string, unknown>) : item;
        out.stdout.write(JSON.stringify(projected) + "\n");
      }
    } else {
      const result = await ns.invites.listReceived(params);
      renderSuccess(result, { ...outOpts, slim: slimInviteReceived }, out);
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
 * Run `connect respond <invitation_id> --action accept|decline`.
 * Write command — supports --preview.
 * invitation_id is NOT passed through resolveIdentifier.
 *
 * v2: dispatches to the bodyless `invites.accept`/`invites.decline` op that
 * matches --action. --shared-secret is gone (no v2 home — accept/decline
 * take no body).
 */
export async function runConnectRespond(
  client: Curviate,
  flags: ConnectFlags,
  out: OutputStreams,
): Promise<void> {
  const accountId = requireAccount(flags.account, out);
  // invitation_id passes verbatim — NOT URL-normalized
  const invitationId = flags.id ?? "";
  const action = flags.action ?? "";

  if (action !== "accept" && action !== "decline") {
    out.stderr.write("error: --action must be 'accept' or 'decline'.\n");
    process.exit(2);
  }

  const method = action === "accept" ? "invites.accept" : "invites.decline";

  if (flags.preview) {
    const preview = buildPreviewOutput({
      method,
      args: { invitation_id: invitationId },
      body: {},
      account: accountId,
    });
    out.stdout.write(JSON.stringify(preview) + "\n");
    return;
  }

  const ns = client.account(accountId);
  const outOpts = resolveOutputOpts(flags);

  try {
    const result = action === "accept"
      ? await ns.invites.accept(invitationId)
      : await ns.invites.decline(invitationId);
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

/**
 * Run `connect cancel <invitation_id>`.
 * Write command — supports --preview.
 * invitation_id is NOT passed through resolveIdentifier.
 */
export async function runConnectCancel(
  client: Curviate,
  flags: ConnectFlags,
  out: OutputStreams,
): Promise<void> {
  const accountId = requireAccount(flags.account, out);
  // invitation_id passes verbatim — NOT URL-normalized
  const invitationId = flags.id ?? "";

  if (flags.preview) {
    const preview = buildPreviewOutput({
      method: "invites.cancel",
      args: { invitation_id: invitationId },
      body: {},
      account: accountId,
    });
    out.stdout.write(JSON.stringify(preview) + "\n");
    return;
  }

  const ns = client.account(accountId);
  const outOpts = resolveOutputOpts(flags);

  try {
    const result = await ns.invites.cancel(invitationId);
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

const connectSentCommand = defineCommand({
  meta: {
    name: "sent",
    description:
      "Returns pending sent invitations only — accepted and declined invitations are not returned (LinkedIn API limitation). " +
      "Use `id` with `connect cancel`; use `invited_user_public_id` or `invited_user_id` with `curviate profile`. " +
      "`parsed_datetime` is approximate — derived from LinkedIn's relative date label; invitations sharing a label get the same computed time. " +
      "No total count is available; use `connect sent --all` and count client-side.",
  },
  args: { ...GLOBAL_FLAGS },
  async run({ args }) {
    const flags = args as ConnectFlags;
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
    await runConnectSent(client, { ...flags, account: flags.account ?? cfg.account }, out);
  },
});

const connectReceivedCommand = defineCommand({
  meta: {
    name: "received",
    description:
      "Returns pending received invitations only — already-handled invitations are not returned. " +
      "The `inviter.*` fields identify who sent the request. Use the `id` field with `connect respond`.",
  },
  args: { ...GLOBAL_FLAGS },
  async run({ args }) {
    const flags = args as ConnectFlags;
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
    await runConnectReceived(client, { ...flags, account: flags.account ?? cfg.account }, out);
  },
});

const connectRespondCommand = defineCommand({
  meta: { name: "respond", description: "Accept or decline a received invitation." },
  args: {
    ...WRITE_FLAGS,
    id: {
      type: "positional",
      description: "Invitation id to respond to — use the `id` field from `connect received`.",
    },
    action: { type: "string", description: "Response action: accept or decline.", required: true },
  },
  async run({ args }) {
    const flags = args as ConnectFlags;
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
    await runConnectRespond(client, { ...flags, account: flags.account ?? cfg.account }, out);
  },
});

const connectCancelCommand = defineCommand({
  meta: { name: "cancel", description: "Cancel a sent invitation." },
  args: {
    ...WRITE_FLAGS,
    id: { type: "positional", description: "Invitation id to cancel." },
  },
  async run({ args }) {
    const flags = args as ConnectFlags;
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
    await runConnectCancel(client, { ...flags, account: flags.account ?? cfg.account }, out);
  },
});

export const connectCommand = defineCommand({
  meta: {
    name: "connect",
    description:
      "Send or manage connection invitations. " +
      "Connection requests may take 10–30 seconds to appear in the recipient's received list (LinkedIn propagation delay).",
  },
  args: {
    ...WRITE_FLAGS,
    id: {
      type: "positional",
      description:
        "Recipient's LinkedIn URL, public slug, or provider_id (ACoAAA… from `curviate profile`). " +
        "LinkedIn URN (`urn:li:member:N`) also accepted but the numeric member ID is not exposed by this API.",
      required: false,
    },
    note: {
      type: "string",
      description:
        "Personalized message shown to the recipient alongside the connection request (≤300 chars; LinkedIn cap). " +
        "Omit to send a generic note. Personalized messages increase acceptance rates.",
    },
  },
  subCommands: {
    sent: connectSentCommand,
    received: connectReceivedCommand,
    respond: connectRespondCommand,
    cancel: connectCancelCommand,
  },
  async run({ args }) {
    const flags = args as ConnectFlags;

    if (!flags.id) {
      process.stderr.write(
        "Usage: curviate connect <id> [--note <text>]\n" +
        "       curviate connect sent\n" +
        "       curviate connect received\n" +
        "       curviate connect respond <invitation_id> --action accept|decline\n" +
        "       curviate connect cancel <invitation_id>\n",
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
    await runConnectSend(client, { ...flags, account: flags.account ?? cfg.account }, out);
  },
});
