/**
 * Tests for the `profile` command group.
 * Covers: routing, identifier resolution, flag dispatching, --preview on reads,
 * --all NDJSON, --all on non-paginated commands.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Mock } from "vitest";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal account-scoped namespace stub. */
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
    },
  };
}

/** Minimal Curviate client stub. */
function makeClient(accountNs: ReturnType<typeof makeAccountNs>) {
  return {
    account: vi.fn().mockReturnValue(accountNs),
  };
}

type ProfileCommandArgs = {
  id?: string;
  posts?: boolean;
  comments?: boolean;
  reactions?: boolean;
  followers?: boolean;
  "is-company"?: boolean;
  skill?: string;
  notify?: boolean;
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

type SubCommandArgs = {
  id?: string;
  skill?: string;
  notify?: boolean;
  account?: string;
  json?: boolean;
  all?: boolean;
  "max-pages"?: string;
  preview?: boolean;
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("profile command — routing", () => {
  let accountNs: ReturnType<typeof makeAccountNs>;
  let client: ReturnType<typeof makeClient>;

  beforeEach(() => {
    accountNs = makeAccountNs();
    client = makeClient(accountNs);
    (accountNs.profiles.getMe as Mock).mockResolvedValue({ id: "me" });
    (accountNs.profiles.get as Mock).mockResolvedValue({ id: "jdoe" });
    (accountNs.profiles.listPosts as Mock).mockResolvedValue({ items: [], cursor: null });
    (accountNs.profiles.listComments as Mock).mockResolvedValue({ items: [], cursor: null });
    (accountNs.profiles.listReactions as Mock).mockResolvedValue({ items: [], cursor: null });
    (accountNs.profiles.listFollowers as Mock).mockResolvedValue({ items: [], cursor: null });
    (accountNs.profiles.listConnections as Mock).mockResolvedValue({ items: [], cursor: null });
    (accountNs.profiles.endorse as Mock).mockResolvedValue({ success: true });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("profile me — calls getMe(), no id arg", async () => {
    const { runProfileMe } = await import("../../src/commands/profile.js");
    const out = { stdout: { write: vi.fn() }, stderr: { write: vi.fn() } };

    await runProfileMe(client as never, { account: "acc_1", json: true } as ProfileCommandArgs, out);

    expect(client.account).toHaveBeenCalledWith("acc_1");
    expect(accountNs.profiles.getMe).toHaveBeenCalledWith();
    expect(accountNs.profiles.get).not.toHaveBeenCalled();
  });

  it("profile me — --preview is a usage error (exit 2)", async () => {
    const { runProfileMe } = await import("../../src/commands/profile.js");
    const out = { stdout: { write: vi.fn() }, stderr: { write: vi.fn() } };

    const exitSpy = vi.spyOn(process, "exit").mockImplementation((code?: number | string | null) => { throw new Error(`process.exit(${code})`); });
    try {
      await runProfileMe(client as never, { account: "acc_1", preview: true } as ProfileCommandArgs, out);
      expect.fail("Should have exited");
    } catch (e) {
      expect((e as Error).message).toContain("process.exit(2)");
    } finally {
      exitSpy.mockRestore();
    }
  });

  it("profile me — --all is a usage error (exit 2)", async () => {
    const { runProfileMe } = await import("../../src/commands/profile.js");
    const out = { stdout: { write: vi.fn() }, stderr: { write: vi.fn() } };

    const exitSpy = vi.spyOn(process, "exit").mockImplementation((code?: number | string | null) => { throw new Error(`process.exit(${code})`); });
    try {
      await runProfileMe(client as never, { account: "acc_1", all: true } as ProfileCommandArgs, out);
      expect.fail("Should have exited");
    } catch (e) {
      expect((e as Error).message).toContain("process.exit(2)");
    } finally {
      exitSpy.mockRestore();
    }
  });

  it("profile <id> — default (no flag) calls profiles.get with resolved id", async () => {
    const { runProfileGet } = await import("../../src/commands/profile.js");
    const out = { stdout: { write: vi.fn() }, stderr: { write: vi.fn() } };

    await runProfileGet(client as never, { id: "https://www.linkedin.com/in/jdoe/", account: "acc_1", json: true } as ProfileCommandArgs, out);

    expect(client.account).toHaveBeenCalledWith("acc_1");
    expect(accountNs.profiles.get).toHaveBeenCalledWith("jdoe", expect.objectContaining({}));
    expect(accountNs.profiles.listPosts).not.toHaveBeenCalled();
  });

  it("profile <id> --notify — passes notify param", async () => {
    const { runProfileGet } = await import("../../src/commands/profile.js");
    const out = { stdout: { write: vi.fn() }, stderr: { write: vi.fn() } };

    await runProfileGet(client as never, { id: "jdoe", account: "acc_1", notify: true, json: true } as ProfileCommandArgs, out);

    expect(accountNs.profiles.get).toHaveBeenCalledWith("jdoe", expect.objectContaining({ notify: true }));
  });

  it("profile <id> --posts — calls listPosts", async () => {
    const { runProfileGet } = await import("../../src/commands/profile.js");
    const out = { stdout: { write: vi.fn() }, stderr: { write: vi.fn() } };

    await runProfileGet(client as never, { id: "jdoe", posts: true, account: "acc_1", json: true } as ProfileCommandArgs, out);

    expect(accountNs.profiles.listPosts).toHaveBeenCalledWith("jdoe", expect.any(Object));
    expect(accountNs.profiles.get).not.toHaveBeenCalled();
  });

  it("profile <id> --posts --is-company — passes is_company: true", async () => {
    const { runProfileGet } = await import("../../src/commands/profile.js");
    const out = { stdout: { write: vi.fn() }, stderr: { write: vi.fn() } };

    await runProfileGet(client as never, { id: "jdoe", posts: true, "is-company": true, account: "acc_1", json: true } as ProfileCommandArgs, out);

    expect(accountNs.profiles.listPosts).toHaveBeenCalledWith("jdoe", expect.objectContaining({ is_company: true }));
  });

  it("profile <id> --comments — calls listComments", async () => {
    const { runProfileGet } = await import("../../src/commands/profile.js");
    const out = { stdout: { write: vi.fn() }, stderr: { write: vi.fn() } };

    await runProfileGet(client as never, { id: "jdoe", comments: true, account: "acc_1", json: true } as ProfileCommandArgs, out);

    expect(accountNs.profiles.listComments).toHaveBeenCalledWith("jdoe", expect.any(Object));
  });

  it("profile <id> --reactions — calls listReactions", async () => {
    const { runProfileGet } = await import("../../src/commands/profile.js");
    const out = { stdout: { write: vi.fn() }, stderr: { write: vi.fn() } };

    await runProfileGet(client as never, { id: "jdoe", reactions: true, account: "acc_1", json: true } as ProfileCommandArgs, out);

    expect(accountNs.profiles.listReactions).toHaveBeenCalledWith("jdoe", expect.any(Object));
  });

  it("profile <id> --followers — calls listFollowers", async () => {
    const { runProfileGet } = await import("../../src/commands/profile.js");
    const out = { stdout: { write: vi.fn() }, stderr: { write: vi.fn() } };

    await runProfileGet(client as never, { id: "jdoe", followers: true, account: "acc_1", json: true } as ProfileCommandArgs, out);

    expect(accountNs.profiles.listFollowers).toHaveBeenCalledWith("jdoe", expect.any(Object));
  });

  it("profile <id> read flag + --preview → usage error (exit 2)", async () => {
    const { runProfileGet } = await import("../../src/commands/profile.js");
    const out = { stdout: { write: vi.fn() }, stderr: { write: vi.fn() } };

    const exitSpy = vi.spyOn(process, "exit").mockImplementation((code?: number | string | null) => { throw new Error(`process.exit(${code})`); });
    try {
      await runProfileGet(client as never, { id: "jdoe", account: "acc_1", preview: true } as ProfileCommandArgs, out);
      expect.fail("Should have exited");
    } catch (e) {
      expect((e as Error).message).toContain("process.exit(2)");
    } finally {
      exitSpy.mockRestore();
    }
  });

  it("profile connections — calls listConnections()", async () => {
    const { runProfileConnections } = await import("../../src/commands/profile.js");
    const out = { stdout: { write: vi.fn() }, stderr: { write: vi.fn() } };

    await runProfileConnections(client as never, { account: "acc_1", json: true } as SubCommandArgs, out);

    expect(client.account).toHaveBeenCalledWith("acc_1");
    expect(accountNs.profiles.listConnections).toHaveBeenCalled();
  });

  it("profile connections --all — streams NDJSON over 2 pages", async () => {
    const { runProfileConnections } = await import("../../src/commands/profile.js");
    const out = { stdout: { write: vi.fn() }, stderr: { write: vi.fn() } };

    // Two pages
    (accountNs.profiles.listConnections as Mock)
      .mockResolvedValueOnce({ items: [{ id: "A" }, { id: "B" }], cursor: "c1" })
      .mockResolvedValueOnce({ items: [{ id: "C" }], cursor: null });

    await runProfileConnections(client as never, { account: "acc_1", all: true } as SubCommandArgs, out);

    const writtenLines = (out.stdout.write as Mock).mock.calls.map((c) => c[0] as string);
    const ndjsonLines = writtenLines.filter((l) => l.trim().startsWith("{"));
    expect(ndjsonLines).toHaveLength(3);
    expect(JSON.parse(ndjsonLines[0]!)).toEqual({ id: "A" });
    expect(JSON.parse(ndjsonLines[1]!)).toEqual({ id: "B" });
    expect(JSON.parse(ndjsonLines[2]!)).toEqual({ id: "C" });
  });

  it("profile connections --all --max-pages 1 — truncates and notes stderr", async () => {
    const { runProfileConnections } = await import("../../src/commands/profile.js");
    const out = { stdout: { write: vi.fn() }, stderr: { write: vi.fn() } };

    (accountNs.profiles.listConnections as Mock)
      .mockResolvedValueOnce({ items: [{ id: "A" }, { id: "B" }], cursor: "c1" });

    await runProfileConnections(client as never, { account: "acc_1", all: true, "max-pages": "1" } as SubCommandArgs, out);

    const writtenLines = (out.stdout.write as Mock).mock.calls.map((c) => c[0] as string);
    const ndjsonLines = writtenLines.filter((l) => l.trim().startsWith("{"));
    expect(ndjsonLines).toHaveLength(2);

    const stderrCalls = (out.stderr.write as Mock).mock.calls.map((c) => c[0] as string).join("");
    expect(stderrCalls).toMatch(/truncat/i);
  });
});

describe("profile endorse — write command", () => {
  let accountNs: ReturnType<typeof makeAccountNs>;
  let client: ReturnType<typeof makeClient>;

  beforeEach(() => {
    accountNs = makeAccountNs();
    client = makeClient(accountNs);
    (accountNs.profiles.endorse as Mock).mockResolvedValue({ success: true });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("endorse <id> --skill <sid> — calls endorse(id, {skill_endorsement_id})", async () => {
    const { runProfileEndorse } = await import("../../src/commands/profile.js");
    const out = { stdout: { write: vi.fn() }, stderr: { write: vi.fn() } };

    await runProfileEndorse(client as never, { id: "jdoe", skill: "skill_123", account: "acc_1", json: true } as SubCommandArgs, out);

    expect(client.account).toHaveBeenCalledWith("acc_1");
    expect(accountNs.profiles.endorse).toHaveBeenCalledWith("jdoe", { skill_endorsement_id: "skill_123" });
  });

  it("endorse --preview — renders preview without calling endorse", async () => {
    const { runProfileEndorse } = await import("../../src/commands/profile.js");
    const out = { stdout: { write: vi.fn() }, stderr: { write: vi.fn() } };

    await runProfileEndorse(client as never, { id: "jdoe", skill: "skill_123", account: "acc_1", preview: true } as SubCommandArgs, out);

    expect(accountNs.profiles.endorse).not.toHaveBeenCalled();
    const written = (out.stdout.write as Mock).mock.calls.map((c) => c[0] as string).join("");
    const parsed = JSON.parse(written);
    expect(parsed.method).toBe("profiles.endorse");
  });

  it("endorse — resolves member URL to slug", async () => {
    const { runProfileEndorse } = await import("../../src/commands/profile.js");
    const out = { stdout: { write: vi.fn() }, stderr: { write: vi.fn() } };

    await runProfileEndorse(client as never, { id: "https://www.linkedin.com/in/some-user/", skill: "skill_1", account: "acc_1", json: true } as SubCommandArgs, out);

    expect(accountNs.profiles.endorse).toHaveBeenCalledWith("some-user", { skill_endorsement_id: "skill_1" });
  });
});

describe("profile — no account error", () => {
  it("profile me with no account → exit 2", async () => {
    const accountNs = makeAccountNs();
    const client = makeClient(accountNs);
    const { runProfileMe } = await import("../../src/commands/profile.js");
    const out = { stdout: { write: vi.fn() }, stderr: { write: vi.fn() } };

    const exitSpy = vi.spyOn(process, "exit").mockImplementation((code?: number | string | null) => { throw new Error(`process.exit(${code})`); });
    try {
      await runProfileMe(client as never, { json: true } as ProfileCommandArgs, out);
      expect.fail("Should have exited");
    } catch (e) {
      expect((e as Error).message).toContain("process.exit(2)");
    } finally {
      exitSpy.mockRestore();
    }
  });
});
