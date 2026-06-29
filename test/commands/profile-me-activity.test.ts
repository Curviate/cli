/**
 * profile me activity flags — --posts/--comments/--reactions/--followers routing
 *
 * `profile me --posts/--comments/--reactions/--followers` resolves own
 * public_identifier via getMe(), then routes to the matching list method.
 *
 * Precedence: posts > comments > reactions > followers (multiple flags → first wins, no exit 2).
 * Exactly 2 SDK calls per invocation: getMe() + the list method.
 *
 * --all is still rejected when NO activity flag is present (getMe is not paginated).
 * --all is ACCEPTED when an activity flag is present (the list IS paginated) —
 * but this test focuses on the basic 2-call wiring, not full --all streaming.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Mock } from "vitest";

function makeAccountNs() {
  return {
    profiles: {
      getMe: vi.fn(),
      get: vi.fn(),
      listPosts: vi.fn(),
      listComments: vi.fn(),
      listReactions: vi.fn(),
      listFollowers: vi.fn(),
      listConnections: vi.fn(),
      endorse: vi.fn(),
      getCompany: vi.fn(),
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
    // getMe stub returns public_identifier
    (ns.profiles.getMe as Mock).mockResolvedValue({
      public_identifier: "raphael-redmer",
      provider_id: "ACoXX",
      first_name: "Raphael",
      last_name: "Redmer",
      location: "Berlin",
      email: "r@r.ai",
      occupation: "Founder",
      is_premium: true,
      organizations: [],
    });
    (ns.profiles.listPosts as Mock).mockResolvedValue({ object: "post_list", items: [], cursor: null });
    (ns.profiles.listComments as Mock).mockResolvedValue({ object: "comment_list", items: [], cursor: null });
    (ns.profiles.listReactions as Mock).mockResolvedValue({ object: "reaction_list", items: [], cursor: null });
    (ns.profiles.listFollowers as Mock).mockResolvedValue({ object: "follower_list", items: [], cursor: null });
  });

  afterEach(() => { vi.restoreAllMocks(); });

  it("--posts: getMe() called once, listPosts(slug) called once, exactly 2 SDK calls", async () => {
    const { runProfileMe } = await import("../../src/commands/profile.js");
    const out = { stdout: { write: vi.fn() }, stderr: { write: vi.fn() } };

    await runProfileMe(client as never, {
      posts: true,
      account: "acc_1",
      json: true,
    } as ProfileMeArgs, out);

    expect(ns.profiles.getMe).toHaveBeenCalledTimes(1);
    expect(ns.profiles.listPosts).toHaveBeenCalledWith(
      "raphael-redmer",
      expect.any(Object),
    );
    expect(ns.profiles.listPosts).toHaveBeenCalledTimes(1);
    // Verify exactly 2 SDK calls total (getMe + listPosts)
    expect(ns.profiles.get).not.toHaveBeenCalled();
    expect(ns.profiles.listComments).not.toHaveBeenCalled();
    expect(ns.profiles.listReactions).not.toHaveBeenCalled();
    expect(ns.profiles.listFollowers).not.toHaveBeenCalled();
  });

  it("--comments: getMe() + listComments(slug)", async () => {
    const { runProfileMe } = await import("../../src/commands/profile.js");
    const out = { stdout: { write: vi.fn() }, stderr: { write: vi.fn() } };

    await runProfileMe(client as never, {
      comments: true,
      account: "acc_1",
      json: true,
    } as ProfileMeArgs, out);

    expect(ns.profiles.getMe).toHaveBeenCalledTimes(1);
    expect(ns.profiles.listComments).toHaveBeenCalledWith("raphael-redmer", expect.any(Object));
    expect(ns.profiles.listPosts).not.toHaveBeenCalled();
  });

  it("--reactions: getMe() + listReactions(slug)", async () => {
    const { runProfileMe } = await import("../../src/commands/profile.js");
    const out = { stdout: { write: vi.fn() }, stderr: { write: vi.fn() } };

    await runProfileMe(client as never, {
      reactions: true,
      account: "acc_1",
      json: true,
    } as ProfileMeArgs, out);

    expect(ns.profiles.getMe).toHaveBeenCalledTimes(1);
    expect(ns.profiles.listReactions).toHaveBeenCalledWith("raphael-redmer", expect.any(Object));
    expect(ns.profiles.listPosts).not.toHaveBeenCalled();
  });

  it("--followers: getMe() + listFollowers(slug)", async () => {
    const { runProfileMe } = await import("../../src/commands/profile.js");
    const out = { stdout: { write: vi.fn() }, stderr: { write: vi.fn() } };

    await runProfileMe(client as never, {
      followers: true,
      account: "acc_1",
      json: true,
    } as ProfileMeArgs, out);

    expect(ns.profiles.getMe).toHaveBeenCalledTimes(1);
    expect(ns.profiles.listFollowers).toHaveBeenCalledWith("raphael-redmer", expect.any(Object));
    expect(ns.profiles.listPosts).not.toHaveBeenCalled();
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

    expect(ns.profiles.listPosts).toHaveBeenCalledWith("raphael-redmer", expect.any(Object));
    expect(ns.profiles.listComments).not.toHaveBeenCalled();
  });

  it("no activity flag → getMe() called, no list method called (base behavior preserved)", async () => {
    const { runProfileMe } = await import("../../src/commands/profile.js");
    const out = { stdout: { write: vi.fn() }, stderr: { write: vi.fn() } };

    await runProfileMe(client as never, {
      account: "acc_1",
      json: true,
    } as ProfileMeArgs, out);

    expect(ns.profiles.getMe).toHaveBeenCalledTimes(1);
    expect(ns.profiles.listPosts).not.toHaveBeenCalled();
    expect(ns.profiles.listComments).not.toHaveBeenCalled();
  });

  it("--all without activity flag → still exit 2 (getMe is not paginated)", async () => {
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
