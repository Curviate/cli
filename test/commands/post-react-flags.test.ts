/**
 * post react --as-organization flag wiring
 *
 * v2: PostReactBody is { reaction, react_as? } — `comment_id` is REMOVED
 * (comment-level reactions moved to the comments.* group); the CLI
 * --as-organization flag maps onto the renamed `react_as` body field.
 *
 * post react --as-organization <org> → body contains react_as
 * No optional flag → body has only { reaction }
 * --reaction LIKE (uppercase) → exit 2 (write-side enum is lowercase)
 * --reaction invalid → exit 2
 * --reaction support → exit 0 (valid write value even though no confirmed read pairing)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Mock } from "vitest";

function makePostsNs() {
  return {
    posts: {
      get: vi.fn(),
      create: vi.fn(),
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
  "as-organization"?: string;
  account?: string;
  json?: boolean;
  preview?: boolean;
};

describe("post react — --as-organization", () => {
  let ns: ReturnType<typeof makePostsNs>;
  let client: ReturnType<typeof makeClient>;

  beforeEach(() => {
    ns = makePostsNs();
    client = makeClient(ns);
    (ns.posts.react as Mock).mockResolvedValue({ object: "reaction_added" });
  });

  afterEach(() => { vi.restoreAllMocks(); });

  it("--as-organization → body includes react_as (v2 body-key rename from as_organization)", async () => {
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
      { reaction: "celebrate", react_as: "org_123" },
    );
  });

  it("no --as-organization → body has only { reaction }, no react_as", async () => {
    const { runPostReact } = await import("../../src/commands/post.js");
    const out = { stdout: { write: vi.fn() }, stderr: { write: vi.fn() } };

    await runPostReact(client as never, {
      postId: "post_1",
      reaction: "like",
      account: "acc_1",
      json: true,
    } as PostArgs, out);

    const body = (ns.posts.react as Mock).mock.calls[0]![1] as Record<string, unknown>;
    expect(body).not.toHaveProperty("react_as");
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

  it("--as-organization --preview → preview body includes react_as", async () => {
    const { runPostReact } = await import("../../src/commands/post.js");
    const out = { stdout: { write: vi.fn() }, stderr: { write: vi.fn() } };

    await runPostReact(client as never, {
      postId: "post_1",
      reaction: "like",
      "as-organization": "org_xyz",
      account: "acc_1",
      preview: true,
    } as PostArgs, out);

    expect(ns.posts.react).not.toHaveBeenCalled();
    const written = (out.stdout.write as Mock).mock.calls.map((c) => c[0] as string).join("");
    const parsed = JSON.parse(written);
    expect(parsed.body).toMatchObject({ react_as: "org_xyz" });
  });
});
