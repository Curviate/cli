/**
 * `curviate post` — LinkedIn post operations.
 *
 * Subcommands:
 *   post list                                              — list posts (paginated)
 *   post get <post_id>                                    — get a single post (read)
 *   post create "<text>" [--attach <file>…]              — create post (write, JSON only in v2)
 *   post comment <post_id> "<text>" [--attach <file>]    — comment on post (write, multipart)
 *   post comments <post_id>                               — list comments (paginated, read)
 *   post react <post_id> --reaction <r>                  — react to post (write, body field: reaction)
 *   post reactions <post_id>                             — list reactions (paginated, read)
 *
 * post_id passes through verbatim — NOT resolved via resolveIdentifier.
 * All subcommands are account-scoped.
 *
 * v2 (sdk/007): posts.create/posts.react are re-pointed here — --video-thumbnail
 * has no v2 home (dropped, same class as profile's --notify) and attachments
 * are base64 JSON objects, not multipart. --comment-id on `post react` is
 * also dropped: comment-level reactions moved to the comments.* group
 * (comment-id has no home on posts.react's v2 body); --as-organization now
 * maps to the renamed `react_as` body field.
 */

import { defineCommand } from "citty";
import { GLOBAL_FLAGS, WRITE_FLAGS } from "../lib/global-flags.js";
import { resolveTextOrStdin } from "../lib/stdin.js";
import { resolveEffectiveConfig } from "../lib/resolve.js";
import { createClient } from "../lib/client.js";
import { renderSuccess, renderError, renderUnexpectedError } from "../lib/output.js";
import { buildPreviewOutput } from "../lib/preview.js";
import { streamAll } from "../lib/paginate.js";
import { readAttachment, AttachError, toAttachmentPayload } from "../lib/attach.js";
import type { Curviate, CurviateError } from "@curviate/sdk";

// ---------------------------------------------------------------------------
// Valid write-side reaction values.
// Write values are ALWAYS lowercase. Uppercase read-side values (LIKE, PRAISE …)
// surface in responses as `value` (reactions list items) and `user_reacted` (post get) —
// they are NOT accepted as write values here.
// ---------------------------------------------------------------------------
const VALID_REACTIONS = new Set(["like", "celebrate", "support", "love", "insightful", "funny"]);

type PostFlags = {
  postId?: string;
  text?: string;
  reaction?: string;
  "reply-to"?: string;
  "as-organization"?: string;
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

function resolveOutputOpts(flags: PostFlags) {
  return {
    json: (flags.json ?? false) || !process.stdout.isTTY,
    isTTY: process.stdout.isTTY ?? false,
    fields: flags.fields,
  };
}

function buildPaginationParams(flags: PostFlags): Record<string, unknown> {
  const params: Record<string, unknown> = {};
  if (flags.limit !== undefined) params["limit"] = parseInt(flags.limit, 10);
  if (flags.cursor) params["cursor"] = flags.cursor;
  return params;
}

/** Normalize --attach flag to an array of paths. */
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
 * Run `post list [--all] [--limit] [--cursor]`.
 * Read command — rejects --preview.
 */
export async function runPostList(
  client: Curviate,
  flags: PostFlags,
  out: OutputStreams,
): Promise<void> {
  rejectPreviewOnRead(flags.preview, out);

  const accountId = requireAccount(flags.account, out);
  const ns = client.account(accountId);
  const outOpts = resolveOutputOpts(flags);
  const all = flags.all ?? false;
  const maxPages = flags["max-pages"] ? parseInt(flags["max-pages"], 10) : 100;
  const params = buildPaginationParams(flags);

  try {
    if (all) {
      const fn = (p: Record<string, unknown>) =>
        ns.posts.list(p) as Promise<{ items?: unknown[]; cursor?: string | null }>;
      for await (const item of streamAll(fn, params, {
        maxPages,
        onTruncated: (n) => out.stderr.write(`Streaming truncated at ${n} page(s). Use --all --max-pages or --cursor for manual paging.\n`),
      })) {
        out.stdout.write(JSON.stringify(item) + "\n");
      }
    } else {
      const result = await ns.posts.list(params);
      renderSuccess(result, outOpts, out);
    }
  } catch (err: unknown) {
    await handleSdkError(err, outOpts, out);
  }
}

/**
 * Run `post get <post_id>`.
 * Read command — rejects --preview and --all.
 */
export async function runPostGet(
  client: Curviate,
  flags: PostFlags,
  out: OutputStreams,
): Promise<void> {
  rejectPreviewOnRead(flags.preview, out);
  rejectAllOnNonPaginated(flags.all, out);

  const accountId = requireAccount(flags.account, out);
  const postId = flags.postId ?? "";
  const ns = client.account(accountId);
  const outOpts = resolveOutputOpts(flags);

  try {
    const result = await ns.posts.get(postId);
    renderSuccess(result, outOpts, out);
  } catch (err: unknown) {
    await handleSdkError(err, outOpts, out);
  }
}

/**
 * Run `post create "<text>" [--attach <file>…]`.
 * Write command — supports --preview.
 *
 * v2: pure application/json — no multipart op on the served surface, and no
 * `video_thumbnail` field (--video-thumbnail has no v2 home and is dropped,
 * same class of removal as profile's --notify). Attachments (images, a
 * single PDF for a document post, etc.) travel as base64
 * {content,content_type,filename} objects; multiple entries produce a
 * carousel.
 */
export async function runPostCreate(
  client: Curviate,
  flags: PostFlags,
  out: OutputStreams,
  _readStdin?: () => Promise<string>,
): Promise<void> {
  const accountId = requireAccount(flags.account, out);
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

  if (flags.preview) {
    const allAttachmentPreviews = attachBuffers.map((buf, i) => ({
      name: attachPaths[i] ? attachPaths[i].split("/").pop() ?? attachPaths[i] : `attachment_${i}`,
      buffer: buf,
    }));
    const preview = buildPreviewOutput({
      method: "posts.create",
      args: {},
      body: { text },
      account: accountId,
      attachments: allAttachmentPreviews,
    });
    out.stdout.write(JSON.stringify(preview) + "\n");
    return;
  }

  const attachmentPayloads = attachBuffers.map((buf, i) => toAttachmentPayload(attachPaths[i]!, buf));
  const body = {
    text,
    ...(attachmentPayloads.length > 0 ? { attachments: attachmentPayloads } : {}),
  };

  const ns = client.account(accountId);
  const outOpts = resolveOutputOpts(flags);

  try {
    const result = await ns.posts.create(body);
    renderSuccess(result, outOpts, out);
  } catch (err: unknown) {
    await handleSdkError(err, outOpts, out);
  }
}

/**
 * Run `post comment <post_id> "<text>" [--attach <file>] [--reply-to <comment_id>]`.
 * Write command — supports --preview. Multipart.
 * --reply-to → body field `comment_id` (NOT `parent_comment_id`).
 */
export async function runPostComment(
  client: Curviate,
  flags: PostFlags,
  out: OutputStreams,
  _readStdin?: () => Promise<string>,
): Promise<void> {
  const accountId = requireAccount(flags.account, out);
  const postId = flags.postId ?? "";
  const rawText = flags.text ?? "";
  const replyTo = flags["reply-to"];

  // Resolve stdin sentinel: "-" reads all of stdin.
  const text = await resolveTextOrStdin(rawText, out, _readStdin);
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

  // Build body shared between preview and SDK call.
  // comment_id is the confirmed field name for reply threading.
  const body: Record<string, unknown> = { text };
  if (replyTo) body["comment_id"] = replyTo;

  if (flags.preview) {
    const preview = buildPreviewOutput({
      method: "posts.comment",
      args: { post_id: postId },
      body,
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
    const result = await ns.posts.comment(postId, body);
    renderSuccess(result, outOpts, out);
  } catch (err: unknown) {
    await handleSdkError(err, outOpts, out);
  }
}

/**
 * Run `post comments <post_id> [--reply-to <comment_id>] [--all] [--limit] [--cursor]`.
 * Read command — rejects --preview.
 * --reply-to → `comment_id` query param on the listComments call.
 */
export async function runPostComments(
  client: Curviate,
  flags: PostFlags,
  out: OutputStreams,
): Promise<void> {
  rejectPreviewOnRead(flags.preview, out);

  const accountId = requireAccount(flags.account, out);
  const postId = flags.postId ?? "";
  const ns = client.account(accountId);
  const outOpts = resolveOutputOpts(flags);
  const all = flags.all ?? false;
  const maxPages = flags["max-pages"] ? parseInt(flags["max-pages"], 10) : 100;
  const params = buildPaginationParams(flags);

  // --reply-to filters replies under a specific comment
  if (flags["reply-to"]) params["comment_id"] = flags["reply-to"];

  try {
    if (all) {
      const fn = (p: Record<string, unknown>) =>
        ns.posts.listComments(postId, p) as Promise<{ items?: unknown[]; cursor?: string | null }>;
      for await (const item of streamAll(fn, params, {
        maxPages,
        onTruncated: (n) => out.stderr.write(`Streaming truncated at ${n} page(s). Use --all --max-pages or --cursor for manual paging.\n`),
      })) {
        out.stdout.write(JSON.stringify(item) + "\n");
      }
    } else {
      const result = await ns.posts.listComments(postId, params);
      renderSuccess(result, outOpts, out);
    }
  } catch (err: unknown) {
    await handleSdkError(err, outOpts, out);
  }
}

/**
 * Run `post react <post_id> --reaction <r> [--as-organization <org>]`.
 * Write command — supports --preview.
 * --reaction: validated against the write-side enum (lowercase only).
 * --as-organization: reacts on behalf of an organization page (v2 body
 * field: `react_as`).
 *
 * v2: `comment_id` has no home on posts.react's body (PostReactBody is just
 * {reaction, react_as?}) — comment-level reactions moved to the comments.*
 * group; --comment-id is dropped from this command.
 */
export async function runPostReact(
  client: Curviate,
  flags: PostFlags,
  out: OutputStreams,
): Promise<void> {
  const accountId = requireAccount(flags.account, out);
  const postId = flags.postId ?? "";
  const reaction = flags.reaction ?? "";

  // Validate write-side enum (must be lowercase; uppercase read-side values rejected).
  if (!VALID_REACTIONS.has(reaction)) {
    out.stderr.write(
      `error: --reaction must be one of: like, celebrate, support, love, insightful, funny. Got: "${reaction}"\n`,
    );
    process.exit(2);
    return;
  }

  const asOrganization = flags["as-organization"];

  // Build body shared between preview and SDK call.
  const body = {
    reaction: reaction as "like" | "celebrate" | "support" | "love" | "insightful" | "funny",
    ...(asOrganization ? { react_as: asOrganization } : {}),
  };

  if (flags.preview) {
    const preview = buildPreviewOutput({
      method: "posts.react",
      args: { post_id: postId },
      body,
      account: accountId,
    });
    out.stdout.write(JSON.stringify(preview) + "\n");
    return;
  }

  const ns = client.account(accountId);
  const outOpts = resolveOutputOpts(flags);

  try {
    const result = await ns.posts.react(postId, body);
    renderSuccess(result, outOpts, out);
  } catch (err: unknown) {
    await handleSdkError(err, outOpts, out);
  }
}

/**
 * Run `post reactions <post_id> [--all] [--limit] [--cursor]`.
 * Read command — rejects --preview.
 */
export async function runPostReactions(
  client: Curviate,
  flags: PostFlags,
  out: OutputStreams,
): Promise<void> {
  rejectPreviewOnRead(flags.preview, out);

  const accountId = requireAccount(flags.account, out);
  const postId = flags.postId ?? "";
  const ns = client.account(accountId);
  const outOpts = resolveOutputOpts(flags);
  const all = flags.all ?? false;
  const maxPages = flags["max-pages"] ? parseInt(flags["max-pages"], 10) : 100;
  const params = buildPaginationParams(flags);

  try {
    if (all) {
      const fn = (p: Record<string, unknown>) =>
        ns.posts.listReactions(postId, p) as Promise<{ items?: unknown[]; cursor?: string | null }>;
      for await (const item of streamAll(fn, params, {
        maxPages,
        onTruncated: (n) => out.stderr.write(`Streaming truncated at ${n} page(s). Use --all --max-pages or --cursor for manual paging.\n`),
      })) {
        out.stdout.write(JSON.stringify(item) + "\n");
      }
    } else {
      const result = await ns.posts.listReactions(postId, params);
      renderSuccess(result, outOpts, out);
    }
  } catch (err: unknown) {
    await handleSdkError(err, outOpts, out);
  }
}

// ---------------------------------------------------------------------------
// Citty command definitions
// ---------------------------------------------------------------------------

const postListCommand = defineCommand({
  meta: { name: "list", description: "List posts published by the account." },
  args: { ...GLOBAL_FLAGS },
  async run({ args }) {
    const flags = args as PostFlags;
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
    await runPostList(client, { ...flags, account: flags.account ?? cfg.account }, out);
  },
});

const postGetCommand = defineCommand({
  meta: { name: "get", description: "Get a post by id." },
  args: {
    ...GLOBAL_FLAGS,
    postId: {
      type: "positional",
      description:
        "Numeric post id, urn:li:activity:N, or full LinkedIn share URL (activity-<N>- extracted). " +
        "POSTID is always the post's id. To list replies to a comment, use 'post comments <post_id> --reply-to <comment_id>'.",
    },
  },
  async run({ args }) {
    const flags = args as PostFlags;
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
    await runPostGet(client, { ...flags, account: flags.account ?? cfg.account }, out);
  },
});

const postCreateCommand = defineCommand({
  meta: { name: "create", description: "Create a new post." },
  args: {
    // Write command: WRITE_FLAGS omits pagination/projection flags
    ...WRITE_FLAGS,
    text: { type: "positional", description: "Post body text. Pass - to read from stdin (enables multiline via heredoc or pipe)." },
    attach: {
      type: "string",
      description:
        "Image/video/document to attach (repeatable for images; a single PDF produces a document post). " +
        "Supported: jpg, png, gif, mp4, pdf.",
    },
  },
  async run({ args }) {
    const flags = args as PostFlags;
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
    await runPostCreate(client, { ...flags, account: flags.account ?? cfg.account }, out);
  },
});

const postCommentCommand = defineCommand({
  meta: { name: "comment", description: "Comment on a post, or reply to a comment with --reply-to." },
  args: {
    // Write command: WRITE_FLAGS omits pagination/projection flags
    ...WRITE_FLAGS,
    postId: {
      type: "positional",
      description:
        "Numeric post id, urn:li:activity:N, or full LinkedIn share URL (activity-<N>- extracted). " +
        "POSTID is always the post's id; use --reply-to <comment_id> to reply to a specific comment within this post.",
    },
    text: { type: "positional", description: "Comment text (max ~1,250 characters per LinkedIn limits). Pass - to read from stdin." },
    attach: { type: "string", description: "Image to attach to the comment (optional; one image per comment)." },
    "reply-to": {
      type: "string",
      description: "Post as a reply to this comment id (omit for a top-level comment on the post).",
    },
  },
  async run({ args }) {
    const flags = args as PostFlags;
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
    await runPostComment(client, { ...flags, account: flags.account ?? cfg.account }, out);
  },
});

const postCommentsCommand = defineCommand({
  meta: { name: "comments", description: "List comments on a post. Use --reply-to to fetch replies to a specific comment." },
  args: {
    ...GLOBAL_FLAGS,
    postId: {
      type: "positional",
      description:
        "Numeric post id, urn:li:activity:N, or full LinkedIn share URL (activity-<N>- extracted). " +
        "POSTID is always the post's id; to fetch replies to a comment, use --reply-to <comment_id>.",
    },
    "reply-to": {
      type: "string",
      description: "Filter replies under this comment id (omit to list top-level comments on the post).",
    },
  },
  async run({ args }) {
    const flags = args as PostFlags;
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
    await runPostComments(client, { ...flags, account: flags.account ?? cfg.account }, out);
  },
});

const postReactCommand = defineCommand({
  meta: { name: "react", description: "React to a post." },
  args: {
    // Write command: WRITE_FLAGS omits pagination/projection flags
    ...WRITE_FLAGS,
    postId: {
      type: "positional",
      description:
        "Numeric post id, urn:li:activity:N, or full LinkedIn share URL (activity-<N>- extracted). " +
        "POSTID is always the post's id.",
    },
    reaction: {
      type: "string",
      required: true,
      description:
        "Write-side reaction (lowercase). Write values: like, celebrate, support, love, insightful, funny. " +
        "Read-side vocabulary (in the value and user_reacted response fields): LIKE, PRAISE, APPRECIATION, EMPATHY, INTEREST, ENTERTAINMENT. " +
        "Confirmed write→read mappings: like=LIKE, celebrate=PRAISE, insightful=INTEREST. " +
        "(support, love, and funny are valid write values; their read-side pairings are unconfirmed.)",
    },
    "as-organization": {
      type: "string",
      description: "React on behalf of an organization page (org id from 'profile me' organizations).",
    },
  },
  async run({ args }) {
    const flags = args as PostFlags;
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
    await runPostReact(client, { ...flags, account: flags.account ?? cfg.account }, out);
  },
});

const postReactionsCommand = defineCommand({
  meta: { name: "reactions", description: "List reactions on a post." },
  args: {
    ...GLOBAL_FLAGS,
    postId: {
      type: "positional",
      description:
        "Numeric post id, urn:li:activity:N, or full LinkedIn share URL (activity-<N>- extracted). " +
        "POSTID is always the post's id.",
    },
  },
  async run({ args }) {
    const flags = args as PostFlags;
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
    await runPostReactions(client, { ...flags, account: flags.account ?? cfg.account }, out);
  },
});

export const postCommand = defineCommand({
  meta: { name: "post", description: "Create and manage LinkedIn posts." },
  subCommands: {
    list: postListCommand,
    get: postGetCommand,
    create: postCreateCommand,
    comment: postCommentCommand,
    comments: postCommentsCommand,
    react: postReactCommand,
    reactions: postReactionsCommand,
  },
  async run() {
    process.stderr.write(
      "Usage: curviate post <subcommand>\n" +
      "  list\n" +
      "  get <post_id>\n" +
      "  create \"<text>\" [--attach <file>…]\n" +
      "  comment <post_id> \"<text>\" [--attach <file>] [--reply-to <comment_id>]\n" +
      "  comments <post_id> [--reply-to <comment_id>]\n" +
      "  react <post_id> --reaction <r> [--as-organization <org_id>]\n" +
      "  reactions <post_id>\n",
    );
  },
});
