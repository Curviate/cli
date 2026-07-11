/**
 * Tests for the new `post` subcommands: delete / unreact / user-posts /
 * user-reactions. Assert the SDK method + exact args (the wire contract).
 *
 *   post delete <post_id>            → posts.delete(post_id)  (bodyless)
 *   post unreact <post_id> <r>       → posts.unreact(post_id, { reaction })  (DELETE-with-body)
 *   post user-posts <user_id>        → posts.listUserPosts(user_id, params)
 *   post user-reactions <user_id>    → posts.listUserReactions(user_id, params)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Mock } from "vitest";

function makeAccountNs() {
  return {
    posts: {
      delete: vi.fn(),
      unreact: vi.fn(),
      listUserPosts: vi.fn(),
      listUserReactions: vi.fn(),
    },
  };
}

function makeClient(accountNs: ReturnType<typeof makeAccountNs>) {
  return { account: vi.fn().mockReturnValue(accountNs) };
}

function makeOut() {
  return { stdout: { write: vi.fn() }, stderr: { write: vi.fn() } };
}

function mockExit() {
  return vi.spyOn(process, "exit").mockImplementation((code?: number | string | null) => {
    throw new Error(`process.exit(${code})`);
  });
}

type Args = Record<string, unknown>;

describe("post delete (bodyless)", () => {
  let accountNs: ReturnType<typeof makeAccountNs>;
  let client: ReturnType<typeof makeClient>;
  beforeEach(() => {
    accountNs = makeAccountNs();
    client = makeClient(accountNs);
    (accountNs.posts.delete as Mock).mockResolvedValue({});
  });
  afterEach(() => vi.restoreAllMocks());

  it("calls posts.delete with the verbatim post id, single argument", async () => {
    const { runPostDelete } = await import("../../src/commands/post.js");
    await runPostDelete(client as never, { postId: "urn:li:activity:1", account: "acc_1", json: true } as Args, makeOut());
    expect(accountNs.posts.delete).toHaveBeenCalledWith("urn:li:activity:1");
    expect((accountNs.posts.delete as Mock).mock.calls[0]).toHaveLength(1);
  });

  it("--preview renders the bodyless preview, no SDK call", async () => {
    const { runPostDelete } = await import("../../src/commands/post.js");
    const out = makeOut();
    await runPostDelete(client as never, { postId: "p1", account: "acc_1", preview: true, json: true } as Args, out);
    expect(accountNs.posts.delete).not.toHaveBeenCalled();
    const preview = JSON.parse((out.stdout.write as Mock).mock.calls.map((c) => c[0] as string).join(""));
    expect(preview.method).toBe("posts.delete");
    expect(preview.body).toEqual({});
  });
});

describe("post unreact (DELETE-with-body)", () => {
  let accountNs: ReturnType<typeof makeAccountNs>;
  let client: ReturnType<typeof makeClient>;
  beforeEach(() => {
    accountNs = makeAccountNs();
    client = makeClient(accountNs);
    (accountNs.posts.unreact as Mock).mockResolvedValue({ object: "reaction" });
  });
  afterEach(() => vi.restoreAllMocks());

  it("calls posts.unreact with the reaction in the body", async () => {
    const { runPostUnreact } = await import("../../src/commands/post.js");
    await runPostUnreact(client as never, { postId: "p1", reaction: "like", account: "acc_1", json: true } as Args, makeOut());
    expect(accountNs.posts.unreact).toHaveBeenCalledWith("p1", { reaction: "like" });
  });

  it("rejects a reaction outside the write enum (exit 2, no SDK call)", async () => {
    const { runPostUnreact } = await import("../../src/commands/post.js");
    const exitSpy = mockExit();
    try {
      await runPostUnreact(client as never, { postId: "p1", reaction: "LIKE", account: "acc_1" } as Args, makeOut());
      expect.fail("should have exited");
    } catch (e) {
      expect((e as Error).message).toContain("process.exit(2)");
    } finally {
      exitSpy.mockRestore();
    }
    expect(accountNs.posts.unreact).not.toHaveBeenCalled();
  });
});

describe("post user-posts / user-reactions (paginated reads)", () => {
  let accountNs: ReturnType<typeof makeAccountNs>;
  let client: ReturnType<typeof makeClient>;
  const page = { object: "user_post_list", items: [], cursor: null };
  beforeEach(() => {
    accountNs = makeAccountNs();
    client = makeClient(accountNs);
    (accountNs.posts.listUserPosts as Mock).mockResolvedValue(page);
    (accountNs.posts.listUserReactions as Mock).mockResolvedValue(page);
  });
  afterEach(() => vi.restoreAllMocks());

  it("post user-posts <id> calls posts.listUserPosts (resolved id, top-level pagination)", async () => {
    const { runPostUserPosts } = await import("../../src/commands/post.js");
    await runPostUserPosts(client as never, { userId: "me", limit: "5", account: "acc_1", json: true } as Args, makeOut());
    expect(accountNs.posts.listUserPosts).toHaveBeenCalledWith("me", { limit: 5 });
  });

  it("post user-reactions <id> calls posts.listUserReactions", async () => {
    const { runPostUserReactions } = await import("../../src/commands/post.js");
    await runPostUserReactions(client as never, { userId: "me", account: "acc_1", json: true } as Args, makeOut());
    expect(accountNs.posts.listUserReactions).toHaveBeenCalledWith("me", {});
  });

  it("post user-posts rejects --preview (exit 2, no SDK call)", async () => {
    const { runPostUserPosts } = await import("../../src/commands/post.js");
    const exitSpy = mockExit();
    try {
      await runPostUserPosts(client as never, { userId: "me", account: "acc_1", preview: true } as Args, makeOut());
      expect.fail("should have exited");
    } catch (e) {
      expect((e as Error).message).toContain("process.exit(2)");
    } finally {
      exitSpy.mockRestore();
    }
    expect(accountNs.posts.listUserPosts).not.toHaveBeenCalled();
  });
});

describe("post command surface", () => {
  type CommandLike = { subCommands?: Record<string, { args?: Record<string, unknown> }> };

  it("registers delete / unreact / user-posts / user-reactions", async () => {
    const { postCommand } = await import("../../src/commands/post.js");
    const subs = (postCommand as unknown as CommandLike).subCommands ?? {};
    for (const name of ["delete", "unreact", "user-posts", "user-reactions"]) {
      expect(subs, `post ${name} is registered`).toHaveProperty(name);
    }
  });

  it("write subcommands (delete/unreact) omit pagination flags but keep --fields", async () => {
    const { postCommand } = await import("../../src/commands/post.js");
    const subs = (postCommand as unknown as CommandLike).subCommands ?? {};
    for (const name of ["delete", "unreact"]) {
      const args = subs[name]?.args ?? {};
      for (const flag of ["limit", "cursor", "all", "max-pages"]) {
        expect(args, `post ${name} must NOT include --${flag}`).not.toHaveProperty(flag);
      }
      expect(args, `post ${name} keeps --fields`).toHaveProperty("fields");
    }
  });
});
