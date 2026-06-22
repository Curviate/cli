/**
 * `curviate webhook` — webhook registration and event verification (root-scoped).
 *
 * Subcommands:
 *   webhook create <body…>             — register a webhook (write)
 *   webhook list                       — list webhooks
 *   webhook events                     — list the canonical event catalogue
 *   webhook update <id> <body…>        — update a webhook (write; --source is usage error)
 *   webhook delete <id>                — delete a webhook (write)
 *   webhook state-diff <account_id>    — get changes since last state (read)
 *   webhook verify                     — offline HMAC verification (no network)
 *
 * Root-scoped: methods live on `curviate.webhooks.*`.
 * `webhook verify` is NOT an SDK API method — it calls the SDK's `constructEvent`
 * offline; no Curviate client is constructed.
 */

import { defineCommand } from "citty";
import { GLOBAL_FLAGS } from "../lib/global-flags.js";
import { resolveEffectiveConfig } from "../lib/resolve.js";
import { createClient } from "../lib/client.js";
import { renderSuccess, renderError, renderUnexpectedError } from "../lib/output.js";
import { buildPreviewOutput } from "../lib/preview.js";
import { streamAll } from "../lib/paginate.js";
import { readFileSync } from "node:fs";
import type { CurviateError } from "@curviate/sdk";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type WebhookFlags = {
  id?: string;
  "account-id"?: string;
  "account-ids"?: string;
  "request-url"?: string;
  source?: string;
  name?: string;
  format?: string;
  enabled?: boolean;
  events?: string;
  data?: string;
  cursor?: string;
  limit?: string;
  all?: boolean;
  "max-pages"?: string;
  json?: boolean;
  fields?: string;
  preview?: boolean;
  // webhook verify flags
  secret?: string;
  header?: string;
  body?: string;
  "max-age-secs"?: string;
  "api-key"?: string;
  "base-url"?: string;
  timeout?: string;
  profile?: string;
};

type OutputStreams = {
  stdout: { write: (s: string) => void };
  stderr: { write: (s: string) => void };
};

// Minimal root-level client shape.
type MinimalClient = {
  webhooks: {
    create: (body: Record<string, unknown>) => Promise<unknown>;
    list: (params?: Record<string, unknown>) => Promise<unknown>;
    listEvents: () => Promise<unknown>;
    update: (id: string, body: Record<string, unknown>) => Promise<unknown>;
    delete: (id: string) => Promise<unknown>;
    getStateDiff: (accountId: string, params?: Record<string, unknown>) => Promise<unknown>;
  };
};

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

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

function resolveOutputOpts(flags: WebhookFlags) {
  return {
    json: (flags.json ?? false) || !process.stdout.isTTY,
    isTTY: process.stdout.isTTY ?? false,
    fields: flags.fields,
  };
}

async function handleError(err: unknown, outOpts: ReturnType<typeof resolveOutputOpts>, out: OutputStreams): Promise<never> {
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
// Exported run functions
// ---------------------------------------------------------------------------

/**
 * Run `webhook create <body…>`.
 * Required: --source, --request-url, --account-ids.
 * --account-ids is comma-separated and maps to account_ids[].
 */
export async function runWebhookCreate(
  client: MinimalClient,
  flags: WebhookFlags,
  out: OutputStreams,
): Promise<void> {
  if (!flags.source) {
    out.stderr.write("error: --source is required (messaging | user | account_status).\n");
    process.exit(2);
  }
  if (!flags["request-url"]) {
    out.stderr.write("error: --request-url is required (HTTPS URL for webhook deliveries).\n");
    process.exit(2);
  }
  if (!flags["account-ids"]) {
    out.stderr.write("error: --account-ids is required (comma-separated list of acc_… ids).\n");
    process.exit(2);
  }

  const accountIds = flags["account-ids"].split(",").map((s) => s.trim()).filter(Boolean);
  const body: Record<string, unknown> = {
    source: flags.source,
    request_url: flags["request-url"],
    account_ids: accountIds,
  };

  if (flags.name) body["name"] = flags.name;
  if (flags.format) body["format"] = flags.format;
  if (flags.enabled !== undefined) body["enabled"] = flags.enabled;
  if (flags.events) {
    body["events"] = flags.events.split(",").map((s) => s.trim()).filter(Boolean);
  }
  if (flags.data) {
    body["data"] = flags.data.split(",").map((s) => s.trim()).filter(Boolean);
  }

  const outOpts = resolveOutputOpts(flags);

  if (flags.preview) {
    const preview = buildPreviewOutput({ method: "webhooks.create", args: {}, body });
    out.stdout.write(JSON.stringify(preview) + "\n");
    return;
  }

  try {
    const result = await client.webhooks.create(body);
    renderSuccess(result, outOpts, out);
  } catch (err) {
    await handleError(err, outOpts, out);
  }
}

/**
 * Run `webhook list [--all] [--limit] [--cursor]`.
 */
export async function runWebhookList(
  client: MinimalClient,
  flags: WebhookFlags,
  out: OutputStreams,
): Promise<void> {
  rejectPreviewOnRead(flags.preview, out);

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
      const fn = (p: Record<string, unknown>) =>
        client.webhooks.list(p) as Promise<{ items?: unknown[]; cursor?: string | null }>;
      for await (const item of streamAll(fn, params, {
        maxPages,
        onTruncated: (msg) => out.stderr.write(msg + "\n"),
      })) {
        out.stdout.write(JSON.stringify(item) + "\n");
      }
    } else {
      const result = await client.webhooks.list(params);
      renderSuccess(result, outOpts, out);
    }
  } catch (err) {
    await handleError(err, outOpts, out);
  }
}

/**
 * Run `webhook events`. Non-paginated read.
 */
export async function runWebhookEvents(
  client: MinimalClient,
  flags: WebhookFlags,
  out: OutputStreams,
): Promise<void> {
  rejectPreviewOnRead(flags.preview, out);
  rejectAllOnNonPaginated(flags.all, out);

  const outOpts = resolveOutputOpts(flags);

  try {
    const result = await client.webhooks.listEvents();
    renderSuccess(result, outOpts, out);
  } catch (err) {
    await handleError(err, outOpts, out);
  }
}

/**
 * Run `webhook update <id> <body…>`.
 * --source is immutable — reject with exit 2 if provided.
 */
export async function runWebhookUpdate(
  client: MinimalClient,
  flags: WebhookFlags,
  out: OutputStreams,
): Promise<void> {
  if (flags.source !== undefined) {
    out.stderr.write("error: --source cannot be changed after creation (source is immutable).\n");
    process.exit(2);
  }

  const id = flags.id ?? "";
  const body: Record<string, unknown> = {};

  if (flags.name !== undefined) body["name"] = flags.name;
  if (flags["request-url"]) body["request_url"] = flags["request-url"];
  if (flags.enabled !== undefined) body["enabled"] = flags.enabled;
  if (flags.format) body["format"] = flags.format;
  if (flags.events) {
    body["events"] = flags.events.split(",").map((s) => s.trim()).filter(Boolean);
  }
  if (flags.data) {
    body["data"] = flags.data.split(",").map((s) => s.trim()).filter(Boolean);
  }
  if (flags["account-ids"]) {
    body["account_ids"] = flags["account-ids"].split(",").map((s) => s.trim()).filter(Boolean);
  }

  const outOpts = resolveOutputOpts(flags);

  if (flags.preview) {
    const preview = buildPreviewOutput({
      method: "webhooks.update",
      args: { id },
      body,
    });
    out.stdout.write(JSON.stringify(preview) + "\n");
    return;
  }

  try {
    const result = await client.webhooks.update(id, body);
    renderSuccess(result, outOpts, out);
  } catch (err) {
    await handleError(err, outOpts, out);
  }
}

/**
 * Run `webhook delete <id>`.
 */
export async function runWebhookDelete(
  client: MinimalClient,
  flags: WebhookFlags,
  out: OutputStreams,
): Promise<void> {
  const id = flags.id ?? "";
  const outOpts = resolveOutputOpts(flags);

  if (flags.preview) {
    const preview = buildPreviewOutput({
      method: "webhooks.delete",
      args: { id },
      body: {},
    });
    out.stdout.write(JSON.stringify(preview) + "\n");
    return;
  }

  try {
    const result = await client.webhooks.delete(id);
    renderSuccess(result, outOpts, out);
  } catch (err) {
    await handleError(err, outOpts, out);
  }
}

/**
 * Run `webhook state-diff <account_id> [--cursor <c>]`.
 * Read command; account_id is verbatim (not URL-resolved).
 */
export async function runWebhookStateDiff(
  client: MinimalClient,
  flags: WebhookFlags,
  out: OutputStreams,
): Promise<void> {
  rejectPreviewOnRead(flags.preview, out);

  const accountId = flags["account-id"] ?? "";
  const outOpts = resolveOutputOpts(flags);

  const query: Record<string, unknown> = {};
  if (flags.cursor) query["cursor"] = flags.cursor;

  try {
    const result = await client.webhooks.getStateDiff(accountId, query);
    renderSuccess(result, outOpts, out);
  } catch (err) {
    await handleError(err, outOpts, out);
  }
}

// ---------------------------------------------------------------------------
// Exported pure function for webhook verify (offline, no client)
// ---------------------------------------------------------------------------

export interface WebhookVerifyInput {
  secret: string;
  signatureHeader: string;
  rawBody: string;
  replayWindowSecs?: number;
}

/**
 * Run `webhook verify` — offline HMAC verification.
 *
 * Calls the SDK's `constructEvent` directly (no Curviate client constructed).
 * On success: prints parsed event JSON to stdout, returns (exit 0 semantics).
 * On WebhookSignatureError: prints structured error envelope to stdout, writes
 * summary to stderr, and calls process.exit(2).
 *
 * The secret is NEVER echoed or logged.
 */
export async function runWebhookVerify(
  input: WebhookVerifyInput,
  out: OutputStreams,
): Promise<void> {
  const { constructEvent, WebhookSignatureError } = await import("@curviate/sdk");

  try {
    const event = await constructEvent(
      input.rawBody,
      input.signatureHeader,
      input.secret,
      ...(input.replayWindowSecs !== undefined ? [{ replayWindowSecs: input.replayWindowSecs }] : []),
    );
    out.stdout.write(JSON.stringify(event) + "\n");
    // exit 0 — just return
  } catch (err) {
    if (err instanceof WebhookSignatureError) {
      const envelope = {
        error: {
          name: "WebhookSignatureError",
          reason: err.reason,
          message: err.message,
        },
      };
      out.stdout.write(JSON.stringify(envelope) + "\n");
      out.stderr.write(`error: webhook verification failed — ${err.reason}: ${err.message}\n`);
      process.exit(2);
    }
    // Unexpected error
    out.stderr.write(`error: unexpected error during webhook verification: ${String(err)}\n`);
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Citty command definitions
// ---------------------------------------------------------------------------

const webhookCreateCommand = defineCommand({
  meta: { name: "create", description: "Register a new webhook endpoint." },
  args: {
    ...GLOBAL_FLAGS,
    source: { type: "string", description: "Event source: messaging | user | account_status.", required: true },
    "request-url": { type: "string", description: "HTTPS URL to receive webhook deliveries.", required: true },
    "account-ids": { type: "string", description: "Comma-separated account ids to target (required).", required: true },
    name: { type: "string", description: "Human-readable name (1–100 chars)." },
    format: { type: "string", description: "Delivery encoding: json | form (default: json)." },
    enabled: { type: "boolean", description: "Create as enabled (default: true).", default: true },
    events: { type: "string", description: "Comma-separated event names to subscribe to." },
    data: { type: "string", description: "Comma-separated field-remapping keys." },
  },
  async run({ args }) {
    const flags = args as WebhookFlags;
    const cfg = await resolveEffectiveConfig({
      apiKey: flags["api-key"],
      baseUrl: flags["base-url"],
      timeout: flags.timeout,
      profile: flags.profile,
    });
    if (!cfg.apiKey) {
      process.stderr.write("error: no API key — run `curviate login` or pass --api-key.\n");
      process.exit(3);
    }
    const client = createClient({ apiKey: cfg.apiKey, baseUrl: cfg.baseUrl, timeout: cfg.timeout });
    const out = buildOutputStreams();
    await runWebhookCreate(client as unknown as MinimalClient, flags, out);
  },
});

const webhookListCommand = defineCommand({
  meta: { name: "list", description: "List registered webhooks." },
  args: { ...GLOBAL_FLAGS },
  async run({ args }) {
    const flags = args as WebhookFlags;
    const cfg = await resolveEffectiveConfig({
      apiKey: flags["api-key"],
      baseUrl: flags["base-url"],
      timeout: flags.timeout,
      profile: flags.profile,
    });
    if (!cfg.apiKey) {
      process.stderr.write("error: no API key — run `curviate login` or pass --api-key.\n");
      process.exit(3);
    }
    const client = createClient({ apiKey: cfg.apiKey, baseUrl: cfg.baseUrl, timeout: cfg.timeout });
    const out = buildOutputStreams();
    await runWebhookList(client as unknown as MinimalClient, flags, out);
  },
});

const webhookEventsCommand = defineCommand({
  meta: { name: "events", description: "List the canonical webhook event catalogue." },
  args: { ...GLOBAL_FLAGS },
  async run({ args }) {
    const flags = args as WebhookFlags;
    const cfg = await resolveEffectiveConfig({
      apiKey: flags["api-key"],
      baseUrl: flags["base-url"],
      timeout: flags.timeout,
      profile: flags.profile,
    });
    if (!cfg.apiKey) {
      process.stderr.write("error: no API key — run `curviate login` or pass --api-key.\n");
      process.exit(3);
    }
    const client = createClient({ apiKey: cfg.apiKey, baseUrl: cfg.baseUrl, timeout: cfg.timeout });
    const out = buildOutputStreams();
    await runWebhookEvents(client as unknown as MinimalClient, flags, out);
  },
});

const webhookUpdateCommand = defineCommand({
  meta: { name: "update", description: "Update a webhook in place (source is immutable)." },
  args: {
    ...GLOBAL_FLAGS,
    id: { type: "positional", description: "Webhook id (wh_…)." },
    "request-url": { type: "string", description: "Replace the delivery URL." },
    name: { type: "string", description: "Replace the name (or clear with empty string)." },
    enabled: { type: "boolean", description: "Enable or disable the webhook." },
    format: { type: "string", description: "Replace the delivery encoding: json | form." },
    events: { type: "string", description: "Replace subscribed events (comma-separated)." },
    data: { type: "string", description: "Replace field-remapping keys (comma-separated)." },
    "account-ids": { type: "string", description: "Replace targeted accounts (comma-separated)." },
  },
  async run({ args }) {
    const flags = args as WebhookFlags;
    const cfg = await resolveEffectiveConfig({
      apiKey: flags["api-key"],
      baseUrl: flags["base-url"],
      timeout: flags.timeout,
      profile: flags.profile,
    });
    if (!cfg.apiKey) {
      process.stderr.write("error: no API key — run `curviate login` or pass --api-key.\n");
      process.exit(3);
    }
    const client = createClient({ apiKey: cfg.apiKey, baseUrl: cfg.baseUrl, timeout: cfg.timeout });
    const out = buildOutputStreams();
    await runWebhookUpdate(client as unknown as MinimalClient, flags, out);
  },
});

const webhookDeleteCommand = defineCommand({
  meta: { name: "delete", description: "Permanently remove a webhook subscription." },
  args: {
    ...GLOBAL_FLAGS,
    id: { type: "positional", description: "Webhook id (wh_…)." },
  },
  async run({ args }) {
    const flags = args as WebhookFlags;
    const cfg = await resolveEffectiveConfig({
      apiKey: flags["api-key"],
      baseUrl: flags["base-url"],
      timeout: flags.timeout,
      profile: flags.profile,
    });
    if (!cfg.apiKey) {
      process.stderr.write("error: no API key — run `curviate login` or pass --api-key.\n");
      process.exit(3);
    }
    const client = createClient({ apiKey: cfg.apiKey, baseUrl: cfg.baseUrl, timeout: cfg.timeout });
    const out = buildOutputStreams();
    await runWebhookDelete(client as unknown as MinimalClient, flags, out);
  },
});

const webhookStateDiffCommand = defineCommand({
  meta: { name: "state-diff", description: "Get the set of changes for an account since the last known version." },
  args: {
    ...GLOBAL_FLAGS,
    "account-id": { type: "positional", description: "Account id (acc_…)." },
  },
  async run({ args }) {
    const flags = args as WebhookFlags;
    const cfg = await resolveEffectiveConfig({
      apiKey: flags["api-key"],
      baseUrl: flags["base-url"],
      timeout: flags.timeout,
      profile: flags.profile,
    });
    if (!cfg.apiKey) {
      process.stderr.write("error: no API key — run `curviate login` or pass --api-key.\n");
      process.exit(3);
    }
    const client = createClient({ apiKey: cfg.apiKey, baseUrl: cfg.baseUrl, timeout: cfg.timeout });
    const out = buildOutputStreams();
    await runWebhookStateDiff(client as unknown as MinimalClient, flags, out);
  },
});

const webhookVerifyCommand = defineCommand({
  meta: { name: "verify", description: "Verify a webhook signature offline (no network call)." },
  args: {
    ...GLOBAL_FLAGS,
    secret: {
      type: "string",
      description: "The webhook signing secret from your webhook registration.",
      required: true,
    },
    header: {
      type: "string",
      description: "The full X-Curviate-Signature header value (t=…,v1=…). Reads from stdin if omitted.",
    },
    body: {
      type: "string",
      description: "Path to a file containing the raw webhook body, or - for stdin.",
    },
    "max-age-secs": {
      type: "string",
      description: "Maximum event age in seconds before rejecting as replay (default: 300).",
    },
  },
  async run({ args }) {
    const flags = args as WebhookFlags;
    const out = buildOutputStreams();

    // Read raw body
    let rawBody = "";
    if (flags.body) {
      if (flags.body === "-") {
        rawBody = readFileSync("/dev/stdin", "utf8");
      } else {
        rawBody = readFileSync(flags.body, "utf8");
      }
    }

    const signatureHeader = flags.header ?? "";
    const secret = flags.secret ?? "";
    const replayWindowSecs = flags["max-age-secs"] ? parseInt(flags["max-age-secs"], 10) : undefined;

    await runWebhookVerify({ secret, signatureHeader, rawBody, replayWindowSecs }, out);
  },
});

export const webhookCommand = defineCommand({
  meta: { name: "webhook", description: "Webhook management and signature verification." },
  subCommands: {
    create: webhookCreateCommand,
    list: webhookListCommand,
    events: webhookEventsCommand,
    update: webhookUpdateCommand,
    delete: webhookDeleteCommand,
    "state-diff": webhookStateDiffCommand,
    verify: webhookVerifyCommand,
  },
  async run() {
    process.stderr.write(
      "Usage: curviate webhook <subcommand>\n" +
      "  create | list | events | update | delete | state-diff | verify\n",
    );
  },
});
