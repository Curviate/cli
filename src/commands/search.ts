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
import {
  assembleFilters,
  splitCsv,
  splitCsvNumbers,
  DEFAULT_FILTER_READERS,
  type FilterReaders,
} from "../lib/search-filters.js";
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
  // Filter escape hatch (reaches every documented filter as JSON).
  filters?: string;
  "filters-file"?: string;
  // Curated named convenience flags (string arrays are comma-separated).
  industry?: string;
  location?: string;
  company?: string;
  "past-company"?: string;
  school?: string;
  "network-distance"?: string;
  "connections-of"?: string;
  "followers-of"?: string;
  "sort-by"?: string;
  "date-posted"?: string;
  "content-type"?: string;
  seniority?: string;
  function?: string;
  "job-type"?: string;
  region?: string;
};

/** Named convenience flags reused across the search description sets. */
const FILTER_FLAGS = {
  filters: {
    type: "string" as const,
    description: "Filter body as a JSON object (escape hatch for the full filter surface); '-' reads JSON from stdin.",
  },
  "filters-file": {
    type: "string" as const,
    description: "Path to a JSON file with the filter body.",
  },
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

/** Apply the common --keywords / --url / pagination flags over a body. */
function applyCommonSearchFlags(body: Record<string, unknown>, flags: SearchFlags): void {
  if (flags.keywords) body["keywords"] = flags.keywords;
  if (flags.url) body["url"] = flags.url;
  // cursor + limit go as query params (SDK splits them out of the body)
  if (flags.cursor) body["cursor"] = flags.cursor;
  if (flags.limit) body["limit"] = parseInt(flags.limit, 10);
}

/**
 * Per-command named-flag mappers. Each maps the curated convenience flags to the
 * exact API request-body field names, merging OVER the --filters base body.
 * String-array fields are comma-separated; network_distance is a number array.
 */
const NAMED_FLAG_MAPPERS: Record<string, (body: Record<string, unknown>, flags: SearchFlags) => void> = {
  people(body, flags) {
    if (flags.industry) body["industry"] = splitCsv(flags.industry);
    if (flags.location) body["location"] = splitCsv(flags.location);
    if (flags.company) body["company"] = splitCsv(flags.company);
    if (flags["past-company"]) body["past_company"] = splitCsv(flags["past-company"]);
    if (flags.school) body["school"] = splitCsv(flags.school);
    if (flags["network-distance"]) body["network_distance"] = splitCsvNumbers(flags["network-distance"]);
    if (flags["connections-of"]) body["connections_of"] = flags["connections-of"];
    if (flags["followers-of"]) body["followers_of"] = flags["followers-of"];
  },
  companies(body, flags) {
    if (flags.industry) body["industry"] = splitCsv(flags.industry);
    if (flags.location) body["location"] = splitCsv(flags.location);
    if (flags["network-distance"]) body["network_distance"] = splitCsvNumbers(flags["network-distance"]);
  },
  posts(body, flags) {
    if (flags["sort-by"]) body["sort_by"] = flags["sort-by"];
    if (flags["date-posted"]) body["date_posted"] = flags["date-posted"];
    if (flags["content-type"]) body["content_type"] = flags["content-type"];
  },
  jobs(body, flags) {
    if (flags.location) body["location"] = splitCsv(flags.location);
    if (flags.industry) body["industry"] = splitCsv(flags.industry);
    if (flags.seniority) body["seniority"] = splitCsv(flags.seniority);
    if (flags.function) body["function"] = splitCsv(flags.function);
    if (flags["job-type"]) body["job_type"] = splitCsv(flags["job-type"]);
    if (flags.company) body["company"] = splitCsv(flags.company);
    if (flags["sort-by"]) body["sort_by"] = flags["sort-by"];
    if (flags.region) body["region"] = flags.region;
  },
};

/**
 * Build the POST search body: the --filters JSON base, then --keywords / --url /
 * pagination and the per-command named convenience flags merged OVER it.
 * Returns the body, or an `error` string when --filters does not parse to an
 * object (the caller exits 2 without an API call).
 */
async function buildSearchBody(
  kind: keyof typeof NAMED_FLAG_MAPPERS,
  flags: SearchFlags,
  readers: FilterReaders,
): Promise<{ body: Record<string, unknown> } | { error: string }> {
  const assembled = await assembleFilters(flags, readers);
  if ("error" in assembled) return assembled;
  const body = assembled.body;
  applyCommonSearchFlags(body, flags);
  NAMED_FLAG_MAPPERS[kind]!(body, flags);
  return { body };
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
  readers: FilterReaders = DEFAULT_FILTER_READERS,
): Promise<void> {
  rejectPreviewOnRead(flags.preview, out);

  const accountId = requireAccount(flags.account, out);
  const ns = client.account(accountId);
  const outOpts = resolveOutputOpts(flags);
  const all = flags.all ?? false;
  const maxPages = flags["max-pages"] ? parseInt(flags["max-pages"], 10) : 100;
  const assembled = await buildSearchBody("people", flags, readers);
  if ("error" in assembled) {
    out.stderr.write(`error: ${assembled.error}\n`);
    process.exit(2);
  }
  const body = assembled.body;

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
  readers: FilterReaders = DEFAULT_FILTER_READERS,
): Promise<void> {
  rejectPreviewOnRead(flags.preview, out);

  const accountId = requireAccount(flags.account, out);
  const ns = client.account(accountId);
  const outOpts = resolveOutputOpts(flags);
  const all = flags.all ?? false;
  const maxPages = flags["max-pages"] ? parseInt(flags["max-pages"], 10) : 100;
  const assembled = await buildSearchBody("companies", flags, readers);
  if ("error" in assembled) {
    out.stderr.write(`error: ${assembled.error}\n`);
    process.exit(2);
  }
  const body = assembled.body;

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
  readers: FilterReaders = DEFAULT_FILTER_READERS,
): Promise<void> {
  rejectPreviewOnRead(flags.preview, out);

  const accountId = requireAccount(flags.account, out);
  const ns = client.account(accountId);
  const outOpts = resolveOutputOpts(flags);
  const all = flags.all ?? false;
  const maxPages = flags["max-pages"] ? parseInt(flags["max-pages"], 10) : 100;
  const assembled = await buildSearchBody("posts", flags, readers);
  if ("error" in assembled) {
    out.stderr.write(`error: ${assembled.error}\n`);
    process.exit(2);
  }
  const body = assembled.body;

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
  readers: FilterReaders = DEFAULT_FILTER_READERS,
): Promise<void> {
  rejectPreviewOnRead(flags.preview, out);

  const accountId = requireAccount(flags.account, out);
  const ns = client.account(accountId);
  const outOpts = resolveOutputOpts(flags);
  const all = flags.all ?? false;
  const maxPages = flags["max-pages"] ? parseInt(flags["max-pages"], 10) : 100;
  const assembled = await buildSearchBody("jobs", flags, readers);
  if ("error" in assembled) {
    out.stderr.write(`error: ${assembled.error}\n`);
    process.exit(2);
  }
  const body = assembled.body;

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
    ...FILTER_FLAGS,
    industry: { type: "string", description: "Industry ids (comma-separated)." },
    location: { type: "string", description: "Location ids (comma-separated)." },
    company: { type: "string", description: "Current company ids (comma-separated)." },
    "past-company": { type: "string", description: "Past company ids (comma-separated)." },
    school: { type: "string", description: "School ids (comma-separated)." },
    "network-distance": { type: "string", description: "Network distance, 1-3 (comma-separated)." },
    "connections-of": { type: "string", description: "Member id whose connections to search." },
    "followers-of": { type: "string", description: "Member id whose followers to search." },
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
    url: { type: "string", description: "Pasted LinkedIn search URL (mutually exclusive with filters)." },
    ...FILTER_FLAGS,
    industry: { type: "string", description: "Industry ids (comma-separated)." },
    location: { type: "string", description: "Location ids (comma-separated)." },
    "network-distance": { type: "string", description: "Network distance, 1-3 (comma-separated)." },
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
    url: { type: "string", description: "Pasted LinkedIn search URL (mutually exclusive with filters)." },
    ...FILTER_FLAGS,
    "sort-by": { type: "string", description: "Sort order (e.g. relevance, date)." },
    "date-posted": { type: "string", description: "Date-posted window (e.g. past-day, past-week)." },
    "content-type": { type: "string", description: "Content type (e.g. videos, images, jobs)." },
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
    url: { type: "string", description: "Pasted LinkedIn search URL (mutually exclusive with filters)." },
    ...FILTER_FLAGS,
    location: { type: "string", description: "Location ids (comma-separated)." },
    industry: { type: "string", description: "Industry ids (comma-separated)." },
    seniority: { type: "string", description: "Seniority ids (comma-separated)." },
    function: { type: "string", description: "Job function ids (comma-separated)." },
    "job-type": { type: "string", description: "Job type ids, e.g. F,P (comma-separated)." },
    company: { type: "string", description: "Company ids (comma-separated)." },
    "sort-by": { type: "string", description: "Sort order (e.g. relevance, recent)." },
    region: { type: "string", description: "Region id." },
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
