/**
 * profile me activity flags — --posts/--comments/--reactions/--followers routing
 *
 * v2: `profile me --posts/--comments/--reactions/--followers` passes the "me"
 * sentinel straight to the self-scoped list method — a single SDK call, no
 * getMe pre-call to resolve a public identifier.
 *
 * Precedence: posts > comments > reactions > followers (multiple flags → first
 * wins, no exit 2).
 *
 * --all is rejected when NO activity flag is present (a single profile is not
 * paginated); accepted when an activity flag is present (the list IS paginated).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Mock } from "vitest";

function makeAccountNs() {
  return {
    users: {
      get: vi.fn(),
      listFollowers: vi.fn(),
    },
    posts: {
      listUserPosts: vi.fn(),
      listUserReactions: vi.fn(),
    },
    comments: {
      listUserComments: vi.fn(),
    },
  };
}

function makeClient(ns: ReturnType<typeof makeAccountNs>) {
  return { account: vi.fn().mockReturnValue(ns) };
}

type ProfileMeArgs = {
  posts?: boolean;
  comments?: boolean;
  reactions?: boolean;
  followers?: boolean;
  sections?: string;
  account?: string;
  json?: boolean;
  preview?: boolean;
  all?: boolean;
  limit?: string;
  cursor?: string;
  "max-pages"?: string;
  verbose?: boolean;
};

describe("profile me activity flags", () => {
  let ns: ReturnType<typeof makeAccountNs>;
  let client: ReturnType<typeof makeClient>;

  beforeEach(() => {
    ns = makeAccountNs();
    client = makeClient(ns);
    (ns.users.get as Mock).mockResolvedValue({
      object: "user_profile",
      id: "ACoXX",
      public_identifier: "raphael-redmer",
      first_name: "Raphael",
      last_name: "Redmer",
    });
    (ns.posts.listUserPosts as Mock).mockResolvedValue({ object: "post_list", items: [], cursor: null });
    (ns.comments.listUserComments as Mock).mockResolvedValue({ object: "comment_list", items: [], cursor: null });
    (ns.posts.listUserReactions as Mock).mockResolvedValue({ object: "reaction_list", items: [], cursor: null });
    (ns.users.listFollowers as Mock).mockResolvedValue({ object: "follower_list", items: [], cursor: null });
  });

  afterEach(() => { vi.restoreAllMocks(); });

  it("--posts: listUserPosts('me') called once, no getMe pre-call, exactly 1 SDK call", async () => {
    const { runProfileMe } = await import("../../src/commands/profile.js");
    const out = { stdout: { write: vi.fn() }, stderr: { write: vi.fn() } };

    await runProfileMe(client as never, {
      posts: true,
      account: "acc_1",
      json: true,
    } as ProfileMeArgs, out);

    expect(ns.posts.listUserPosts).toHaveBeenCalledWith("me", expect.any(Object));
    expect(ns.posts.listUserPosts).toHaveBeenCalledTimes(1);
    // No base users.get pre-call, and no other list method fired.
    expect(ns.users.get).not.toHaveBeenCalled();
    expect(ns.comments.listUserComments).not.toHaveBeenCalled();
    expect(ns.posts.listUserReactions).not.toHaveBeenCalled();
    expect(ns.users.listFollowers).not.toHaveBeenCalled();
  });

  it("--comments: listUserComments('me')", async () => {
    const { runProfileMe } = await import("../../src/commands/profile.js");
    const out = { stdout: { write: vi.fn() }, stderr: { write: vi.fn() } };

    await runProfileMe(client as never, {
      comments: true,
      account: "acc_1",
      json: true,
    } as ProfileMeArgs, out);

    expect(ns.comments.listUserComments).toHaveBeenCalledWith("me", expect.any(Object));
    expect(ns.posts.listUserPosts).not.toHaveBeenCalled();
  });

  it("--reactions: listUserReactions('me')", async () => {
    const { runProfileMe } = await import("../../src/commands/profile.js");
    const out = { stdout: { write: vi.fn() }, stderr: { write: vi.fn() } };

    await runProfileMe(client as never, {
      reactions: true,
      account: "acc_1",
      json: true,
    } as ProfileMeArgs, out);

    expect(ns.posts.listUserReactions).toHaveBeenCalledWith("me", expect.any(Object));
    expect(ns.posts.listUserPosts).not.toHaveBeenCalled();
  });

  it("--followers: listFollowers('me')", async () => {
    const { runProfileMe } = await import("../../src/commands/profile.js");
    const out = { stdout: { write: vi.fn() }, stderr: { write: vi.fn() } };

    await runProfileMe(client as never, {
      followers: true,
      account: "acc_1",
      json: true,
    } as ProfileMeArgs, out);

    expect(ns.users.listFollowers).toHaveBeenCalledWith("me", expect.any(Object));
    expect(ns.posts.listUserPosts).not.toHaveBeenCalled();
  });

  it("--posts --comments (multiple flags) → precedence: posts wins, no exit 2", async () => {
    const { runProfileMe } = await import("../../src/commands/profile.js");
    const out = { stdout: { write: vi.fn() }, stderr: { write: vi.fn() } };

    // Must NOT exit 2 — precedence chain, posts wins
    await runProfileMe(client as never, {
      posts: true,
      comments: true,
      account: "acc_1",
      json: true,
    } as ProfileMeArgs, out);

    expect(ns.posts.listUserPosts).toHaveBeenCalledWith("me", expect.any(Object));
    expect(ns.comments.listUserComments).not.toHaveBeenCalled();
  });

  it("no activity flag → users.get('me') called, no list method called", async () => {
    const { runProfileMe } = await import("../../src/commands/profile.js");
    const out = { stdout: { write: vi.fn() }, stderr: { write: vi.fn() } };

    await runProfileMe(client as never, {
      account: "acc_1",
      json: true,
    } as ProfileMeArgs, out);

    expect(ns.users.get).toHaveBeenCalledWith("me", {});
    expect(ns.posts.listUserPosts).not.toHaveBeenCalled();
    expect(ns.comments.listUserComments).not.toHaveBeenCalled();
  });

  it("--all without activity flag → still exit 2 (a single profile is not paginated)", async () => {
    const { runProfileMe } = await import("../../src/commands/profile.js");
    const out = { stdout: { write: vi.fn() }, stderr: { write: vi.fn() } };

    const exitSpy = vi.spyOn(process, "exit").mockImplementation((code?: number | string | null) => {
      throw new Error(`process.exit(${code})`);
    });
    try {
      await runProfileMe(client as never, {
        all: true,
        account: "acc_1",
      } as ProfileMeArgs, out);
      expect.fail("should have exited");
    } catch (e) {
      expect((e as Error).message).toContain("process.exit(2)");
    } finally {
      exitSpy.mockRestore();
    }
  });

  it("profile me command args include --posts/--comments/--reactions/--followers", async () => {
    const { profileCommand } = await import("../../src/commands/profile.js");
    const subCmds = (profileCommand as Record<string, unknown>).subCommands as Record<
      string,
      { args?: Record<string, unknown> }
    >;
    const meArgs = subCmds["me"]?.args ?? {};

    expect(meArgs, "profile me args must include --posts").toHaveProperty("posts");
    expect(meArgs, "profile me args must include --comments").toHaveProperty("comments");
    expect(meArgs, "profile me args must include --reactions").toHaveProperty("reactions");
    expect(meArgs, "profile me args must include --followers").toHaveProperty("followers");
  });
});
