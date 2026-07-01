/**
 * `curviate sales-nav` — Sales Navigator operations (tier: sn).
 *
 * Subcommands:
 *   sales-nav sync [--cursor] [--limit]                                           — sync messages (read)
 *   sales-nav search people [--keywords <k>] [--all] [--limit] [--cursor]        — search people (POST)
 *   sales-nav search companies [--keywords <k>] [--all] [--limit] [--cursor]     — search companies (POST)
 *   sales-nav search parameters --type <t>                                        — get filter parameters (read)
 *   sales-nav message new --to <id> "<text>" [--attach <f>…] [--voice <f>] [--video <f>] — start chat (write, multipart)
 *   sales-nav profile <identifier>                                                — get profile (read, resolveIdentifier)
 *   sales-nav save-lead <user_id> [--list-id <id>]                               — save lead (write)
 *
 * All subcommands are account-scoped.
 * Tier-gate: CLI never pre-checks — SDK call goes out; TIER_NOT_ACTIVE / LINKEDIN_FEATURE_NOT_SUBSCRIBED → exit 5.
 * Identifier resolution: applied to `profile <identifier>` only; user_id in save-lead passes verbatim.
 */

import { defineCommand } from "citty";
import { GLOBAL_FLAGS } from "../lib/global-flags.js";
import { resolveIdentifier } from "../lib/identifier.js";
import { resolveEffectiveConfig } from "../lib/resolve.js";
import { createClient } from "../lib/client.js";
import { renderSuccess, renderError, renderUnexpectedError } from "../lib/output.js";
import { buildPreviewOutput } from "../lib/preview.js";
import { streamAll } from "../lib/paginate.js";
import { readAttachment, AttachError } from "../lib/attach.js";
import {
  assembleFilters,
  splitCsv,
  splitCsvNumbers,
  DEFAULT_FILTER_READERS,
  type FilterReaders,
} from "../lib/search-filters.js";
import type { CurviateError } from "@curviate/sdk";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type SalesNavFlags = {
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
  // Subcommand-specific
  to?: string;
  text?: string;
  attach?: string | string[];
  voice?: string;
  video?: string;
  type?: string;
  keywords?: string;
  // search filter escape hatch + curated named flags
  filters?: string;
  "filters-file"?: string;
  "first-name"?: string;
  "last-name"?: string;
  groups?: string;
  "profile-language"?: string;
  technologies?: string;
  "recent-activities"?: string;
  "network-distance"?: string;
  identifier?: string;
  userId?: string;
  "list-id"?: string;
};

type OutputStreams = {
  stdout: { write: (s: string) => void };
  stderr: { write: (s: string) => void };
};

type MinimalClient = {
  account: (id: string) => {
    salesNavigator: {
      syncMessages: (params: Record<string, unknown>) => Promise<unknown>;
      searchPeople: (body: Record<string, unknown>, params?: Record<string, unknown>) => Promise<unknown>;
      searchCompanies: (body: Record<string, unknown>, params?: Record<string, unknown>) => Promise<unknown>;
      getParameters: (params: Record<string, unknown>) => Promise<unknown>;
      startChat: (body: Record<string, unknown>) => Promise<unknown>;
      getProfile: (identifier: string, params?: Record<string, unknown>) => Promise<unknown>;
      saveLead: (userId: string, body: Record<string, unknown>) => Promise<unknown>;
    };
  };
};

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

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

function resolveOutputOpts(flags: SalesNavFlags) {
  return {
    json: (flags.json ?? false) || !process.stdout.isTTY,
    isTTY: process.stdout.isTTY ?? false,
    fields: flags.fields,
  };
}

function normalizeAttachPaths(attach: string | string[] | undefined): string[] {
  if (!attach) return [];
  return Array.isArray(attach) ? attach : [attach];
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
 * Run `sales-nav sync`.
 * Read command — rejects --preview.
 */
export async function runSalesNavSync(
  client: MinimalClient,
  flags: SalesNavFlags,
  out: OutputStreams,
): Promise<void> {
  rejectPreviewOnRead(flags.preview, out);

  const accountId = requireAccount(flags.account, out);
  const ns = client.account(accountId);
  const outOpts = resolveOutputOpts(flags);

  const params: Record<string, unknown> = {};
  if (flags.cursor) params["cursor"] = flags.cursor;
  if (flags.limit) params["limit"] = parseInt(flags.limit, 10);

  try {
    const result = await ns.salesNavigator.syncMessages(params);
    renderSuccess(result, outOpts, out);
  } catch (err: unknown) {
    await handleSdkError(err, outOpts, out);
  }
}

/**
 * Run `sales-nav search people [filters…]`.
 * POST search — read-classified (returns data), rejects --preview.
 * Supports --all / --limit / --cursor pagination.
 */
export async function runSalesNavSearchPeople(
  client: MinimalClient,
  flags: SalesNavFlags,
  out: OutputStreams,
  readers: FilterReaders = DEFAULT_FILTER_READERS,
): Promise<void> {
  rejectPreviewOnRead(flags.preview, out);

  const accountId = requireAccount(flags.account, out);
  const ns = client.account(accountId);
  const outOpts = resolveOutputOpts(flags);
  const all = flags.all ?? false;
  const maxPages = flags["max-pages"] ? parseInt(flags["max-pages"], 10) : 100;
  const limit = flags.limit ? parseInt(flags.limit, 10) : undefined;
  const cursor = flags.cursor;

  // --filters base body, then --keywords and the curated named flags over it.
  // The rich Sales Navigator filters are mostly nested objects, reachable via --filters.
  const assembled = await assembleFilters(flags, readers);
  if ("error" in assembled) {
    out.stderr.write(`error: ${assembled.error}\n`);
    process.exit(2);
  }
  const body = assembled.body;
  if (flags.keywords) body["keywords"] = flags.keywords;
  if (flags["first-name"]) body["first_name"] = flags["first-name"];
  if (flags["last-name"]) body["last_name"] = flags["last-name"];
  if (flags.groups) body["groups"] = splitCsv(flags.groups);
  if (flags["profile-language"]) body["profile_language"] = splitCsv(flags["profile-language"]);

  const params: Record<string, unknown> = {};
  if (limit !== undefined) params["limit"] = limit;
  if (cursor) params["cursor"] = cursor;

  try {
    if (all) {
      const fn = (p: Record<string, unknown>) => {
        const mergedBody = { ...body };
        // Extract pagination params from the merged params
        const { cursor: c, limit: l, ...restP } = p;
        const callParams: Record<string, unknown> = {};
        if (c) callParams["cursor"] = c;
        if (l) callParams["limit"] = l;
        void restP;
        return ns.salesNavigator.searchPeople(mergedBody, callParams) as Promise<{ items?: unknown[]; cursor?: string | null }>;
      };
      for await (const item of streamAll(fn, params, {
        maxPages,
        onTruncated: (n) => out.stderr.write(`Streaming truncated at ${n} page(s). Use --all --max-pages or --cursor for manual paging.\n`),
      })) {
        out.stdout.write(JSON.stringify(item) + "\n");
      }
    } else {
      const result = await ns.salesNavigator.searchPeople(body, Object.keys(params).length > 0 ? params : undefined);
      renderSuccess(result, outOpts, out);
    }
  } catch (err: unknown) {
    await handleSdkError(err, outOpts, out);
  }
}

/**
 * Run `sales-nav search companies [filters…]`.
 * POST search — read-classified, rejects --preview.
 * Supports --all / --limit / --cursor pagination.
 */
export async function runSalesNavSearchCompanies(
  client: MinimalClient,
  flags: SalesNavFlags,
  out: OutputStreams,
  readers: FilterReaders = DEFAULT_FILTER_READERS,
): Promise<void> {
  rejectPreviewOnRead(flags.preview, out);

  const accountId = requireAccount(flags.account, out);
  const ns = client.account(accountId);
  const outOpts = resolveOutputOpts(flags);
  const all = flags.all ?? false;
  const maxPages = flags["max-pages"] ? parseInt(flags["max-pages"], 10) : 100;
  const limit = flags.limit ? parseInt(flags.limit, 10) : undefined;
  const cursor = flags.cursor;

  // --filters base body, then --keywords and the curated named flags over it.
  const assembled = await assembleFilters(flags, readers);
  if ("error" in assembled) {
    out.stderr.write(`error: ${assembled.error}\n`);
    process.exit(2);
  }
  const body = assembled.body;
  if (flags.keywords) body["keywords"] = flags.keywords;
  if (flags.technologies) body["technologies"] = splitCsv(flags.technologies);
  if (flags["recent-activities"]) body["recent_activities"] = splitCsv(flags["recent-activities"]);
  if (flags["network-distance"]) body["network_distance"] = splitCsvNumbers(flags["network-distance"]);

  const params: Record<string, unknown> = {};
  if (limit !== undefined) params["limit"] = limit;
  if (cursor) params["cursor"] = cursor;

  try {
    if (all) {
      const fn = (p: Record<string, unknown>) => {
        const mergedBody = { ...body };
        const { cursor: c, limit: l, ...restP } = p;
        const callParams: Record<string, unknown> = {};
        if (c) callParams["cursor"] = c;
        if (l) callParams["limit"] = l;
        void restP;
        return ns.salesNavigator.searchCompanies(mergedBody, callParams) as Promise<{ items?: unknown[]; cursor?: string | null }>;
      };
      for await (const item of streamAll(fn, params, {
        maxPages,
        onTruncated: (n) => out.stderr.write(`Streaming truncated at ${n} page(s). Use --all --max-pages or --cursor for manual paging.\n`),
      })) {
        out.stdout.write(JSON.stringify(item) + "\n");
      }
    } else {
      const result = await ns.salesNavigator.searchCompanies(body, Object.keys(params).length > 0 ? params : undefined);
      renderSuccess(result, outOpts, out);
    }
  } catch (err: unknown) {
    await handleSdkError(err, outOpts, out);
  }
}

/**
 * Run `sales-nav search parameters --type <t>`.
 * Read command — rejects --preview.
 */
export async function runSalesNavGetParameters(
  client: MinimalClient,
  flags: SalesNavFlags,
  out: OutputStreams,
): Promise<void> {
  rejectPreviewOnRead(flags.preview, out);

  const accountId = requireAccount(flags.account, out);
  const ns = client.account(accountId);
  const outOpts = resolveOutputOpts(flags);

  const params: Record<string, unknown> = {};
  if (flags.type) params["type"] = flags.type;
  if (flags.keywords) params["keywords"] = flags.keywords;
  if (flags.limit) params["limit"] = parseInt(flags.limit, 10);

  try {
    const result = await ns.salesNavigator.getParameters(params);
    renderSuccess(result, outOpts, out);
  } catch (err: unknown) {
    await handleSdkError(err, outOpts, out);
  }
}

/**
 * Run `sales-nav message new --to <id> "<text>" [--attach <f>…] [--voice <f>] [--video <f>]`.
 * Write command — supports --preview. Multipart when files present.
 */
export async function runSalesNavMessageNew(
  client: MinimalClient,
  flags: SalesNavFlags,
  out: OutputStreams,
): Promise<void> {
  const accountId = requireAccount(flags.account, out);
  const to = flags.to ?? "";
  const text = flags.text ?? "";
  const attachPaths = normalizeAttachPaths(flags.attach);
  const voicePath = flags.voice;
  const videoPath = flags.video;

  // Load all file attachments before preview or SDK call.
  let attachBuffers: Buffer[] = [];
  let voiceBuffer: Buffer | undefined;
  let videoBuffer: Buffer | undefined;

  try {
    attachBuffers = await Promise.all(attachPaths.map((p) => readAttachment(p)));
    if (voicePath) voiceBuffer = await readAttachment(voicePath);
    if (videoPath) videoBuffer = await readAttachment(videoPath);
  } catch (err: unknown) {
    if (err instanceof AttachError) {
      out.stderr.write(`error: ${err.message}\n`);
      process.exit(err.exitCode);
    }
    throw err;
  }

  const body: Record<string, unknown> = {
    attendees_ids: [to],
    text,
  };

  if (flags.preview) {
    const preview = buildPreviewOutput({
      method: "salesNavigator.startChat",
      args: { attendees_ids: [to] },
      body: { ...body },
      account: accountId,
      attachments: [
        ...attachBuffers.map((buf, i) => ({
          name: attachPaths[i] ? (attachPaths[i].split("/").pop() ?? attachPaths[i]) : `attachment_${i}`,
          buffer: buf,
        })),
        ...(voiceBuffer ? [{ name: voicePath ? (voicePath.split("/").pop() ?? voicePath) : "voice", buffer: voiceBuffer }] : []),
        ...(videoBuffer ? [{ name: videoPath ? (videoPath.split("/").pop() ?? videoPath) : "video", buffer: videoBuffer }] : []),
      ],
    });
    out.stdout.write(JSON.stringify(preview) + "\n");
    return;
  }

  if (attachBuffers.length > 0) body["attachments"] = attachBuffers;
  if (voiceBuffer) body["voice_message"] = voiceBuffer;
  if (videoBuffer) body["video_message"] = videoBuffer;

  const ns = client.account(accountId);
  const outOpts = resolveOutputOpts(flags);

  try {
    const result = await ns.salesNavigator.startChat(body);
    renderSuccess(result, outOpts, out);
  } catch (err: unknown) {
    await handleSdkError(err, outOpts, out);
  }
}

/**
 * Run `sales-nav profile <identifier>`.
 * Read command — rejects --preview. Identifier resolved via resolveIdentifier.
 */
export async function runSalesNavProfile(
  client: MinimalClient,
  flags: SalesNavFlags,
  out: OutputStreams,
): Promise<void> {
  rejectPreviewOnRead(flags.preview, out);

  const accountId = requireAccount(flags.account, out);
  const rawId = flags.identifier ?? "";
  const resolvedId = resolveIdentifier(rawId);
  const ns = client.account(accountId);
  const outOpts = resolveOutputOpts(flags);

  try {
    const result = await ns.salesNavigator.getProfile(resolvedId, {});
    renderSuccess(result, outOpts, out);
  } catch (err: unknown) {
    await handleSdkError(err, outOpts, out);
  }
}

/**
 * Run `sales-nav save-lead <user_id> [--list-id <id>]`.
 * Write command — supports --preview. user_id passes verbatim (NOT URL-resolved).
 */
export async function runSalesNavSaveLead(
  client: MinimalClient,
  flags: SalesNavFlags,
  out: OutputStreams,
): Promise<void> {
  const accountId = requireAccount(flags.account, out);
  const userId = flags.userId ?? "";
  const outOpts = resolveOutputOpts(flags);

  const body: Record<string, unknown> = {};
  if (flags["list-id"]) body["list_id"] = flags["list-id"];

  if (flags.preview) {
    const preview = buildPreviewOutput({
      method: "salesNavigator.saveLead",
      args: { user_id: userId },
      body,
      account: accountId,
    });
    out.stdout.write(JSON.stringify(preview) + "\n");
    return;
  }

  const ns = client.account(accountId);

  try {
    const result = await ns.salesNavigator.saveLead(userId, body);
    renderSuccess(result, outOpts, out);
  } catch (err: unknown) {
    await handleSdkError(err, outOpts, out);
  }
}

// ---------------------------------------------------------------------------
// Citty command definitions
// ---------------------------------------------------------------------------

const salesNavSyncCommand = defineCommand({
  meta: { name: "sync", description: "Sync Sales Navigator message history for an account." },
  args: { ...GLOBAL_FLAGS },
  async run({ args }) {
    const flags = args as SalesNavFlags;
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
    await runSalesNavSync(client as unknown as MinimalClient, { ...flags, account: flags.account ?? cfg.account }, out);
  },
});

const salesNavMessageNewCommand = defineCommand({
  meta: { name: "new", description: "Start a new Sales Navigator chat." },
  args: {
    ...GLOBAL_FLAGS,
    to: { type: "string", description: "Recipient provider ID.", required: true },
    text: { type: "positional", description: "Message text." },
    attach: { type: "string", description: "File to attach (repeatable)." },
    voice: { type: "string", description: "Voice message file." },
    video: { type: "string", description: "Video message file." },
  },
  async run({ args }) {
    const flags = args as SalesNavFlags;
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
    await runSalesNavMessageNew(client as unknown as MinimalClient, { ...flags, account: flags.account ?? cfg.account }, out);
  },
});

const salesNavMessageCommand = defineCommand({
  meta: { name: "message", description: "Sales Navigator messaging operations." },
  args: { ...GLOBAL_FLAGS },
  subCommands: {
    new: salesNavMessageNewCommand,
  },
  async run() {
    process.stderr.write("Usage: curviate sales-nav message new --to <id> \"<text>\" [--attach <file>…]\n");
  },
});

const salesNavSearchPeopleCommand = defineCommand({
  meta: { name: "people", description: "Search Sales Navigator member profiles." },
  args: {
    ...GLOBAL_FLAGS,
    keywords: { type: "string", description: "Keyword search string." },
    filters: { type: "string", description: "Filter body as a JSON object (escape hatch for the full filter surface); '-' reads JSON from stdin." },
    "filters-file": { type: "string", description: "Path to a JSON file with the filter body." },
    "first-name": { type: "string", description: "First name to match." },
    "last-name": { type: "string", description: "Last name to match." },
    groups: { type: "string", description: "Group ids (comma-separated)." },
    "profile-language": { type: "string", description: "Profile language codes (comma-separated)." },
  },
  async run({ args }) {
    const flags = args as SalesNavFlags;
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
    await runSalesNavSearchPeople(client as unknown as MinimalClient, { ...flags, account: flags.account ?? cfg.account }, out);
  },
});

const salesNavSearchCompaniesCommand = defineCommand({
  meta: { name: "companies", description: "Search Sales Navigator companies." },
  args: {
    ...GLOBAL_FLAGS,
    keywords: { type: "string", description: "Keyword search string." },
    filters: { type: "string", description: "Filter body as a JSON object (escape hatch for the full filter surface); '-' reads JSON from stdin." },
    "filters-file": { type: "string", description: "Path to a JSON file with the filter body." },
    technologies: { type: "string", description: "Technology tags (comma-separated)." },
    "recent-activities": { type: "string", description: "Recent activity ids (comma-separated)." },
    "network-distance": { type: "string", description: "Network distance, 1-3 (comma-separated)." },
  },
  async run({ args }) {
    const flags = args as SalesNavFlags;
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
    await runSalesNavSearchCompanies(client as unknown as MinimalClient, { ...flags, account: flags.account ?? cfg.account }, out);
  },
});

const salesNavSearchParametersCommand = defineCommand({
  meta: { name: "parameters", description: "Resolve Sales Navigator filter parameter IDs." },
  args: {
    ...GLOBAL_FLAGS,
    type: { type: "string", description: "Parameter type (e.g. LOCATION, INDUSTRY, TITLE).", required: true },
    keywords: { type: "string", description: "Human term to resolve (e.g. Berlin)." },
  },
  async run({ args }) {
    const flags = args as SalesNavFlags;
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
    await runSalesNavGetParameters(client as unknown as MinimalClient, { ...flags, account: flags.account ?? cfg.account }, out);
  },
});

const salesNavSearchCommand = defineCommand({
  meta: { name: "search", description: "Sales Navigator search operations." },
  args: { ...GLOBAL_FLAGS },
  subCommands: {
    people: salesNavSearchPeopleCommand,
    companies: salesNavSearchCompaniesCommand,
    parameters: salesNavSearchParametersCommand,
  },
  async run() {
    process.stderr.write(
      "Usage: curviate sales-nav search people [--keywords <k>]\n" +
      "       curviate sales-nav search companies [--keywords <k>]\n" +
      "       curviate sales-nav search parameters --type <t>\n",
    );
  },
});

const salesNavProfileCommand = defineCommand({
  meta: { name: "profile", description: "Get a Sales Navigator enriched member profile." },
  args: {
    ...GLOBAL_FLAGS,
    identifier: { type: "positional", description: "LinkedIn URL, slug, or native id." },
  },
  async run({ args }) {
    const flags = args as SalesNavFlags;
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
    await runSalesNavProfile(client as unknown as MinimalClient, { ...flags, account: flags.account ?? cfg.account }, out);
  },
});

const salesNavSaveLeadCommand = defineCommand({
  meta: { name: "save-lead", description: "Save a Sales Navigator member as a lead." },
  args: {
    ...GLOBAL_FLAGS,
    userId: { type: "positional", description: "Sales Navigator member ID (ACw… format)." },
    "list-id": { type: "string", description: "Lead list ID to save the lead into." },
  },
  async run({ args }) {
    const flags = args as SalesNavFlags;
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
    await runSalesNavSaveLead(client as unknown as MinimalClient, { ...flags, account: flags.account ?? cfg.account }, out);
  },
});

export const salesNavCommand = defineCommand({
  meta: { name: "sales-nav", description: "Sales Navigator operations (requires the Sales Navigator add-on)." },
  args: { ...GLOBAL_FLAGS },
  subCommands: {
    sync: salesNavSyncCommand,
    message: salesNavMessageCommand,
    search: salesNavSearchCommand,
    profile: salesNavProfileCommand,
    "save-lead": salesNavSaveLeadCommand,
  },
  async run() {
    process.stderr.write(
      "Usage: curviate sales-nav sync\n" +
      "       curviate sales-nav search people [--keywords <k>]\n" +
      "       curviate sales-nav search companies [--keywords <k>]\n" +
      "       curviate sales-nav search parameters --type <t>\n" +
      "       curviate sales-nav message new --to <id> \"<text>\"\n" +
      "       curviate sales-nav profile <identifier>\n" +
      "       curviate sales-nav save-lead <user_id> [--list-id <id>]\n",
    );
  },
});
