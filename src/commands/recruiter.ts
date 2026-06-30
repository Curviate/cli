/**
 * `curviate recruiter` — LinkedIn Recruiter operations (tier: recruiter).
 *
 * Subcommands:
 *   recruiter sync [--cursor] [--limit]                                          — sync messages (read)
 *   recruiter message new --to <id> "<text>" [--attach <f>…] [--voice <f>] [--video <f>] — start chat (write, multipart)
 *   recruiter profile <identifier>                                               — get profile (read, resolveIdentifier)
 *   recruiter search people [--keywords <k>] [--all] [--limit] [--cursor]       — search people (POST)
 *   recruiter search parameters --type <t>                                       — get filter parameters (read)
 *   recruiter projects [--all] [--limit] [--cursor]                              — list projects (read)
 *   recruiter project <project_id>                                               — get project (read, verbatim id)
 *   recruiter add-candidate <user_id> --hiring-project-id <id> [--stage <s>]    — add candidate (write)
 *   recruiter add-applicant <user_id> --hiring-project-id <id> [--stage <s>]    — add applicant (write)
 *   recruiter reject-applicant <user_id> --hiring-project-id <id> --reason <r>  — reject applicant (write)
 *   recruiter jobs [--all] [--limit] [--cursor]                                  — list jobs (read)
 *   recruiter job create [--body-file <path> | --body -] [--job-title <t>] [--description <d>] [--employment-type <e>] — create job draft (write; JSON body + scalar flags)
 *   recruiter job publish <job_id> [--mode <m>]                                  — publish job (write)
 *   recruiter job checkpoint <job_id> --input <v>                                — solve checkpoint (write)
 *   recruiter job applicants <job_id>                                             — list applicants (read)
 *   recruiter applicant <applicant_id>                                            — get applicant (read, verbatim id)
 *   recruiter applicant resume <applicant_id> -o <file>                          — download resume (binary)
 *
 * All subcommands are account-scoped.
 * Tier-gate: CLI never pre-checks — SDK call goes out; TIER_NOT_ACTIVE / LINKEDIN_FEATURE_NOT_SUBSCRIBED → exit 5.
 * Identifier resolution: applied to `profile <identifier>` only.
 * user_id / job_id / applicant_id / project_id pass verbatim.
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
import { writeBinaryOutput, BinaryOutputError } from "../lib/binary.js";
import {
  assembleFilters,
  splitCsv,
  DEFAULT_FILTER_READERS,
  type FilterReaders,
} from "../lib/search-filters.js";
import { readFile } from "node:fs/promises";
import type { CurviateError } from "@curviate/sdk";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type RecruiterFlags = {
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
  // search-people filter escape hatch + curated named flags
  // (note: "employment-type" is declared below in the job-create group and is
  //  reused by `recruiter search people` — it maps to the same API field.)
  filters?: string;
  "filters-file"?: string;
  locale?: string;
  function?: string;
  "profile-language"?: string;
  identifier?: string;
  userId?: string;
  projectId?: string;
  jobId?: string;
  applicantId?: string;
  "hiring-project-id"?: string;
  stage?: string;
  reason?: string;
  mode?: string;
  input?: string;
  output?: string;
  // job create
  body?: string;
  "body-file"?: string;
  "job-title"?: string;
  description?: string;
  "employment-type"?: string;
};

type OutputStreams = {
  stdout: { write: (s: string) => void };
  stderr: { write: (s: string) => void };
};

type MinimalClient = {
  account: (id: string) => {
    recruiter: {
      syncMessages: (params: Record<string, unknown>) => Promise<unknown>;
      startChat: (body: Record<string, unknown>) => Promise<unknown>;
      getProfile: (identifier: string, params?: Record<string, unknown>) => Promise<unknown>;
      searchPeople: (body: Record<string, unknown>, params?: Record<string, unknown>) => Promise<unknown>;
      getParameters: (params: Record<string, unknown>) => Promise<unknown>;
      listProjects: (params?: Record<string, unknown>) => Promise<unknown>;
      getProject: (projectId: string) => Promise<unknown>;
      addCandidate: (userId: string, body: Record<string, unknown>) => Promise<unknown>;
      addApplicant: (userId: string, body: Record<string, unknown>) => Promise<unknown>;
      rejectApplicant: (userId: string, body: Record<string, unknown>) => Promise<unknown>;
      listJobs: (params?: Record<string, unknown>) => Promise<unknown>;
      createJob: (body: Record<string, unknown>) => Promise<unknown>;
      publishJob: (jobId: string, body: Record<string, unknown>) => Promise<unknown>;
      solveJobCheckpoint: (jobId: string, body: Record<string, unknown>) => Promise<unknown>;
      listApplicants: (jobId: string, params?: Record<string, unknown>) => Promise<unknown>;
      getApplicant: (applicantId: string) => Promise<unknown>;
      downloadResume: (applicantId: string) => Promise<ArrayBuffer>;
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

function resolveOutputOpts(flags: RecruiterFlags) {
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

/** Read all of stdin as a UTF-8 string. Used for `--body -`. */
async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string));
  }
  return Buffer.concat(chunks).toString("utf8");
}

/**
 * Reader injection point for `recruiter job create`, so the JSON-body source
 * (file / stdin) can be exercised in tests without real process.stdin I/O.
 */
export type JobCreateReaders = {
  readFile: (path: string) => Promise<string>;
  readStdin: () => Promise<string>;
};

const DEFAULT_JOB_CREATE_READERS: JobCreateReaders = {
  readFile: (path) => readFile(path, "utf8"),
  readStdin,
};

/**
 * Assemble the `recruiter job create` body from a JSON source (--body-file /
 * --body -) plus top-level scalar convenience flags that merge OVER the JSON.
 *
 * Returns the assembled body, or an `error` string when the JSON source is
 * present but does not parse / is not a JSON object. The caller handles the
 * error (exit 2). Required-field validation is left to the API.
 */
async function assembleJobCreateBody(
  flags: RecruiterFlags,
  readers: JobCreateReaders,
): Promise<{ body: Record<string, unknown> } | { error: string }> {
  let base: Record<string, unknown> = {};

  // 1. JSON source: --body-file <path>, or --body - (stdin). --body-file wins
  //    if both are given.
  let raw: string | undefined;
  let source: string | undefined;
  if (flags["body-file"] !== undefined) {
    source = `--body-file ${flags["body-file"]}`;
    try {
      raw = await readers.readFile(flags["body-file"]);
    } catch {
      return { error: `cannot read ${source}` };
    }
  } else if (flags.body === "-") {
    source = "--body - (stdin)";
    raw = await readers.readStdin();
  } else if (flags.body !== undefined) {
    return { error: "--body only accepts '-' (read JSON from stdin); use --body-file <path> for a file." };
  }

  if (raw !== undefined) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { error: `${source} is not valid JSON` };
    }
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { error: `${source} must be a JSON object` };
    }
    base = parsed as Record<string, unknown>;
  }

  // 2. Top-level scalar convenience flags merge OVER the JSON. `job_title` is a
  //    { id?, text? } object in the API; --job-title supplies free-form text.
  if (flags["job-title"] !== undefined) base["job_title"] = { text: flags["job-title"] };
  if (flags.description !== undefined) base["description"] = flags.description;
  if (flags["employment-type"] !== undefined) base["employment_type"] = flags["employment-type"];

  return { body: base };
}

// ---------------------------------------------------------------------------
// Exported run functions (testable without citty)
// ---------------------------------------------------------------------------

/**
 * Run `recruiter sync`.
 * Read command — rejects --preview.
 */
export async function runRecruiterSync(
  client: MinimalClient,
  flags: RecruiterFlags,
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
    const result = await ns.recruiter.syncMessages(params);
    renderSuccess(result, outOpts, out);
  } catch (err: unknown) {
    await handleSdkError(err, outOpts, out);
  }
}

/**
 * Run `recruiter message new --to <id> "<text>" [--attach <f>…] [--voice <f>] [--video <f>]`.
 * Write command — supports --preview. Multipart when files present.
 */
export async function runRecruiterMessageNew(
  client: MinimalClient,
  flags: RecruiterFlags,
  out: OutputStreams,
): Promise<void> {
  const accountId = requireAccount(flags.account, out);
  const to = flags.to ?? "";
  const text = flags.text ?? "";
  const attachPaths = normalizeAttachPaths(flags.attach);
  const voicePath = flags.voice;
  const videoPath = flags.video;

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

  // Recruiter chats use `attendee_ids` (singular) — classic + SN chats use the
  // plural `attendees_ids`. The field name diverges by surface.
  const body: Record<string, unknown> = {
    attendee_ids: [to],
    text,
  };

  if (flags.preview) {
    const preview = buildPreviewOutput({
      method: "recruiter.startChat",
      args: { attendee_ids: [to] },
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
    const result = await ns.recruiter.startChat(body);
    renderSuccess(result, outOpts, out);
  } catch (err: unknown) {
    await handleSdkError(err, outOpts, out);
  }
}

/**
 * Run `recruiter profile <identifier>`.
 * Read command — rejects --preview. Identifier resolved via resolveIdentifier.
 */
export async function runRecruiterProfile(
  client: MinimalClient,
  flags: RecruiterFlags,
  out: OutputStreams,
): Promise<void> {
  rejectPreviewOnRead(flags.preview, out);

  const accountId = requireAccount(flags.account, out);
  const rawId = flags.identifier ?? "";
  const resolvedId = resolveIdentifier(rawId);
  const ns = client.account(accountId);
  const outOpts = resolveOutputOpts(flags);

  try {
    const result = await ns.recruiter.getProfile(resolvedId, {});
    renderSuccess(result, outOpts, out);
  } catch (err: unknown) {
    await handleSdkError(err, outOpts, out);
  }
}

/**
 * Run `recruiter search people [filters…]`.
 * POST search — read-classified, rejects --preview.
 * Supports --all / --limit / --cursor pagination.
 */
export async function runRecruiterSearchPeople(
  client: MinimalClient,
  flags: RecruiterFlags,
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
  // The rich Recruiter filters are mostly nested objects, reachable via --filters.
  const assembled = await assembleFilters(flags, readers);
  if ("error" in assembled) {
    out.stderr.write(`error: ${assembled.error}\n`);
    process.exit(2);
  }
  const body = assembled.body;
  if (flags.keywords) body["keywords"] = flags.keywords;
  if (flags.locale) body["locale"] = flags.locale;
  if (flags["employment-type"]) body["employment_type"] = splitCsv(flags["employment-type"]);
  if (flags.function) body["function"] = splitCsv(flags.function);
  if (flags["profile-language"]) body["profile_language"] = splitCsv(flags["profile-language"]);

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
        return ns.recruiter.searchPeople(mergedBody, callParams) as Promise<{ items?: unknown[]; cursor?: string | null }>;
      };
      for await (const item of streamAll(fn, params, {
        maxPages,
        onTruncated: (n) => out.stderr.write(`Streaming truncated at ${n} page(s). Use --all --max-pages or --cursor for manual paging.\n`),
      })) {
        out.stdout.write(JSON.stringify(item) + "\n");
      }
    } else {
      const result = await ns.recruiter.searchPeople(body, Object.keys(params).length > 0 ? params : undefined);
      renderSuccess(result, outOpts, out);
    }
  } catch (err: unknown) {
    await handleSdkError(err, outOpts, out);
  }
}

/**
 * Run `recruiter search parameters --type <t>`.
 * Read command — rejects --preview.
 */
export async function runRecruiterGetParameters(
  client: MinimalClient,
  flags: RecruiterFlags,
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
    const result = await ns.recruiter.getParameters(params);
    renderSuccess(result, outOpts, out);
  } catch (err: unknown) {
    await handleSdkError(err, outOpts, out);
  }
}

/**
 * Run `recruiter projects [--all] [--limit] [--cursor]`.
 * Read command — rejects --preview. Paginated.
 */
export async function runRecruiterListProjects(
  client: MinimalClient,
  flags: RecruiterFlags,
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
      const fn = (p: Record<string, unknown>) => ns.recruiter.listProjects(p) as Promise<{ items?: unknown[]; cursor?: string | null }>;
      for await (const item of streamAll(fn, params, {
        maxPages,
        onTruncated: (n) => out.stderr.write(`Streaming truncated at ${n} page(s). Use --all --max-pages or --cursor for manual paging.\n`),
      })) {
        out.stdout.write(JSON.stringify(item) + "\n");
      }
    } else {
      const result = await ns.recruiter.listProjects(Object.keys(params).length > 0 ? params : undefined);
      renderSuccess(result, outOpts, out);
    }
  } catch (err: unknown) {
    await handleSdkError(err, outOpts, out);
  }
}

/**
 * Run `recruiter project <project_id>`.
 * Read command — rejects --preview. project_id passes verbatim.
 */
export async function runRecruiterGetProject(
  client: MinimalClient,
  flags: RecruiterFlags,
  out: OutputStreams,
): Promise<void> {
  rejectPreviewOnRead(flags.preview, out);

  const accountId = requireAccount(flags.account, out);
  const projectId = flags.projectId ?? "";
  const ns = client.account(accountId);
  const outOpts = resolveOutputOpts(flags);

  try {
    const result = await ns.recruiter.getProject(projectId);
    renderSuccess(result, outOpts, out);
  } catch (err: unknown) {
    await handleSdkError(err, outOpts, out);
  }
}

/**
 * Run `recruiter add-candidate <user_id> --hiring-project-id <id> [--stage <s>]`.
 * Write command — supports --preview. user_id passes verbatim.
 */
export async function runRecruiterAddCandidate(
  client: MinimalClient,
  flags: RecruiterFlags,
  out: OutputStreams,
): Promise<void> {
  const accountId = requireAccount(flags.account, out);
  const userId = flags.userId ?? "";
  const outOpts = resolveOutputOpts(flags);

  const body: Record<string, unknown> = {};
  if (flags["hiring-project-id"]) body["hiring_project_id"] = flags["hiring-project-id"];
  if (flags.stage) body["stage"] = flags.stage;

  if (flags.preview) {
    const preview = buildPreviewOutput({
      method: "recruiter.addCandidate",
      args: { user_id: userId },
      body,
      account: accountId,
    });
    out.stdout.write(JSON.stringify(preview) + "\n");
    return;
  }

  const ns = client.account(accountId);

  try {
    const result = await ns.recruiter.addCandidate(userId, body);
    renderSuccess(result, outOpts, out);
  } catch (err: unknown) {
    await handleSdkError(err, outOpts, out);
  }
}

/**
 * Run `recruiter add-applicant <user_id> --hiring-project-id <id> [--stage <s>]`.
 * Write command — supports --preview. user_id passes verbatim.
 */
export async function runRecruiterAddApplicant(
  client: MinimalClient,
  flags: RecruiterFlags,
  out: OutputStreams,
): Promise<void> {
  const accountId = requireAccount(flags.account, out);
  const userId = flags.userId ?? "";
  const outOpts = resolveOutputOpts(flags);

  const body: Record<string, unknown> = {};
  if (flags["hiring-project-id"]) body["hiring_project_id"] = flags["hiring-project-id"];
  if (flags.stage) body["stage"] = flags.stage;

  if (flags.preview) {
    const preview = buildPreviewOutput({
      method: "recruiter.addApplicant",
      args: { user_id: userId },
      body,
      account: accountId,
    });
    out.stdout.write(JSON.stringify(preview) + "\n");
    return;
  }

  const ns = client.account(accountId);

  try {
    const result = await ns.recruiter.addApplicant(userId, body);
    renderSuccess(result, outOpts, out);
  } catch (err: unknown) {
    await handleSdkError(err, outOpts, out);
  }
}

/**
 * Run `recruiter reject-applicant <user_id> --hiring-project-id <id> --reason <r>`.
 * Write command — supports --preview. user_id passes verbatim.
 */
export async function runRecruiterRejectApplicant(
  client: MinimalClient,
  flags: RecruiterFlags,
  out: OutputStreams,
): Promise<void> {
  const accountId = requireAccount(flags.account, out);
  const userId = flags.userId ?? "";
  const outOpts = resolveOutputOpts(flags);

  const body: Record<string, unknown> = {};
  if (flags["hiring-project-id"]) body["hiring_project_id"] = flags["hiring-project-id"];
  if (flags.reason) body["reason"] = flags.reason;

  if (flags.preview) {
    const preview = buildPreviewOutput({
      method: "recruiter.rejectApplicant",
      args: { user_id: userId },
      body,
      account: accountId,
    });
    out.stdout.write(JSON.stringify(preview) + "\n");
    return;
  }

  const ns = client.account(accountId);

  try {
    const result = await ns.recruiter.rejectApplicant(userId, body);
    renderSuccess(result, outOpts, out);
  } catch (err: unknown) {
    await handleSdkError(err, outOpts, out);
  }
}

/**
 * Run `recruiter jobs [--all] [--limit] [--cursor]`.
 * Read command — rejects --preview. Paginated.
 */
export async function runRecruiterListJobs(
  client: MinimalClient,
  flags: RecruiterFlags,
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
      const fn = (p: Record<string, unknown>) => ns.recruiter.listJobs(p) as Promise<{ items?: unknown[]; cursor?: string | null }>;
      for await (const item of streamAll(fn, params, {
        maxPages,
        onTruncated: (n) => out.stderr.write(`Streaming truncated at ${n} page(s). Use --all --max-pages or --cursor for manual paging.\n`),
      })) {
        out.stdout.write(JSON.stringify(item) + "\n");
      }
    } else {
      const result = await ns.recruiter.listJobs(Object.keys(params).length > 0 ? params : undefined);
      renderSuccess(result, outOpts, out);
    }
  } catch (err: unknown) {
    await handleSdkError(err, outOpts, out);
  }
}

/**
 * Run `recruiter job create [--body-file <path> | --body -] [scalar flags…]`.
 * Write command — supports --preview.
 *
 * The job-create body is deeply nested (job_title, company, workplace, location,
 * description, recruiter — several of which are objects). Rather than enumerate
 * a flag per nested field, the body is supplied as JSON via --body-file <path>
 * or --body - (stdin), with top-level scalar convenience flags (--job-title,
 * --description, --employment-type) merging OVER the JSON.
 *
 * The CLI validates only that the JSON parses (exit 2 on bad JSON); required
 * fields are validated by the API, whose 400 is surfaced cleanly.
 */
export async function runRecruiterCreateJob(
  client: MinimalClient,
  flags: RecruiterFlags,
  out: OutputStreams,
  readers: JobCreateReaders = DEFAULT_JOB_CREATE_READERS,
): Promise<void> {
  const accountId = requireAccount(flags.account, out);
  const outOpts = resolveOutputOpts(flags);

  const assembled = await assembleJobCreateBody(flags, readers);
  if ("error" in assembled) {
    out.stderr.write(`error: ${assembled.error}\n`);
    process.exit(2);
  }
  const body = assembled.body;

  if (flags.preview) {
    const preview = buildPreviewOutput({
      method: "recruiter.createJob",
      args: {},
      body,
      account: accountId,
    });
    out.stdout.write(JSON.stringify(preview) + "\n");
    return;
  }

  const ns = client.account(accountId);

  try {
    const result = await ns.recruiter.createJob(body);
    renderSuccess(result, outOpts, out);
  } catch (err: unknown) {
    await handleSdkError(err, outOpts, out);
  }
}

/**
 * Run `recruiter job publish <job_id> [--mode <m>]`.
 * Write command — supports --preview. job_id passes verbatim.
 */
export async function runRecruiterPublishJob(
  client: MinimalClient,
  flags: RecruiterFlags,
  out: OutputStreams,
): Promise<void> {
  const accountId = requireAccount(flags.account, out);
  const jobId = flags.jobId ?? "";
  const outOpts = resolveOutputOpts(flags);

  const body: Record<string, unknown> = {};
  if (flags.mode) body["mode"] = flags.mode;

  if (flags.preview) {
    const preview = buildPreviewOutput({
      method: "recruiter.publishJob",
      args: { job_id: jobId },
      body,
      account: accountId,
    });
    out.stdout.write(JSON.stringify(preview) + "\n");
    return;
  }

  const ns = client.account(accountId);

  try {
    const result = await ns.recruiter.publishJob(jobId, body);
    renderSuccess(result, outOpts, out);
  } catch (err: unknown) {
    await handleSdkError(err, outOpts, out);
  }
}

/**
 * Run `recruiter job checkpoint <job_id> --input <v>`.
 * Write command — supports --preview. job_id passes verbatim.
 */
export async function runRecruiterJobCheckpoint(
  client: MinimalClient,
  flags: RecruiterFlags,
  out: OutputStreams,
): Promise<void> {
  const accountId = requireAccount(flags.account, out);
  const jobId = flags.jobId ?? "";
  const outOpts = resolveOutputOpts(flags);

  const body: Record<string, unknown> = {};
  if (flags.input) body["input"] = flags.input;

  if (flags.preview) {
    const preview = buildPreviewOutput({
      method: "recruiter.solveJobCheckpoint",
      args: { job_id: jobId },
      body,
      account: accountId,
    });
    out.stdout.write(JSON.stringify(preview) + "\n");
    return;
  }

  const ns = client.account(accountId);

  try {
    const result = await ns.recruiter.solveJobCheckpoint(jobId, body);
    renderSuccess(result, outOpts, out);
  } catch (err: unknown) {
    await handleSdkError(err, outOpts, out);
  }
}

/**
 * Run `recruiter job applicants <job_id>`.
 * Read command — rejects --preview. job_id passes verbatim.
 */
export async function runRecruiterListApplicants(
  client: MinimalClient,
  flags: RecruiterFlags,
  out: OutputStreams,
): Promise<void> {
  rejectPreviewOnRead(flags.preview, out);

  const accountId = requireAccount(flags.account, out);
  const jobId = flags.jobId ?? "";
  const ns = client.account(accountId);
  const outOpts = resolveOutputOpts(flags);

  const params: Record<string, unknown> = {};
  if (flags.limit) params["limit"] = parseInt(flags.limit, 10);
  if (flags.cursor) params["cursor"] = flags.cursor;

  try {
    const result = await ns.recruiter.listApplicants(jobId, Object.keys(params).length > 0 ? params : undefined);
    renderSuccess(result, outOpts, out);
  } catch (err: unknown) {
    await handleSdkError(err, outOpts, out);
  }
}

/**
 * Run `recruiter applicant <applicant_id>`.
 * Read command — rejects --preview. applicant_id passes verbatim.
 */
export async function runRecruiterGetApplicant(
  client: MinimalClient,
  flags: RecruiterFlags,
  out: OutputStreams,
): Promise<void> {
  rejectPreviewOnRead(flags.preview, out);

  const accountId = requireAccount(flags.account, out);
  const applicantId = flags.applicantId ?? "";
  const ns = client.account(accountId);
  const outOpts = resolveOutputOpts(flags);

  try {
    const result = await ns.recruiter.getApplicant(applicantId);
    renderSuccess(result, outOpts, out);
  } catch (err: unknown) {
    await handleSdkError(err, outOpts, out);
  }
}

/**
 * Run `recruiter applicant resume <applicant_id> -o <file>`.
 * Read command — binary response. Rejects --preview.
 * @param isTTY — injectable for tests.
 */
export async function runRecruiterDownloadResume(
  client: MinimalClient,
  flags: RecruiterFlags,
  out: OutputStreams,
  isTTY: boolean,
): Promise<void> {
  rejectPreviewOnRead(flags.preview, out);

  const accountId = requireAccount(flags.account, out);
  const applicantId = flags.applicantId ?? "";
  const ns = client.account(accountId);

  try {
    const data = await ns.recruiter.downloadResume(applicantId);
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

// ---------------------------------------------------------------------------
// Citty command definitions
// ---------------------------------------------------------------------------

const recruiterSyncCommand = defineCommand({
  meta: { name: "sync", description: "Sync Recruiter message history for an account." },
  args: { ...GLOBAL_FLAGS },
  async run({ args }) {
    const flags = args as RecruiterFlags;
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
    await runRecruiterSync(client as unknown as MinimalClient, { ...flags, account: flags.account ?? cfg.account }, out);
  },
});

const recruiterMessageNewCommand = defineCommand({
  meta: { name: "new", description: "Start a new Recruiter chat (InMail)." },
  args: {
    ...GLOBAL_FLAGS,
    to: { type: "string", description: "Recipient provider ID.", required: true },
    text: { type: "positional", description: "Message text." },
    attach: { type: "string", description: "File to attach (repeatable)." },
    voice: { type: "string", description: "Voice message file." },
    video: { type: "string", description: "Video message file." },
  },
  async run({ args }) {
    const flags = args as RecruiterFlags;
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
    await runRecruiterMessageNew(client as unknown as MinimalClient, { ...flags, account: flags.account ?? cfg.account }, out);
  },
});

const recruiterMessageCommand = defineCommand({
  meta: { name: "message", description: "Recruiter messaging operations." },
  args: { ...GLOBAL_FLAGS },
  subCommands: {
    new: recruiterMessageNewCommand,
  },
  async run() {
    process.stderr.write("Usage: curviate recruiter message new --to <id> \"<text>\" [--attach <file>…]\n");
  },
});

const recruiterProfileCommand = defineCommand({
  meta: { name: "profile", description: "Get a Recruiter enriched member profile." },
  args: {
    ...GLOBAL_FLAGS,
    identifier: { type: "positional", description: "LinkedIn URL, slug, or native id." },
  },
  async run({ args }) {
    const flags = args as RecruiterFlags;
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
    await runRecruiterProfile(client as unknown as MinimalClient, { ...flags, account: flags.account ?? cfg.account }, out);
  },
});

const recruiterSearchPeopleCommand = defineCommand({
  meta: { name: "people", description: "Search Recruiter member profiles." },
  args: {
    ...GLOBAL_FLAGS,
    keywords: { type: "string", description: "Keyword search string." },
    filters: { type: "string", description: "Filter body as a JSON object (escape hatch for the full filter surface); '-' reads JSON from stdin." },
    "filters-file": { type: "string", description: "Path to a JSON file with the filter body." },
    locale: { type: "string", description: "Result locale, e.g. en." },
    "employment-type": { type: "string", description: "Employment type ids (comma-separated)." },
    function: { type: "string", description: "Job function ids (comma-separated)." },
    "profile-language": { type: "string", description: "Profile language codes (comma-separated)." },
  },
  async run({ args }) {
    const flags = args as RecruiterFlags;
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
    await runRecruiterSearchPeople(client as unknown as MinimalClient, { ...flags, account: flags.account ?? cfg.account }, out);
  },
});

const recruiterSearchParametersCommand = defineCommand({
  meta: { name: "parameters", description: "Resolve Recruiter filter parameter IDs." },
  args: {
    ...GLOBAL_FLAGS,
    type: { type: "string", description: "Parameter type (e.g. LOCATION, INDUSTRY, TITLE).", required: true },
    keywords: { type: "string", description: "Human term to resolve (e.g. Berlin)." },
  },
  async run({ args }) {
    const flags = args as RecruiterFlags;
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
    await runRecruiterGetParameters(client as unknown as MinimalClient, { ...flags, account: flags.account ?? cfg.account }, out);
  },
});

const recruiterSearchCommand = defineCommand({
  meta: { name: "search", description: "Recruiter search operations." },
  args: { ...GLOBAL_FLAGS },
  subCommands: {
    people: recruiterSearchPeopleCommand,
    parameters: recruiterSearchParametersCommand,
  },
  async run() {
    process.stderr.write(
      "Usage: curviate recruiter search people [--keywords <k>]\n" +
      "       curviate recruiter search parameters --type <t>\n",
    );
  },
});

const recruiterProjectsCommand = defineCommand({
  meta: { name: "projects", description: "List Recruiter hiring projects." },
  args: { ...GLOBAL_FLAGS },
  async run({ args }) {
    const flags = args as RecruiterFlags;
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
    await runRecruiterListProjects(client as unknown as MinimalClient, { ...flags, account: flags.account ?? cfg.account }, out);
  },
});

const recruiterProjectCommand = defineCommand({
  meta: { name: "project", description: "Get a Recruiter hiring project by ID." },
  args: {
    ...GLOBAL_FLAGS,
    projectId: { type: "positional", description: "Recruiter project ID." },
  },
  async run({ args }) {
    const flags = args as RecruiterFlags;
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
    await runRecruiterGetProject(client as unknown as MinimalClient, { ...flags, account: flags.account ?? cfg.account }, out);
  },
});

const recruiterAddCandidateCommand = defineCommand({
  meta: { name: "add-candidate", description: "Add a member as a candidate in a hiring project." },
  args: {
    ...GLOBAL_FLAGS,
    userId: { type: "positional", description: "Member ID (AEM… format)." },
    "hiring-project-id": { type: "string", description: "Recruiter hiring project ID.", required: true },
    stage: { type: "string", description: "Pipeline stage (UNCONTACTED, CONTACTED, REPLIED)." },
  },
  async run({ args }) {
    const flags = args as RecruiterFlags;
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
    await runRecruiterAddCandidate(client as unknown as MinimalClient, { ...flags, account: flags.account ?? cfg.account }, out);
  },
});

const recruiterAddApplicantCommand = defineCommand({
  meta: { name: "add-applicant", description: "Add a member as an applicant in a hiring project." },
  args: {
    ...GLOBAL_FLAGS,
    userId: { type: "positional", description: "Member ID (AEM… format)." },
    "hiring-project-id": { type: "string", description: "Recruiter hiring project ID.", required: true },
    stage: { type: "string", description: "Pipeline stage (UNCONTACTED, CONTACTED, REPLIED)." },
  },
  async run({ args }) {
    const flags = args as RecruiterFlags;
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
    await runRecruiterAddApplicant(client as unknown as MinimalClient, { ...flags, account: flags.account ?? cfg.account }, out);
  },
});

const recruiterRejectApplicantCommand = defineCommand({
  meta: { name: "reject-applicant", description: "Reject an applicant from a hiring project." },
  args: {
    ...GLOBAL_FLAGS,
    userId: { type: "positional", description: "Member ID (AEM… format)." },
    "hiring-project-id": { type: "string", description: "Recruiter hiring project ID.", required: true },
    reason: {
      type: "string",
      description: "Rejection reason (NOT_MEET_BASIC_QUALIFICATIONS, NOT_IN_DESIRED_LOCATION, MORE_QUALIFIED_CANDIDATES, WITHDREW_APPLICATION, NOT_CONSIDERED_OR_REASON_NOT_SPECIFIED).",
      required: true,
    },
  },
  async run({ args }) {
    const flags = args as RecruiterFlags;
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
    await runRecruiterRejectApplicant(client as unknown as MinimalClient, { ...flags, account: flags.account ?? cfg.account }, out);
  },
});

const recruiterJobsCommand = defineCommand({
  meta: { name: "jobs", description: "List Recruiter job postings." },
  args: { ...GLOBAL_FLAGS },
  async run({ args }) {
    const flags = args as RecruiterFlags;
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
    await runRecruiterListJobs(client as unknown as MinimalClient, { ...flags, account: flags.account ?? cfg.account }, out);
  },
});

const recruiterJobCreateCommand = defineCommand({
  meta: { name: "create", description: "Create a Recruiter job posting draft." },
  args: {
    ...GLOBAL_FLAGS,
    "body-file": { type: "string", description: "Path to a JSON file with the full job-create body." },
    body: { type: "string", description: "Read the JSON job-create body from stdin (pass '-')." },
    "job-title": { type: "string", description: "Job title text (merged over the JSON as job_title.text)." },
    description: { type: "string", description: "Job description (merged over the JSON)." },
    "employment-type": { type: "string", description: "Employment type, e.g. FULL_TIME (merged over the JSON)." },
  },
  async run({ args }) {
    const flags = args as RecruiterFlags;
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
    await runRecruiterCreateJob(client as unknown as MinimalClient, { ...flags, account: flags.account ?? cfg.account }, out);
  },
});

const recruiterJobPublishCommand = defineCommand({
  meta: { name: "publish", description: "Publish a Recruiter job posting draft." },
  args: {
    ...GLOBAL_FLAGS,
    jobId: { type: "positional", description: "Job posting ID." },
    mode: { type: "string", description: "Publish mode: FREE (default), PROMOTED, or PROMOTED_PLUS." },
  },
  async run({ args }) {
    const flags = args as RecruiterFlags;
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
    await runRecruiterPublishJob(client as unknown as MinimalClient, { ...flags, account: flags.account ?? cfg.account }, out);
  },
});

const recruiterJobCheckpointCommand = defineCommand({
  meta: { name: "checkpoint", description: "Solve a job posting publish verification checkpoint." },
  args: {
    ...GLOBAL_FLAGS,
    jobId: { type: "positional", description: "Job posting ID." },
    input: { type: "string", description: "Verification value (OTP or email confirmation).", required: true },
  },
  async run({ args }) {
    const flags = args as RecruiterFlags;
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
    await runRecruiterJobCheckpoint(client as unknown as MinimalClient, { ...flags, account: flags.account ?? cfg.account }, out);
  },
});

const recruiterJobApplicantsCommand = defineCommand({
  meta: { name: "applicants", description: "List applicants for a Recruiter job posting." },
  args: {
    ...GLOBAL_FLAGS,
    jobId: { type: "positional", description: "Job posting ID." },
  },
  async run({ args }) {
    const flags = args as RecruiterFlags;
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
    await runRecruiterListApplicants(client as unknown as MinimalClient, { ...flags, account: flags.account ?? cfg.account }, out);
  },
});

const recruiterJobCommand = defineCommand({
  meta: { name: "job", description: "Recruiter job posting operations." },
  args: { ...GLOBAL_FLAGS },
  subCommands: {
    create: recruiterJobCreateCommand,
    publish: recruiterJobPublishCommand,
    checkpoint: recruiterJobCheckpointCommand,
    applicants: recruiterJobApplicantsCommand,
  },
  async run() {
    process.stderr.write(
      "Usage: curviate recruiter job create [flags…]\n" +
      "       curviate recruiter job publish <job_id> [--mode <m>]\n" +
      "       curviate recruiter job checkpoint <job_id> --input <v>\n" +
      "       curviate recruiter job applicants <job_id>\n",
    );
  },
});

const recruiterApplicantResumeCommand = defineCommand({
  meta: { name: "resume", description: "Download a job applicant's resume." },
  args: {
    ...GLOBAL_FLAGS,
    applicantId: { type: "positional", description: "Applicant ID." },
    output: { type: "string", alias: "o", description: "Path to write the resume file." },
  },
  async run({ args }) {
    const flags = args as RecruiterFlags;
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
    await runRecruiterDownloadResume(
      client as unknown as MinimalClient,
      { ...flags, account: flags.account ?? cfg.account },
      out,
      process.stdout.isTTY ?? false,
    );
  },
});

const recruiterApplicantCommand = defineCommand({
  meta: { name: "applicant", description: "Recruiter job applicant operations." },
  args: {
    ...GLOBAL_FLAGS,
    applicantId: { type: "positional", description: "Applicant ID.", required: false },
  },
  subCommands: {
    resume: recruiterApplicantResumeCommand,
  },
  async run({ args }) {
    const flags = args as RecruiterFlags;
    if (!flags.applicantId) {
      process.stderr.write(
        "Usage: curviate recruiter applicant <applicant_id>\n" +
        "       curviate recruiter applicant resume <applicant_id> -o <file>\n",
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
    await runRecruiterGetApplicant(client as unknown as MinimalClient, { ...flags, account: flags.account ?? cfg.account }, out);
  },
});

export const recruiterCommand = defineCommand({
  meta: { name: "recruiter", description: "LinkedIn Recruiter operations (requires the Recruiter add-on)." },
  args: { ...GLOBAL_FLAGS },
  subCommands: {
    sync: recruiterSyncCommand,
    message: recruiterMessageCommand,
    profile: recruiterProfileCommand,
    search: recruiterSearchCommand,
    projects: recruiterProjectsCommand,
    project: recruiterProjectCommand,
    "add-candidate": recruiterAddCandidateCommand,
    "add-applicant": recruiterAddApplicantCommand,
    "reject-applicant": recruiterRejectApplicantCommand,
    jobs: recruiterJobsCommand,
    job: recruiterJobCommand,
    applicant: recruiterApplicantCommand,
  },
  async run() {
    process.stderr.write(
      "Usage: curviate recruiter sync\n" +
      "       curviate recruiter message new --to <id> \"<text>\"\n" +
      "       curviate recruiter profile <identifier>\n" +
      "       curviate recruiter search people [--keywords <k>]\n" +
      "       curviate recruiter search parameters --type <t>\n" +
      "       curviate recruiter projects\n" +
      "       curviate recruiter project <project_id>\n" +
      "       curviate recruiter add-candidate <user_id> --hiring-project-id <id>\n" +
      "       curviate recruiter add-applicant <user_id> --hiring-project-id <id>\n" +
      "       curviate recruiter reject-applicant <user_id> --hiring-project-id <id> --reason <r>\n" +
      "       curviate recruiter jobs\n" +
      "       curviate recruiter job create [flags…]\n" +
      "       curviate recruiter job publish <job_id> [--mode <m>]\n" +
      "       curviate recruiter job checkpoint <job_id> --input <v>\n" +
      "       curviate recruiter job applicants <job_id>\n" +
      "       curviate recruiter applicant <applicant_id>\n" +
      "       curviate recruiter applicant resume <applicant_id> -o <file>\n",
    );
  },
});
