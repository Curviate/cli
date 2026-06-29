/**
 * post react --comment-id / --as-organization flag wiring
 *
 * post react --comment-id <cmt> → body contains comment_id
 * post react --as-organization <org> → body contains as_organization
 * Both flags together → both in body
 * Neither flag → body has only { reaction }
 * --reaction LIKE (uppercase) → exit 2 (write-side enum is lowercase)
 * --reaction invalid → exit 2
 * --reaction support → exit 0 (valid write value even though no confirmed read pairing)
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
  account?: string;
  json?: boolean;
  preview?: boolean;
};

describe("post react — --comment-id and --as-organization", () => {
  let ns: ReturnType<typeof makePostsNs>;
  let client: ReturnType<typeof makeClient>;

  beforeEach(() => {
    ns = makePostsNs();
    client = makeClient(ns);
    (ns.posts.react as Mock).mockResolvedValue({ object: "reaction_added" });
  });

  afterEach(() => { vi.restoreAllMocks(); });

  it("--comment-id → body includes comment_id", async () => {
    const { runPostReact } = await import("../../src/commands/post.js");
    const out = { stdout: { write: vi.fn() }, stderr: { write: vi.fn() } };

    await runPostReact(client as never, {
      postId: "post_1",
      reaction: "like",
      "comment-id": "cmt_top",
      account: "acc_1",
      json: true,
    } as PostArgs, out);

    expect(ns.posts.react).toHaveBeenCalledWith(
      "post_1",
      expect.objectContaining({ reaction: "like", comment_id: "cmt_top" }),
    );
  });

  it("--as-organization → body includes as_organization", async () => {
    const { runPostReact } = await import("../../src/commands/post.js");
    const out = { stdout: { write: vi.fn() }, stderr: { write: vi.fn() } };

    await runPostReact(client as never, {
      postId: "post_1",
      reaction: "celebrate",
      "as-organization": "org_123",
      account: "acc_1",
      json: true,
    } as PostArgs, out);

    expect(ns.posts.react).toHaveBeenCalledWith(
      "post_1",
      expect.objectContaining({ reaction: "celebrate", as_organization: "org_123" }),
    );
  });

  it("both flags together → both comment_id and as_organization in body", async () => {
    const { runPostReact } = await import("../../src/commands/post.js");
    const out = { stdout: { write: vi.fn() }, stderr: { write: vi.fn() } };

    await runPostReact(client as never, {
      postId: "post_1",
      reaction: "love",
      "comment-id": "cmt_top",
      "as-organization": "org_123",
      account: "acc_1",
      json: true,
    } as PostArgs, out);

    expect(ns.posts.react).toHaveBeenCalledWith(
      "post_1",
      { reaction: "love", comment_id: "cmt_top", as_organization: "org_123" },
    );
  });

  it("no optional flags → body has only { reaction }, no comment_id or as_organization", async () => {
    const { runPostReact } = await import("../../src/commands/post.js");
    const out = { stdout: { write: vi.fn() }, stderr: { write: vi.fn() } };

    await runPostReact(client as never, {
      postId: "post_1",
      reaction: "like",
      account: "acc_1",
      json: true,
    } as PostArgs, out);

    const body = (ns.posts.react as Mock).mock.calls[0]![1] as Record<string, unknown>;
    expect(body).not.toHaveProperty("comment_id");
    expect(body).not.toHaveProperty("as_organization");
    expect(body).toEqual({ reaction: "like" });
  });

  it("--reaction LIKE (uppercase) → exit 2 (write enum is lowercase only)", async () => {
    const { runPostReact } = await import("../../src/commands/post.js");
    const out = { stdout: { write: vi.fn() }, stderr: { write: vi.fn() } };

    const exitSpy = vi.spyOn(process, "exit").mockImplementation((code?: number | string | null) => {
      throw new Error(`process.exit(${code})`);
    });
    try {
      await runPostReact(client as never, {
        postId: "post_1",
        reaction: "LIKE",
        account: "acc_1",
      } as PostArgs, out);
      expect.fail("should have exited");
    } catch (e) {
      expect((e as Error).message).toContain("process.exit(2)");
    } finally {
      exitSpy.mockRestore();
    }
    expect(ns.posts.react).not.toHaveBeenCalled();
  });

  it("--reaction invalid → exit 2", async () => {
    const { runPostReact } = await import("../../src/commands/post.js");
    const out = { stdout: { write: vi.fn() }, stderr: { write: vi.fn() } };

    const exitSpy = vi.spyOn(process, "exit").mockImplementation((code?: number | string | null) => {
      throw new Error(`process.exit(${code})`);
    });
    try {
      await runPostReact(client as never, {
        postId: "post_1",
        reaction: "thumbsup",
        account: "acc_1",
      } as PostArgs, out);
      expect.fail("should have exited");
    } catch (e) {
      expect((e as Error).message).toContain("process.exit(2)");
    } finally {
      exitSpy.mockRestore();
    }
  });

  it("--reaction support → exit 0 (valid write value, even without confirmed read pairing)", async () => {
    const { runPostReact } = await import("../../src/commands/post.js");
    const out = { stdout: { write: vi.fn() }, stderr: { write: vi.fn() } };

    // Should NOT exit 2 — support is a valid write value
    await runPostReact(client as never, {
      postId: "post_1",
      reaction: "support",
      account: "acc_1",
      json: true,
    } as PostArgs, out);

    expect(ns.posts.react).toHaveBeenCalledWith("post_1", { reaction: "support" });
  });

  it("--comment-id --preview → preview body includes comment_id and as_organization", async () => {
    const { runPostReact } = await import("../../src/commands/post.js");
    const out = { stdout: { write: vi.fn() }, stderr: { write: vi.fn() } };

    await runPostReact(client as never, {
      postId: "post_1",
      reaction: "like",
      "comment-id": "cmt_abc",
      "as-organization": "org_xyz",
      account: "acc_1",
      preview: true,
    } as PostArgs, out);

    expect(ns.posts.react).not.toHaveBeenCalled();
    const written = (out.stdout.write as Mock).mock.calls.map((c) => c[0] as string).join("");
    const parsed = JSON.parse(written);
    expect(parsed.body).toMatchObject({ comment_id: "cmt_abc", as_organization: "org_xyz" });
  });
});
