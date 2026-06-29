/**
 * TS-018 — AC-018 (FR-016) + AC-019 (FR-017)
 *
 * AC-018: `post comments --reply-to <cmt>` passes `comment_id` as query param
 * AC-019: `post comment --reply-to <cmt>` passes `comment_id` in multipart body
 *         (field name MUST be `comment_id`, NOT `parent_comment_id`)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Mock } from "vitest";

function makePostsNs() {
  return {
    posts: {
      list: vi.fn(),
      get: vi.fn(),
      create: vi.fn(),
      comment: vi.fn(),
      listComments: vi.fn(),
      react: vi.fn(),
      listReactions: vi.fn(),
    },
  };
}

function makeClient(ns: ReturnType<typeof makePostsNs>) {
  return { account: vi.fn().mockReturnValue(ns) };
}

type PostArgs = {
  postId?: string;
  text?: string;
  reaction?: string;
  "reply-to"?: string;
  "comment-id"?: string;
  "as-organization"?: string;
  attach?: string | string[];
  account?: string;
  json?: boolean;
  preview?: boolean;
  all?: boolean;
  limit?: string;
  cursor?: string;
  "max-pages"?: string;
  fields?: string;
};

// ---------------------------------------------------------------------------
// AC-018: post comments --reply-to
// ---------------------------------------------------------------------------

describe("post comments --reply-to (AC-018, FR-016)", () => {
  let ns: ReturnType<typeof makePostsNs>;
  let client: ReturnType<typeof makeClient>;

  beforeEach(() => {
    ns = makePostsNs();
    client = makeClient(ns);
    (ns.posts.listComments as Mock).mockResolvedValue({ items: [], cursor: null });
  });

  afterEach(() => { vi.restoreAllMocks(); });

  it("post comments --reply-to cmt_top — passes comment_id as query param", async () => {
    const { runPostComments } = await import("../../src/commands/post.js");
    const out = { stdout: { write: vi.fn() }, stderr: { write: vi.fn() } };

    await runPostComments(client as never, {
      postId: "post_1",
      "reply-to": "cmt_top",
      account: "acc_1",
      json: true,
    } as PostArgs, out);

    expect(ns.posts.listComments).toHaveBeenCalledWith(
      "post_1",
      expect.objectContaining({ comment_id: "cmt_top" }),
    );
  });

  it("post comments (no --reply-to) — listComments called without comment_id", async () => {
    const { runPostComments } = await import("../../src/commands/post.js");
    const out = { stdout: { write: vi.fn() }, stderr: { write: vi.fn() } };

    await runPostComments(client as never, {
      postId: "post_1",
      account: "acc_1",
      json: true,
    } as PostArgs, out);

    const callArgs = (ns.posts.listComments as Mock).mock.calls[0]!;
    // second argument is params — must not have comment_id
    const params = callArgs[1] as Record<string, unknown> | undefined;
    expect(params).not.toHaveProperty("comment_id");
  });

  it("post comments --help description mentions --reply-to (AC-018)", async () => {
    const { postCommand } = await import("../../src/commands/post.js");
    const subCmds = (postCommand as Record<string, unknown>).subCommands as Record<
      string,
      { args?: Record<string, { description?: string }> }
    >;
    const commentsArgs = subCmds["comments"]?.args ?? {};
    // --reply-to flag must exist with a meaningful description
    expect(commentsArgs).toHaveProperty("reply-to");
    const replyToDesc = commentsArgs["reply-to"]?.description ?? "";
    expect(replyToDesc.toLowerCase()).toMatch(/repl/); // "replies" or "reply"
  });
});

// ---------------------------------------------------------------------------
// AC-019: post comment --reply-to (body field is `comment_id`, NOT `parent_comment_id`)
// ---------------------------------------------------------------------------

describe("post comment --reply-to (AC-019, FR-017)", () => {
  let ns: ReturnType<typeof makePostsNs>;
  let client: ReturnType<typeof makeClient>;

  beforeEach(() => {
    ns = makePostsNs();
    client = makeClient(ns);
    (ns.posts.comment as Mock).mockResolvedValue({ object: "comment_added", social_id: "cmt_new" });
  });

  afterEach(() => { vi.restoreAllMocks(); });

  it("post comment --reply-to cmt_top — body contains comment_id (not parent_comment_id)", async () => {
    const { runPostComment } = await import("../../src/commands/post.js");
    const out = { stdout: { write: vi.fn() }, stderr: { write: vi.fn() } };

    await runPostComment(client as never, {
      postId: "post_1",
      text: "Nice reply",
      "reply-to": "cmt_top",
      account: "acc_1",
      json: true,
    } as PostArgs, out);

    expect(ns.posts.comment).toHaveBeenCalledWith(
      "post_1",
      expect.objectContaining({ text: "Nice reply", comment_id: "cmt_top" }),
    );
    // Explicitly verify no parent_comment_id key
    const body = (ns.posts.comment as Mock).mock.calls[0]![1] as Record<string, unknown>;
    expect(body).not.toHaveProperty("parent_comment_id");
  });

  it("post comment (no --reply-to) — body does NOT have comment_id", async () => {
    const { runPostComment } = await import("../../src/commands/post.js");
    const out = { stdout: { write: vi.fn() }, stderr: { write: vi.fn() } };

    await runPostComment(client as never, {
      postId: "post_1",
      text: "Top-level comment",
      account: "acc_1",
      json: true,
    } as PostArgs, out);

    const body = (ns.posts.comment as Mock).mock.calls[0]![1] as Record<string, unknown>;
    expect(body).not.toHaveProperty("comment_id");
  });

  it("post comment --reply-to --preview — preview body includes comment_id", async () => {
    const { runPostComment } = await import("../../src/commands/post.js");
    const out = { stdout: { write: vi.fn() }, stderr: { write: vi.fn() } };

    await runPostComment(client as never, {
      postId: "post_1",
      text: "reply",
      "reply-to": "cmt_top",
      account: "acc_1",
      preview: true,
    } as PostArgs, out);

    expect(ns.posts.comment).not.toHaveBeenCalled();
    const written = (out.stdout.write as Mock).mock.calls.map((c) => c[0] as string).join("");
    const parsed = JSON.parse(written);
    expect(parsed.body).toMatchObject({ comment_id: "cmt_top" });
  });
});
