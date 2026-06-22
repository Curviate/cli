/**
 * `curviate search` — LinkedIn search operations.
 *
 * Subcommands:
 *   search people [--url <u>] [filters...]    — search people (POST body)
 *   search companies [filters...]             — search companies (POST body)
 *   search posts [filters...]                 — search posts (POST body)
 *   search jobs [filters...]                  — search jobs (POST body)
 *   search parameters --type <t> [--keywords] — resolve filter IDs (GET)
 *
 * SDK reality: people/companies/posts/jobs are HTTP POST; cursor+limit go on
 * the query, not the body (the SDK splits them out). The CLI passes cursor+limit
 * merged into the method call — the SDK resource handles the split.
 *
 * All read commands reject --preview (exit 2).
 * search parameters rejects --all (non-paginated).
 * List POST searches support --all NDJSON streaming.
 */

import { defineCommand } from "citty";
import { GLOBAL_FLAGS } from "../lib/global-flags.js";
import { resolveEffectiveConfig } from "../lib/resolve.js";
import { createClient } from "../lib/client.js";
import { renderSuccess, renderError, renderUnexpectedError } from "../lib/output.js";
import { streamAll } from "../lib/paginate.js";
import type { CurviateError } from "@curviate/sdk";

type SearchFlags = {
  keywords?: string;
  url?: string;
  type?: string;
  limit?: string;
  cursor?: string;
  all?: boolean;
  "max-pages"?: string;
  account?: string;
  json?: boolean;
  fields?: string;
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
    search: {
      people: (params: Record<string, unknown>) => Promise<unknown>;
      companies: (params: Record<string, unknown>) => Promise<unknown>;
      posts: (params: Record<string, unknown>) => Promise<unknown>;
      jobs: (params: Record<string, unknown>) => Promise<unknown>;
      getParameters: (params: Record<string, unknown>) => Promise<unknown>;
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

function resolveOutputOpts(flags: SearchFlags) {
  return {
    json: (flags.json ?? false) || !process.stdout.isTTY,
    isTTY: process.stdout.isTTY ?? false,
    fields: flags.fields,
  };
}

/** Build body params from flags — omit undefined values. */
function buildSearchBody(flags: SearchFlags): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  if (flags.keywords) body["keywords"] = flags.keywords;
  if (flags.url) body["url"] = flags.url;
  // cursor + limit go as query params (SDK splits them out of the body)
  if (flags.cursor) body["cursor"] = flags.cursor;
  if (flags.limit) body["limit"] = parseInt(flags.limit, 10);
  return body;
}

// ---------------------------------------------------------------------------
// Exported run functions (testable without citty)
// ---------------------------------------------------------------------------

/**
 * Run `search people [--url <u>] [filters...]`.
 * POST body search — cursor+limit passed to SDK (which splits to query).
 */
export async function runSearchPeople(
  client: MinimalClient,
  flags: SearchFlags,
  out: OutputStreams,
): Promise<void> {
  rejectPreviewOnRead(flags.preview, out);

  const accountId = requireAccount(flags.account, out);
  const ns = client.account(accountId);
  const outOpts = resolveOutputOpts(flags);
  const all = flags.all ?? false;
  const maxPages = flags["max-pages"] ? parseInt(flags["max-pages"], 10) : 100;
  const body = buildSearchBody(flags);

  try {
    if (all) {
      const fn = (p: Record<string, unknown>) => ns.search.people(p) as Promise<{ items?: unknown[]; cursor?: string | null }>;
      for await (const item of streamAll(fn, body, {
        maxPages,
        onTruncated: (msg) => out.stderr.write(msg + "\n"),
      })) {
        out.stdout.write(JSON.stringify(item) + "\n");
      }
    } else {
      const result = await ns.search.people(body);
      renderSuccess(result, outOpts, out);
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
 * Run `search companies [filters...]`.
 * POST body search.
 */
export async function runSearchCompanies(
  client: MinimalClient,
  flags: SearchFlags,
  out: OutputStreams,
): Promise<void> {
  rejectPreviewOnRead(flags.preview, out);

  const accountId = requireAccount(flags.account, out);
  const ns = client.account(accountId);
  const outOpts = resolveOutputOpts(flags);
  const all = flags.all ?? false;
  const maxPages = flags["max-pages"] ? parseInt(flags["max-pages"], 10) : 100;
  const body = buildSearchBody(flags);

  try {
    if (all) {
      const fn = (p: Record<string, unknown>) => ns.search.companies(p) as Promise<{ items?: unknown[]; cursor?: string | null }>;
      for await (const item of streamAll(fn, body, {
        maxPages,
        onTruncated: (msg) => out.stderr.write(msg + "\n"),
      })) {
        out.stdout.write(JSON.stringify(item) + "\n");
      }
    } else {
      const result = await ns.search.companies(body);
      renderSuccess(result, outOpts, out);
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
 * Run `search posts [filters...]`.
 * POST body search.
 */
export async function runSearchPosts(
  client: MinimalClient,
  flags: SearchFlags,
  out: OutputStreams,
): Promise<void> {
  rejectPreviewOnRead(flags.preview, out);

  const accountId = requireAccount(flags.account, out);
  const ns = client.account(accountId);
  const outOpts = resolveOutputOpts(flags);
  const all = flags.all ?? false;
  const maxPages = flags["max-pages"] ? parseInt(flags["max-pages"], 10) : 100;
  const body = buildSearchBody(flags);

  try {
    if (all) {
      const fn = (p: Record<string, unknown>) => ns.search.posts(p) as Promise<{ items?: unknown[]; cursor?: string | null }>;
      for await (const item of streamAll(fn, body, {
        maxPages,
        onTruncated: (msg) => out.stderr.write(msg + "\n"),
      })) {
        out.stdout.write(JSON.stringify(item) + "\n");
      }
    } else {
      const result = await ns.search.posts(body);
      renderSuccess(result, outOpts, out);
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
 * Run `search jobs [filters...]`.
 * POST body search.
 */
export async function runSearchJobs(
  client: MinimalClient,
  flags: SearchFlags,
  out: OutputStreams,
): Promise<void> {
  rejectPreviewOnRead(flags.preview, out);

  const accountId = requireAccount(flags.account, out);
  const ns = client.account(accountId);
  const outOpts = resolveOutputOpts(flags);
  const all = flags.all ?? false;
  const maxPages = flags["max-pages"] ? parseInt(flags["max-pages"], 10) : 100;
  const body = buildSearchBody(flags);

  try {
    if (all) {
      const fn = (p: Record<string, unknown>) => ns.search.jobs(p) as Promise<{ items?: unknown[]; cursor?: string | null }>;
      for await (const item of streamAll(fn, body, {
        maxPages,
        onTruncated: (msg) => out.stderr.write(msg + "\n"),
      })) {
        out.stdout.write(JSON.stringify(item) + "\n");
      }
    } else {
      const result = await ns.search.jobs(body);
      renderSuccess(result, outOpts, out);
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
 * Run `search parameters --type <t> [--keywords <k>]`.
 * GET — not paginated; rejects --all (exit 2).
 */
export async function runSearchParameters(
  client: MinimalClient,
  flags: SearchFlags,
  out: OutputStreams,
): Promise<void> {
  rejectPreviewOnRead(flags.preview, out);
  rejectAllOnNonPaginated(flags.all, out);

  const accountId = requireAccount(flags.account, out);
  const ns = client.account(accountId);
  const outOpts = resolveOutputOpts(flags);

  const query: Record<string, unknown> = {};
  if (flags.type) query["type"] = flags.type;
  if (flags.keywords) query["keywords"] = flags.keywords;
  if (flags.limit) query["limit"] = parseInt(flags.limit, 10);

  try {
    const result = await ns.search.getParameters(query);
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

const searchPeopleCommand = defineCommand({
  meta: { name: "people", description: "Search LinkedIn members with structured filters." },
  args: {
    ...GLOBAL_FLAGS,
    keywords: { type: "string", description: "Full-text keyword search." },
    url: { type: "string", description: "Pasted LinkedIn search URL (mutually exclusive with filters)." },
  },
  async run({ args }) {
    const flags = args as SearchFlags;
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
    await runSearchPeople(client as unknown as MinimalClient, { ...flags, account: flags.account ?? cfg.account }, out);
  },
});

const searchCompaniesCommand = defineCommand({
  meta: { name: "companies", description: "Search LinkedIn companies." },
  args: {
    ...GLOBAL_FLAGS,
    keywords: { type: "string", description: "Full-text keyword search." },
  },
  async run({ args }) {
    const flags = args as SearchFlags;
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
    await runSearchCompanies(client as unknown as MinimalClient, { ...flags, account: flags.account ?? cfg.account }, out);
  },
});

const searchPostsCommand = defineCommand({
  meta: { name: "posts", description: "Search LinkedIn posts." },
  args: {
    ...GLOBAL_FLAGS,
    keywords: { type: "string", description: "Full-text keyword search." },
  },
  async run({ args }) {
    const flags = args as SearchFlags;
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
    await runSearchPosts(client as unknown as MinimalClient, { ...flags, account: flags.account ?? cfg.account }, out);
  },
});

const searchJobsCommand = defineCommand({
  meta: { name: "jobs", description: "Search LinkedIn jobs." },
  args: {
    ...GLOBAL_FLAGS,
    keywords: { type: "string", description: "Full-text keyword search." },
  },
  async run({ args }) {
    const flags = args as SearchFlags;
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
    await runSearchJobs(client as unknown as MinimalClient, { ...flags, account: flags.account ?? cfg.account }, out);
  },
});

const searchParametersCommand = defineCommand({
  meta: { name: "parameters", description: "Resolve human-readable terms to opaque filter IDs." },
  args: {
    ...GLOBAL_FLAGS,
    type: { type: "string", description: "Parameter type (e.g. LOCATION, COMPANY, INDUSTRY).", required: true },
    keywords: { type: "string", description: "Human term to resolve (not required for EMPLOYMENT_TYPE)." },
  },
  async run({ args }) {
    const flags = args as SearchFlags;
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
    await runSearchParameters(client as unknown as MinimalClient, { ...flags, account: flags.account ?? cfg.account }, out);
  },
});

export const searchCommand = defineCommand({
  meta: { name: "search", description: "Search LinkedIn members, companies, posts, and jobs." },
  subCommands: {
    people: searchPeopleCommand,
    companies: searchCompaniesCommand,
    posts: searchPostsCommand,
    jobs: searchJobsCommand,
    parameters: searchParametersCommand,
  },
  async run() {
    process.stderr.write(
      "Usage: curviate search <subcommand>\n" +
      "  people [--url <u>] [--keywords <k>]\n" +
      "  companies [--keywords <k>]\n" +
      "  posts [--keywords <k>]\n" +
      "  jobs [--keywords <k>]\n" +
      "  parameters --type <t> [--keywords <k>]\n",
    );
  },
});
