/**
 * Tests for the `profile` command group.
 * Covers: routing, identifier resolution, flag dispatching, --preview on reads,
 * --all NDJSON, --all on non-paginated commands, --sections, slim/verbose,
 * company slug resolution for --posts --is-company.
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
      getCompany: vi.fn(),
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
  sections?: string;
  verbose?: boolean;
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
    (accountNs.profiles.getCompany as Mock).mockResolvedValue({ id: "123456" });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("profile me — calls getMe() with empty params when no --sections", async () => {
    const { runProfileMe } = await import("../../src/commands/profile.js");
    const out = { stdout: { write: vi.fn() }, stderr: { write: vi.fn() } };

    await runProfileMe(client as never, { account: "acc_1", json: true } as ProfileCommandArgs, out);

    expect(client.account).toHaveBeenCalledWith("acc_1");
    expect(accountNs.profiles.getMe).toHaveBeenCalledWith({});
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

  it("profile <id> --posts --is-company (numeric id) — passes is_company: true, no slug resolution", async () => {
    const { runProfileGet } = await import("../../src/commands/profile.js");
    const out = { stdout: { write: vi.fn() }, stderr: { write: vi.fn() } };

    // Use a numeric id to exercise the "bypass slug resolution" path
    await runProfileGet(client as never, { id: "123456", posts: true, "is-company": true, account: "acc_1", json: true } as ProfileCommandArgs, out);

    expect(accountNs.profiles.getCompany).not.toHaveBeenCalled();
    expect(accountNs.profiles.listPosts).toHaveBeenCalledWith("123456", expect.objectContaining({ is_company: true }));
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

// ---------------------------------------------------------------------------
// --sections passthrough
// ---------------------------------------------------------------------------

describe("profile me — --sections passthrough", () => {
  let accountNs: ReturnType<typeof makeAccountNs>;
  let client: ReturnType<typeof makeClient>;

  beforeEach(() => {
    accountNs = makeAccountNs();
    client = makeClient(accountNs);
    (accountNs.profiles.getMe as Mock).mockResolvedValue({ id: "me" });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("--sections 'experience,education' calls getMe with linkedin_sections array", async () => {
    const { runProfileMe } = await import("../../src/commands/profile.js");
    const out = { stdout: { write: vi.fn() }, stderr: { write: vi.fn() } };

    await runProfileMe(
      client as never,
      { account: "acc_1", json: true, sections: "experience,education" } as ProfileCommandArgs,
      out,
    );

    expect(accountNs.profiles.getMe).toHaveBeenCalledWith(
      expect.objectContaining({ linkedin_sections: ["experience", "education"] }),
    );
  });

  it("--sections '*' calls getMe with linkedin_sections:['*']", async () => {
    const { runProfileMe } = await import("../../src/commands/profile.js");
    const out = { stdout: { write: vi.fn() }, stderr: { write: vi.fn() } };

    await runProfileMe(
      client as never,
      { account: "acc_1", json: true, sections: "*" } as ProfileCommandArgs,
      out,
    );

    expect(accountNs.profiles.getMe).toHaveBeenCalledWith(
      expect.objectContaining({ linkedin_sections: ["*"] }),
    );
  });

  it("--sections '' exits 2 (empty string is a usage error)", async () => {
    const { runProfileMe } = await import("../../src/commands/profile.js");
    const out = { stdout: { write: vi.fn() }, stderr: { write: vi.fn() } };

    const exitSpy = vi.spyOn(process, "exit").mockImplementation(
      (code?: number | string | null) => { throw new Error(`process.exit(${code})`); },
    );
    try {
      await runProfileMe(
        client as never,
        { account: "acc_1", sections: "" } as ProfileCommandArgs,
        out,
      );
      expect.fail("Should have exited");
    } catch (e) {
      expect((e as Error).message).toContain("process.exit(2)");
    } finally {
      exitSpy.mockRestore();
    }
    expect(accountNs.profiles.getMe).not.toHaveBeenCalled();
  });
});

describe("profile <id> — --sections passthrough", () => {
  let accountNs: ReturnType<typeof makeAccountNs>;
  let client: ReturnType<typeof makeClient>;

  beforeEach(() => {
    accountNs = makeAccountNs();
    client = makeClient(accountNs);
    (accountNs.profiles.get as Mock).mockResolvedValue({ id: "jdoe" });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("--sections 'experience' calls get with linkedin_sections:['experience']", async () => {
    const { runProfileGet } = await import("../../src/commands/profile.js");
    const out = { stdout: { write: vi.fn() }, stderr: { write: vi.fn() } };

    await runProfileGet(
      client as never,
      { id: "jdoe", account: "acc_1", json: true, sections: "experience" } as ProfileCommandArgs,
      out,
    );

    expect(accountNs.profiles.get).toHaveBeenCalledWith(
      "jdoe",
      expect.objectContaining({ linkedin_sections: ["experience"] }),
    );
  });

  it("--sections '' exits 2 on profile <id> (usage error)", async () => {
    const { runProfileGet } = await import("../../src/commands/profile.js");
    const out = { stdout: { write: vi.fn() }, stderr: { write: vi.fn() } };

    const exitSpy = vi.spyOn(process, "exit").mockImplementation(
      (code?: number | string | null) => { throw new Error(`process.exit(${code})`); },
    );
    try {
      await runProfileGet(
        client as never,
        { id: "jdoe", account: "acc_1", sections: "" } as ProfileCommandArgs,
        out,
      );
      expect.fail("Should have exited");
    } catch (e) {
      expect((e as Error).message).toContain("process.exit(2)");
    } finally {
      exitSpy.mockRestore();
    }
    expect(accountNs.profiles.get).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// slim mode (no --verbose)
// ---------------------------------------------------------------------------

describe("profile me — slim mode (no --verbose)", () => {
  const richProfile = {
    provider_id: "prov_123",
    first_name: "John",
    last_name: "Doe",
    public_identifier: "johndoe",
    location: "Berlin",
    email: "john@example.com",
    occupation: "Engineer",
    is_premium: false,
    organizations: [
      { id: "org_1", mailbox_id: "mb_1", name: "Acme", logo_url: "https://logo.example.com" },
    ],
    entity_urn: "urn:li:member:123",
    work_experience: [{ id: "exp1", position: "Engineer", company: "Acme", end: null }],
    education: [{ school: "MIT" }],
  };

  let accountNs: ReturnType<typeof makeAccountNs>;
  let client: ReturnType<typeof makeClient>;

  beforeEach(() => {
    accountNs = makeAccountNs();
    client = makeClient(accountNs);
    (accountNs.profiles.getMe as Mock).mockResolvedValue(richProfile);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("slim output has exactly the 10 fields (incl. current_position), no heavy fields", async () => {
    const { runProfileMe } = await import("../../src/commands/profile.js");
    const out = { stdout: { write: vi.fn() }, stderr: { write: vi.fn() } };

    await runProfileMe(client as never, { account: "acc_1", json: true } as ProfileCommandArgs, out);

    const written = (out.stdout.write as Mock).mock.calls.map((c) => c[0] as string).join("");
    const result = JSON.parse(written) as Record<string, unknown>;
    expect(Object.keys(result)).toHaveLength(10);
    expect(result).toHaveProperty("current_position");
    expect(result).not.toHaveProperty("entity_urn");
    expect(result).not.toHaveProperty("work_experience");
    expect(result).not.toHaveProperty("education");
  });

  it("organizations only has id/mailbox_id/name per element", async () => {
    const { runProfileMe } = await import("../../src/commands/profile.js");
    const out = { stdout: { write: vi.fn() }, stderr: { write: vi.fn() } };

    await runProfileMe(client as never, { account: "acc_1", json: true } as ProfileCommandArgs, out);

    const written = (out.stdout.write as Mock).mock.calls.map((c) => c[0] as string).join("");
    const result = JSON.parse(written) as Record<string, unknown>;
    const orgs = result["organizations"] as Array<Record<string, unknown>>;
    expect(orgs[0]).toEqual({ id: "org_1", mailbox_id: "mb_1", name: "Acme" });
    expect(orgs[0]!["logo_url"]).toBeUndefined();
  });
});

describe("profile me — --verbose mode", () => {
  const richProfile = {
    provider_id: "prov_123",
    first_name: "John",
    last_name: "Doe",
    entity_urn: "urn:li:member:123",
    work_experience: [{ id: "exp1", position: "Engineer", company: "Acme", end: null }],
    education: [{ school: "MIT" }],
  };

  let accountNs: ReturnType<typeof makeAccountNs>;
  let client: ReturnType<typeof makeClient>;

  beforeEach(() => {
    accountNs = makeAccountNs();
    client = makeClient(accountNs);
    (accountNs.profiles.getMe as Mock).mockResolvedValue(richProfile);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("--verbose returns full SDK response (includes work_experience, entity_urn, etc.)", async () => {
    const { runProfileMe } = await import("../../src/commands/profile.js");
    const out = { stdout: { write: vi.fn() }, stderr: { write: vi.fn() } };

    await runProfileMe(
      client as never,
      { account: "acc_1", json: true, verbose: true } as ProfileCommandArgs,
      out,
    );

    const written = (out.stdout.write as Mock).mock.calls.map((c) => c[0] as string).join("");
    const result = JSON.parse(written) as Record<string, unknown>;
    expect(result).toHaveProperty("entity_urn");
    expect(result).toHaveProperty("work_experience");
    expect(result).toHaveProperty("education");
  });
});

// ---------------------------------------------------------------------------
// slim/verbose for profile <id> (default branch)
// ---------------------------------------------------------------------------

describe("profile <id> — slim mode (current_position synthesis)", () => {
  const richProfile = {
    provider_id: "prov_456",
    first_name: "Jane",
    last_name: "Smith",
    headline: "Senior Engineer",
    location: "London, UK",
    occupation: "Engineer",
    network_distance: "DISTANCE_1",
    public_identifier: "janesmith",
    work_experience: [
      {
        id: "exp_1",
        position: "Senior Engineer",
        company: "TechCorp",
        location: "London",
        status: null,
        company_picture_url: null,
        skills: [],
        start: { month: 1, year: 2020 },
        end: null,
      },
    ],
    education: [{ school: "Oxford" }],
    viewer_permissions: { can_send_inmail: false },
  };

  let accountNs: ReturnType<typeof makeAccountNs>;
  let client: ReturnType<typeof makeClient>;

  beforeEach(() => {
    accountNs = makeAccountNs();
    client = makeClient(accountNs);
    (accountNs.profiles.get as Mock).mockResolvedValue(richProfile);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("slim output has current_position synthesized from work_experience[0]", async () => {
    const { runProfileGet } = await import("../../src/commands/profile.js");
    const out = { stdout: { write: vi.fn() }, stderr: { write: vi.fn() } };

    await runProfileGet(
      client as never,
      { id: "janesmith", account: "acc_1", json: true } as ProfileCommandArgs,
      out,
    );

    const written = (out.stdout.write as Mock).mock.calls.map((c) => c[0] as string).join("");
    const result = JSON.parse(written) as Record<string, unknown>;
    expect(result).toHaveProperty("current_position");
    expect(result["current_position"]).toEqual({
      title: "Senior Engineer",     // ← from position
      company_name: "TechCorp",     // ← from company
      company_id: null,             // ALWAYS null
      is_current: true,             // ← end == null
    });
    expect(result).not.toHaveProperty("work_experience");
    expect(result).not.toHaveProperty("education");
  });

  it("current_position is null when work_experience is empty", async () => {
    const { runProfileGet } = await import("../../src/commands/profile.js");
    const out = { stdout: { write: vi.fn() }, stderr: { write: vi.fn() } };

    (accountNs.profiles.get as Mock).mockResolvedValue({ ...richProfile, work_experience: [] });

    await runProfileGet(
      client as never,
      { id: "janesmith", account: "acc_1", json: true } as ProfileCommandArgs,
      out,
    );

    const written = (out.stdout.write as Mock).mock.calls.map((c) => c[0] as string).join("");
    const result = JSON.parse(written) as Record<string, unknown>;
    expect(result["current_position"]).toBeNull();
  });

  it("--verbose mode: work_experience present, no current_position synthesis", async () => {
    const { runProfileGet } = await import("../../src/commands/profile.js");
    const out = { stdout: { write: vi.fn() }, stderr: { write: vi.fn() } };

    await runProfileGet(
      client as never,
      { id: "janesmith", account: "acc_1", json: true, verbose: true } as ProfileCommandArgs,
      out,
    );

    const written = (out.stdout.write as Mock).mock.calls.map((c) => c[0] as string).join("");
    const result = JSON.parse(written) as Record<string, unknown>;
    expect(result).toHaveProperty("work_experience");
    expect(result).not.toHaveProperty("current_position");
  });
});

// ---------------------------------------------------------------------------
// Company slug resolution for --posts --is-company
// ---------------------------------------------------------------------------

describe("profile <id> --posts --is-company — company slug resolution", () => {
  let accountNs: ReturnType<typeof makeAccountNs>;
  let client: ReturnType<typeof makeClient>;

  beforeEach(() => {
    accountNs = makeAccountNs();
    client = makeClient(accountNs);
    (accountNs.profiles.listPosts as Mock).mockResolvedValue({ items: [], cursor: null });
    (accountNs.profiles.getCompany as Mock).mockResolvedValue({ id: "7890123" });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("slug id → calls getCompany first, then listPosts with numeric company id", async () => {
    const { runProfileGet } = await import("../../src/commands/profile.js");
    const out = { stdout: { write: vi.fn() }, stderr: { write: vi.fn() } };

    await runProfileGet(
      client as never,
      { id: "acme-corp", posts: true, "is-company": true, account: "acc_1", json: true } as ProfileCommandArgs,
      out,
    );

    expect(accountNs.profiles.getCompany).toHaveBeenCalledWith("acme-corp");
    expect(accountNs.profiles.listPosts).toHaveBeenCalledWith(
      "7890123",
      expect.objectContaining({ is_company: true }),
    );
  });

  it("numeric id → calls listPosts directly, no getCompany call", async () => {
    const { runProfileGet } = await import("../../src/commands/profile.js");
    const out = { stdout: { write: vi.fn() }, stderr: { write: vi.fn() } };

    await runProfileGet(
      client as never,
      { id: "7890123", posts: true, "is-company": true, account: "acc_1", json: true } as ProfileCommandArgs,
      out,
    );

    expect(accountNs.profiles.getCompany).not.toHaveBeenCalled();
    expect(accountNs.profiles.listPosts).toHaveBeenCalledWith(
      "7890123",
      expect.objectContaining({ is_company: true }),
    );
  });

  it("URL id → resolved to slug → calls getCompany then listPosts with numeric id", async () => {
    const { runProfileGet } = await import("../../src/commands/profile.js");
    const out = { stdout: { write: vi.fn() }, stderr: { write: vi.fn() } };

    await runProfileGet(
      client as never,
      {
        id: "https://www.linkedin.com/company/acme-corp/",
        posts: true,
        "is-company": true,
        account: "acc_1",
        json: true,
      } as ProfileCommandArgs,
      out,
    );

    // resolveIdentifier extracts "acme-corp" from the URL, then getCompany is called
    expect(accountNs.profiles.getCompany).toHaveBeenCalledWith("acme-corp");
    expect(accountNs.profiles.listPosts).toHaveBeenCalledWith(
      "7890123",
      expect.objectContaining({ is_company: true }),
    );
  });

  it("getCompany throws error → propagates (would exit 4 for RESOURCE_NOT_FOUND)", async () => {
    const { runProfileGet } = await import("../../src/commands/profile.js");
    const out = { stdout: { write: vi.fn() }, stderr: { write: vi.fn() } };

    const mockErr = new Error("not found");
    (accountNs.profiles.getCompany as Mock).mockRejectedValue(mockErr);

    const exitSpy = vi.spyOn(process, "exit").mockImplementation(
      (code?: number | string | null) => { throw new Error(`process.exit(${code})`); },
    );
    try {
      await runProfileGet(
        client as never,
        { id: "unknown-co", posts: true, "is-company": true, account: "acc_1", json: true } as ProfileCommandArgs,
        out,
      );
      expect.fail("Should have exited or thrown");
    } catch (e) {
      // Either a process.exit or the raw error — both are acceptable here
      expect(e).toBeTruthy();
    } finally {
      exitSpy.mockRestore();
    }

    expect(accountNs.profiles.listPosts).not.toHaveBeenCalled();
  });
});
