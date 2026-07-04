/**
 * `curviate account` — account connection management (root-scoped).
 *
 * Subcommands:
 *   account list                                      — list connected accounts
 *   account get <account_id>                          — get one account
 *   account link <body…>                              — link a new account (write)
 *   account connect-link <body…>                      — generate a hosted connect URL (write)
 *   account reconnect <account_id> <body…>            — re-authorize a disconnected account (write)
 *   account refresh <account_id>                      — refresh account sources (write)
 *   account update <account_id> <body…>               — update proxy config (write)
 *   account disconnect <account_id>                   — hard-disconnect an account (write)
 *   account checkpoint submit <body…>                 — submit OTP/2FA code (body-addressed, write)
 *   account checkpoint poll <body…>                   — poll mobile-app approval (body-addressed, write)
 *
 * Root-scoped: all methods live on `curviate.accounts.*` (NOT account-scoped).
 * account_id positionals pass verbatim (NOT resolveIdentifier — not a member/company id).
 * Checkpoint ops are body-addressed: the checkpoint id goes in the body as `account_id`
 * (the provisional account from the 202 response), passed via --checkpoint flag.
 *
 * Slim projection (default): account list and account get return a
 * compact field subset — six cached account-enrichment fields (username,
 * premium_id, public_identifier, substrate_created_at, signatures, groups)
 * are verbose-only. Pass --verbose for the full SDK response. account get
 * keeps --fields but suppresses --limit/--cursor/--all/--max-pages (a
 * single-object read) — account list is unaffected (a genuine list read,
 * keeps all pagination flags).
 */

import { defineCommand } from "citty";
import { GLOBAL_FLAGS, READ_SINGLE_FLAGS, WRITE_SINGLE_FLAGS } from "../lib/global-flags.js";
import { resolveEffectiveConfig } from "../lib/resolve.js";
import { createClient } from "../lib/client.js";
import { renderSuccess, renderError, renderUnexpectedError } from "../lib/output.js";
import { buildPreviewOutput } from "../lib/preview.js";
import { streamAll } from "../lib/paginate.js";
import { slimAccountList, slimAccountListItem, slimAccountGet } from "../lib/slim.js";
import type { CurviateError } from "@curviate/sdk";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type AccountFlags = {
  // positional / path
  "account-id"?: string;
  // link / reconnect body fields
  "seat-id"?: string;
  "auth-method"?: string;
  email?: string;
  password?: string;
  "li-at"?: string;
  "li-a"?: string;
  country?: string;
  ip?: string;
  "proxy-protocol"?: string;
  "proxy-host"?: string;
  "proxy-port"?: string;
  "proxy-username"?: string;
  "proxy-password"?: string;
  "user-agent"?: string;
  "recruiter-contract-id"?: string;
  // connect-link body fields
  purpose?: string;
  "expires-in-seconds"?: string;
  "redirect-url"?: string;
  // checkpoint body fields
  checkpoint?: string;   // maps to body account_id
  code?: string;
  // global
  json?: boolean;
  fields?: string;
  limit?: string;
  cursor?: string;
  all?: boolean;
  "max-pages"?: string;
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

// Minimal root-level client shape (accounts namespace is root-scoped).
type MinimalClient = {
  accounts: {
    list: (params?: Record<string, unknown>) => Promise<unknown>;
    get: (accountId: string) => Promise<unknown>;
    link: (body: Record<string, unknown>) => Promise<unknown>;
    createConnectLink: (body: Record<string, unknown>) => Promise<unknown>;
    reconnect: (accountId: string, body: Record<string, unknown>) => Promise<unknown>;
    refresh: (accountId: string) => Promise<unknown>;
    update: (accountId: string, body: Record<string, unknown>) => Promise<unknown>;
    disconnect: (accountId: string) => Promise<unknown>;
    submitCheckpoint: (body: Record<string, unknown>) => Promise<unknown>;
    pollCheckpoint: (body: Record<string, unknown>) => Promise<unknown>;
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

function resolveOutputOpts(flags: AccountFlags) {
  return {
    json: (flags.json ?? false) || !process.stdout.isTTY,
    isTTY: process.stdout.isTTY ?? false,
    fields: flags.fields,
    verbose: flags.verbose ?? false,
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
// Exported run functions (testable without citty)
// ---------------------------------------------------------------------------

/** Run `account list [--all] [--limit] [--cursor]`. */
export async function runAccountList(
  client: MinimalClient,
  flags: AccountFlags,
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
        client.accounts.list(p) as Promise<{ items?: unknown[]; cursor?: string | null }>;
      for await (const item of streamAll(fn, params, {
        maxPages,
        onTruncated: (n) => out.stderr.write(`Streaming truncated at ${n} page(s). Use --all --max-pages or --cursor for manual paging.\n`),
      })) {
        // Slim mode (default) projects each NDJSON item too; --verbose emits raw items.
        const projected = outOpts.verbose ? item : slimAccountListItem(item as Record<string, unknown>);
        out.stdout.write(JSON.stringify(projected) + "\n");
      }
    } else {
      const result = await client.accounts.list(params);
      renderSuccess(result, { ...outOpts, slim: slimAccountList }, out);
    }
  } catch (err) {
    await handleError(err, outOpts, out);
  }
}

/** Run `account get <account_id>`. account_id passes verbatim. */
export async function runAccountGet(
  client: MinimalClient,
  flags: AccountFlags,
  out: OutputStreams,
): Promise<void> {
  rejectPreviewOnRead(flags.preview, out);
  rejectAllOnNonPaginated(flags.all, out);

  const accountId = flags["account-id"] ?? "";
  const outOpts = resolveOutputOpts(flags);

  try {
    const result = await client.accounts.get(accountId);
    renderSuccess(result, { ...outOpts, slim: slimAccountGet }, out);
  } catch (err) {
    await handleError(err, outOpts, out);
  }
}

/** Build auth body for link/reconnect. */
function buildAuthBody(flags: AccountFlags): Record<string, unknown> {
  const body: Record<string, unknown> = {};

  if (flags["auth-method"]) body["auth_method"] = flags["auth-method"];
  if (flags["user-agent"]) body["user_agent"] = flags["user-agent"];
  if (flags["recruiter-contract-id"]) body["recruiter_contract_id"] = flags["recruiter-contract-id"];

  // credentials object
  if (flags["auth-method"] === "credentials" && (flags.email || flags.password)) {
    body["credentials"] = {
      ...(flags.email ? { email: flags.email } : {}),
      ...(flags.password ? { password: flags.password } : {}),
    };
  }

  // cookie object
  if (flags["auth-method"] === "cookie" && (flags["li-at"] || flags["li-a"])) {
    body["cookie"] = {
      ...(flags["li-at"] ? { li_at: flags["li-at"] } : {}),
      ...(flags["li-a"] ? { li_a: flags["li-a"] } : {}),
    };
  }

  // location hints
  if (flags.country) body["country"] = flags.country;
  if (flags.ip) body["ip"] = flags.ip;

  // proxy
  if (flags["proxy-host"]) {
    body["proxy"] = {
      protocol: flags["proxy-protocol"] ?? "http",
      host: flags["proxy-host"],
      port: flags["proxy-port"] ? parseInt(flags["proxy-port"], 10) : 80,
      ...(flags["proxy-username"] ? { username: flags["proxy-username"] } : {}),
      ...(flags["proxy-password"] ? { password: flags["proxy-password"] } : {}),
    };
  }

  return body;
}

/**
 * Run `account link <body…>`.
 * Required: --seat-id, --auth-method.
 */
export async function runAccountLink(
  client: MinimalClient,
  flags: AccountFlags,
  out: OutputStreams,
): Promise<void> {
  // Validate required fields
  if (!flags["seat-id"]) {
    out.stderr.write("error: --seat-id is required for account link.\n");
    process.exit(2);
  }
  if (!flags["auth-method"]) {
    out.stderr.write("error: --auth-method is required for account link (credentials | cookie).\n");
    process.exit(2);
  }

  const body: Record<string, unknown> = {
    seat_id: flags["seat-id"],
    ...buildAuthBody(flags),
  };

  const outOpts = resolveOutputOpts(flags);

  if (flags.preview) {
    const preview = buildPreviewOutput({ method: "accounts.link", args: {}, body });
    out.stdout.write(JSON.stringify(preview) + "\n");
    return;
  }

  try {
    const result = await client.accounts.link(body);
    renderSuccess(result, outOpts, out);
  } catch (err) {
    await handleError(err, outOpts, out);
  }
}

/**
 * Run `account connect-link <body…>`.
 * All body fields are optional (conditional on purpose).
 */
export async function runAccountConnectLink(
  client: MinimalClient,
  flags: AccountFlags,
  out: OutputStreams,
): Promise<void> {
  const body: Record<string, unknown> = {};
  if (flags["seat-id"]) body["seat_id"] = flags["seat-id"];
  if (flags["account-id"]) body["account_id"] = flags["account-id"];
  if (flags.purpose) body["purpose"] = flags.purpose;
  if (flags["expires-in-seconds"]) body["expires_in_seconds"] = parseInt(flags["expires-in-seconds"], 10);
  if (flags["redirect-url"]) body["redirect_url"] = flags["redirect-url"];

  const outOpts = resolveOutputOpts(flags);

  if (flags.preview) {
    const preview = buildPreviewOutput({ method: "accounts.createConnectLink", args: {}, body });
    out.stdout.write(JSON.stringify(preview) + "\n");
    return;
  }

  try {
    const result = await client.accounts.createConnectLink(body);
    renderSuccess(result, outOpts, out);
  } catch (err) {
    await handleError(err, outOpts, out);
  }
}

/**
 * Run `account reconnect <account_id> <body…>`.
 * Required: --account-id (positional), --auth-method.
 */
export async function runAccountReconnect(
  client: MinimalClient,
  flags: AccountFlags,
  out: OutputStreams,
): Promise<void> {
  if (!flags["auth-method"]) {
    out.stderr.write("error: --auth-method is required for account reconnect (credentials | cookie).\n");
    process.exit(2);
  }

  const accountId = flags["account-id"] ?? "";
  const body = buildAuthBody(flags);
  const outOpts = resolveOutputOpts(flags);

  if (flags.preview) {
    const preview = buildPreviewOutput({
      method: "accounts.reconnect",
      args: { accountId },
      body,
    });
    out.stdout.write(JSON.stringify(preview) + "\n");
    return;
  }

  try {
    const result = await client.accounts.reconnect(accountId, body);
    renderSuccess(result, outOpts, out);
  } catch (err) {
    await handleError(err, outOpts, out);
  }
}

/** Run `account refresh <account_id>`. */
export async function runAccountRefresh(
  client: MinimalClient,
  flags: AccountFlags,
  out: OutputStreams,
): Promise<void> {
  const accountId = flags["account-id"] ?? "";
  const outOpts = resolveOutputOpts(flags);

  if (flags.preview) {
    const preview = buildPreviewOutput({
      method: "accounts.refresh",
      args: { accountId },
      body: {},
    });
    out.stdout.write(JSON.stringify(preview) + "\n");
    return;
  }

  try {
    const result = await client.accounts.refresh(accountId);
    renderSuccess(result, outOpts, out);
  } catch (err) {
    await handleError(err, outOpts, out);
  }
}

/**
 * Run `account update <account_id> <body…>`.
 * Body: optional proxy / country / ip.
 */
export async function runAccountUpdate(
  client: MinimalClient,
  flags: AccountFlags,
  out: OutputStreams,
): Promise<void> {
  const accountId = flags["account-id"] ?? "";
  const body: Record<string, unknown> = {};

  if (flags.country) body["country"] = flags.country;
  if (flags.ip) body["ip"] = flags.ip;
  if (flags["proxy-host"]) {
    body["proxy"] = {
      protocol: flags["proxy-protocol"] ?? "http",
      host: flags["proxy-host"],
      port: flags["proxy-port"] ? parseInt(flags["proxy-port"], 10) : 80,
      ...(flags["proxy-username"] ? { username: flags["proxy-username"] } : {}),
      ...(flags["proxy-password"] ? { password: flags["proxy-password"] } : {}),
    };
  }

  const outOpts = resolveOutputOpts(flags);

  if (flags.preview) {
    const preview = buildPreviewOutput({
      method: "accounts.update",
      args: { accountId },
      body,
    });
    out.stdout.write(JSON.stringify(preview) + "\n");
    return;
  }

  try {
    const result = await client.accounts.update(accountId, body);
    renderSuccess(result, outOpts, out);
  } catch (err) {
    await handleError(err, outOpts, out);
  }
}

/** Run `account disconnect <account_id>`. */
export async function runAccountDisconnect(
  client: MinimalClient,
  flags: AccountFlags,
  out: OutputStreams,
): Promise<void> {
  const accountId = flags["account-id"] ?? "";
  const outOpts = resolveOutputOpts(flags);

  if (flags.preview) {
    const preview = buildPreviewOutput({
      method: "accounts.disconnect",
      args: { accountId },
      body: {},
    });
    out.stdout.write(JSON.stringify(preview) + "\n");
    return;
  }

  try {
    const result = await client.accounts.disconnect(accountId);
    renderSuccess(result, outOpts, out);
  } catch (err) {
    await handleError(err, outOpts, out);
  }
}

/**
 * Run `account checkpoint submit <body…>`.
 * Body-addressed: checkpoint id in body as `account_id` (--checkpoint flag).
 * Required: --checkpoint (maps to body.account_id), --code.
 */
export async function runAccountCheckpointSubmit(
  client: MinimalClient,
  flags: AccountFlags,
  out: OutputStreams,
): Promise<void> {
  if (!flags.checkpoint) {
    out.stderr.write("error: --checkpoint is required (the provisional account_id from the 202 response).\n");
    process.exit(2);
  }
  if (!flags.code) {
    out.stderr.write("error: --code is required (the OTP / 2FA code).\n");
    process.exit(2);
  }

  const body: Record<string, unknown> = {
    account_id: flags.checkpoint,
    code: flags.code,
  };

  const outOpts = resolveOutputOpts(flags);

  if (flags.preview) {
    const preview = buildPreviewOutput({
      method: "accounts.submitCheckpoint",
      args: {},
      body,
    });
    out.stdout.write(JSON.stringify(preview) + "\n");
    return;
  }

  try {
    const result = await client.accounts.submitCheckpoint(body);
    renderSuccess(result, outOpts, out);
  } catch (err) {
    await handleError(err, outOpts, out);
  }
}

/**
 * Run `account checkpoint poll <body…>`.
 * Body-addressed: checkpoint id in body as `account_id` (--checkpoint flag).
 * Required: --checkpoint.
 */
export async function runAccountCheckpointPoll(
  client: MinimalClient,
  flags: AccountFlags,
  out: OutputStreams,
): Promise<void> {
  if (!flags.checkpoint) {
    out.stderr.write("error: --checkpoint is required (the provisional account_id from the 202 response).\n");
    process.exit(2);
  }

  const body: Record<string, unknown> = {
    account_id: flags.checkpoint,
  };

  const outOpts = resolveOutputOpts(flags);

  if (flags.preview) {
    const preview = buildPreviewOutput({
      method: "accounts.pollCheckpoint",
      args: {},
      body,
    });
    out.stdout.write(JSON.stringify(preview) + "\n");
    return;
  }

  try {
    const result = await client.accounts.pollCheckpoint(body);
    renderSuccess(result, outOpts, out);
  } catch (err) {
    await handleError(err, outOpts, out);
  }
}

// ---------------------------------------------------------------------------
// Citty command definitions
// ---------------------------------------------------------------------------

const accountListCommand = defineCommand({
  meta: { name: "list", description: "List connected LinkedIn accounts." },
  args: { ...GLOBAL_FLAGS },
  async run({ args }) {
    const flags = args as AccountFlags;
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
    await runAccountList(client as unknown as MinimalClient, flags, out);
  },
});

const accountGetCommand = defineCommand({
  meta: { name: "get", description: "Get a connected LinkedIn account." },
  args: {
    // Single-object read: READ_SINGLE_FLAGS omits pagination flags, keeps --fields
    ...READ_SINGLE_FLAGS,
    "account-id": { type: "positional", description: "Account id (acc_…)." },
  },
  async run({ args }) {
    const flags = args as AccountFlags;
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
    await runAccountGet(client as unknown as MinimalClient, flags, out);
  },
});

const accountLinkCommand = defineCommand({
  meta: {
    name: "link",
    description:
      "Connect a LinkedIn account to an empty seat. " +
      "If LinkedIn requires verification you'll be prompted for the code interactively; in a non-interactive shell the command exits 12 and you finish with `curviate account checkpoint submit`.",
  },
  args: {
    ...WRITE_SINGLE_FLAGS,
    "seat-id": { type: "string", description: "Empty seat to bind the account to.", required: true },
    "auth-method": { type: "string", description: "Authentication method: credentials | cookie.", required: true },
    email: { type: "string", description: "LinkedIn email (credentials method)." },
    password: { type: "string", description: "LinkedIn password (credentials method)." },
    "li-at": { type: "string", description: "LinkedIn session cookie li_at (cookie method)." },
    "li-a": { type: "string", description: "Optional premium session cookie li_a (cookie method)." },
    country: { type: "string", description: "Proxy location hint (ISO 3166-1 alpha-2)." },
    ip: { type: "string", description: "IP to infer the managed proxy location." },
    "proxy-protocol": { type: "string", description: "Proxy protocol: http | https | socks5." },
    "proxy-host": { type: "string", description: "Proxy host or IP." },
    "proxy-port": { type: "string", description: "Proxy port." },
    "proxy-username": { type: "string", description: "Proxy auth username." },
    "proxy-password": { type: "string", description: "Proxy auth password." },
    "user-agent": { type: "string", description: "Browser User-Agent to pin for this account." },
    "recruiter-contract-id": { type: "string", description: "Recruiter contract to bind to (Recruiter tier only)." },
  },
  async run({ args }) {
    const flags = args as AccountFlags;
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
    await runAccountLink(client as unknown as MinimalClient, flags, out);
  },
});

const accountConnectLinkCommand = defineCommand({
  meta: { name: "connect-link", description: "Generate a one-time hosted account connection URL." },
  args: {
    ...WRITE_SINGLE_FLAGS,
    "seat-id": { type: "string", description: "Target seat (required when purpose=create)." },
    "account-id": { type: "string", description: "Account to reconnect (required when purpose=reconnect)." },
    purpose: { type: "string", description: "create | reconnect (default: create)." },
    "expires-in-seconds": { type: "string", description: "Link expiry in seconds (60–3600, default 900)." },
    "redirect-url": { type: "string", description: "Browser return URL after the hosted flow." },
  },
  async run({ args }) {
    const flags = args as AccountFlags;
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
    await runAccountConnectLink(client as unknown as MinimalClient, flags, out);
  },
});

const accountReconnectCommand = defineCommand({
  meta: {
    name: "reconnect",
    description:
      "Re-authorize a disconnected account in place. " +
      "If LinkedIn requires verification you'll be prompted for the code interactively; in a non-interactive shell the command exits 12 and you finish with `curviate account checkpoint submit`.",
  },
  args: {
    ...WRITE_SINGLE_FLAGS,
    "account-id": { type: "positional", description: "Account id (acc_…)." },
    "auth-method": { type: "string", description: "Authentication method: credentials | cookie.", required: true },
    email: { type: "string", description: "LinkedIn email (credentials method)." },
    password: { type: "string", description: "LinkedIn password (credentials method)." },
    "li-at": { type: "string", description: "LinkedIn session cookie li_at (cookie method)." },
    "li-a": { type: "string", description: "Optional premium session cookie li_a (cookie method)." },
    country: { type: "string", description: "Proxy location hint (ISO 3166-1 alpha-2)." },
    ip: { type: "string", description: "IP to infer the managed proxy location." },
    "proxy-protocol": { type: "string", description: "Proxy protocol: http | https | socks5." },
    "proxy-host": { type: "string", description: "Proxy host or IP." },
    "proxy-port": { type: "string", description: "Proxy port." },
    "proxy-username": { type: "string", description: "Proxy auth username." },
    "proxy-password": { type: "string", description: "Proxy auth password." },
    "user-agent": { type: "string", description: "Browser User-Agent to pin." },
    "recruiter-contract-id": { type: "string", description: "Recruiter contract id (Recruiter tier only)." },
  },
  async run({ args }) {
    const flags = args as AccountFlags;
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
    await runAccountReconnect(client as unknown as MinimalClient, flags, out);
  },
});

const accountRefreshCommand = defineCommand({
  meta: { name: "refresh", description: "Refresh an account's synced data sources." },
  args: {
    ...WRITE_SINGLE_FLAGS,
    "account-id": { type: "positional", description: "Account id (acc_…)." },
  },
  async run({ args }) {
    const flags = args as AccountFlags;
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
    await runAccountRefresh(client as unknown as MinimalClient, flags, out);
  },
});

const accountUpdateCommand = defineCommand({
  meta: { name: "update", description: "Update managed-proxy configuration for an account." },
  args: {
    ...WRITE_SINGLE_FLAGS,
    "account-id": { type: "positional", description: "Account id (acc_…)." },
    country: { type: "string", description: "Proxy location hint (ISO 3166-1 alpha-2)." },
    ip: { type: "string", description: "IP to infer the managed proxy location." },
    "proxy-protocol": { type: "string", description: "Proxy protocol: http | https | socks5." },
    "proxy-host": { type: "string", description: "Proxy host or IP." },
    "proxy-port": { type: "string", description: "Proxy port." },
    "proxy-username": { type: "string", description: "Proxy auth username." },
    "proxy-password": { type: "string", description: "Proxy auth password." },
  },
  async run({ args }) {
    const flags = args as AccountFlags;
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
    await runAccountUpdate(client as unknown as MinimalClient, flags, out);
  },
});

const accountDisconnectCommand = defineCommand({
  meta: { name: "disconnect", description: "Hard-disconnect a LinkedIn account and release its seat." },
  args: {
    ...WRITE_SINGLE_FLAGS,
    "account-id": { type: "positional", description: "Account id (acc_…)." },
  },
  async run({ args }) {
    const flags = args as AccountFlags;
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
    await runAccountDisconnect(client as unknown as MinimalClient, flags, out);
  },
});

const accountCheckpointSubmitCommand = defineCommand({
  meta: { name: "submit", description: "Submit an OTP / 2FA code to resolve a checkpoint challenge." },
  args: {
    ...WRITE_SINGLE_FLAGS,
    checkpoint: {
      type: "string",
      description: "The provisional account_id from the 202 checkpoint_required response.",
      required: true,
    },
    code: {
      type: "string",
      description: "The OTP / 2FA verification code (or TRY_ANOTHER_WAY to switch challenge type).",
      required: true,
    },
  },
  async run({ args }) {
    const flags = args as AccountFlags;
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
    await runAccountCheckpointSubmit(client as unknown as MinimalClient, flags, out);
  },
});

const accountCheckpointPollCommand = defineCommand({
  meta: { name: "poll", description: "Poll for mobile-app approval of a pending checkpoint challenge." },
  args: {
    ...WRITE_SINGLE_FLAGS,
    checkpoint: {
      type: "string",
      description: "The provisional account_id from the 202 checkpoint_required response.",
      required: true,
    },
  },
  async run({ args }) {
    const flags = args as AccountFlags;
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
    await runAccountCheckpointPoll(client as unknown as MinimalClient, flags, out);
  },
});

const accountCheckpointCommand = defineCommand({
  meta: { name: "checkpoint", description: "Checkpoint challenge operations (submit OTP or poll mobile-app approval)." },
  subCommands: {
    submit: accountCheckpointSubmitCommand,
    poll: accountCheckpointPollCommand,
  },
  async run() {
    process.stderr.write("Usage: curviate account checkpoint submit | poll\n");
  },
});

export const accountCommand = defineCommand({
  meta: { name: "account", description: "LinkedIn account connection management." },
  subCommands: {
    list: accountListCommand,
    get: accountGetCommand,
    link: accountLinkCommand,
    "connect-link": accountConnectLinkCommand,
    reconnect: accountReconnectCommand,
    refresh: accountRefreshCommand,
    update: accountUpdateCommand,
    disconnect: accountDisconnectCommand,
    checkpoint: accountCheckpointCommand,
  },
  async run() {
    process.stderr.write(
      "Usage: curviate account <subcommand>\n" +
      "  list | get | link | connect-link | reconnect | refresh | update | disconnect | checkpoint\n",
    );
  },
});
