/**
 * Tests for the `company` command group.
 *
 * Covers:
 *   company <id>                    → companies.get (retrieve, hard-moved off profiles.getCompany)
 *   company employees <id>          → companies.employees (facade, --keywords/--location)
 *   company posts <id>              → companies.posts (facade)
 *   company jobs <id>               → companies.jobs (facade, --keywords)
 *   --preview/--all/--sections usage errors (read-command conventions)
 *   --account required (companies.get now always requires account_id)
 *   wrong usage: a non-numeric identifier on a sub-resource surfaces the
 *     server's 400 INVALID_REQUEST as exit 2 (the CLI does not duplicate the
 *     server-side ^\d+$ guard client-side)
 *   slim projection (default mode) + --verbose (full SDK response) for retrieve
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Mock } from "vitest";
import { CurviateError } from "@curviate/sdk";

function makeInvalidRequestError() {
  return new CurviateError({
    code: "INVALID_REQUEST",
    message: "identifier must be numeric.",
    httpStatus: 400,
    userFixable: true,
    retryLikelyToSucceed: false,
  });
}

function makeAccountNs() {
  return {
    companies: {
      get: vi.fn(),
      employees: vi.fn(),
      posts: vi.fn(),
      jobs: vi.fn(),
    },
  };
}

function makeClient(accountNs: ReturnType<typeof makeAccountNs>) {
  return {
    account: vi.fn().mockReturnValue(accountNs),
  };
}

type CompanyArgs = {
  id?: string;
  account?: string;
  json?: boolean;
  preview?: boolean;
  all?: boolean;
  "api-key"?: string;
  "base-url"?: string;
  timeout?: string;
  profile?: string;
  fields?: string;
  limit?: string;
  cursor?: string;
  "max-pages"?: string;
  verbose?: boolean;
  sections?: string;
  keywords?: string;
  location?: string;
};

function makeOut() {
  return { stdout: { write: vi.fn() }, stderr: { write: vi.fn() } };
}

function mockExit() {
  return vi.spyOn(process, "exit").mockImplementation((code?: number | string | null) => {
    throw new Error(`process.exit(${code})`);
  });
}

// ---------------------------------------------------------------------------
// company <id> (retrieve)
// ---------------------------------------------------------------------------

describe("company command (retrieve)", () => {
  let accountNs: ReturnType<typeof makeAccountNs>;
  let client: ReturnType<typeof makeClient>;

  beforeEach(() => {
    accountNs = makeAccountNs();
    client = makeClient(accountNs);
    (accountNs.companies.get as Mock).mockResolvedValue({ id: "112013061", object: "company_profile" });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("company <id> --account <id> — calls companies.get with the resolved slug", async () => {
    const { runCompanyGet } = await import("../../src/commands/company.js");
    const out = makeOut();

    await runCompanyGet(client as never, { id: "https://www.linkedin.com/company/t-systems/about/", account: "acc_1", json: true } as CompanyArgs, out);

    expect(client.account).toHaveBeenCalledWith("acc_1");
    expect(accountNs.companies.get).toHaveBeenCalledWith("t-systems");
  });

  it("company <id> — a numeric id passes through unchanged", async () => {
    const { runCompanyGet } = await import("../../src/commands/company.js");
    const out = makeOut();

    await runCompanyGet(client as never, { id: "112013061", account: "acc_1", json: true } as CompanyArgs, out);

    expect(accountNs.companies.get).toHaveBeenCalledWith("112013061");
  });

  it("company <id> without --account → exit 2 (account_id is now required)", async () => {
    const { runCompanyGet } = await import("../../src/commands/company.js");
    const out = makeOut();
    const exitSpy = mockExit();

    try {
      await runCompanyGet(client as never, { id: "t-systems", json: true } as CompanyArgs, out);
      expect.fail("Should have exited");
    } catch (e) {
      expect((e as Error).message).toContain("process.exit(2)");
    } finally {
      exitSpy.mockRestore();
    }
    expect(accountNs.companies.get).not.toHaveBeenCalled();
  });

  it("company --preview → usage error exit 2 (read command)", async () => {
    const { runCompanyGet } = await import("../../src/commands/company.js");
    const out = makeOut();
    const exitSpy = mockExit();

    try {
      await runCompanyGet(client as never, { id: "t-systems", account: "acc_1", preview: true } as CompanyArgs, out);
      expect.fail("Should have exited");
    } catch (e) {
      expect((e as Error).message).toContain("process.exit(2)");
    } finally {
      exitSpy.mockRestore();
    }
  });

  it("company --all → usage error exit 2 (non-paginated)", async () => {
    const { runCompanyGet } = await import("../../src/commands/company.js");
    const out = makeOut();
    const exitSpy = mockExit();

    try {
      await runCompanyGet(client as never, { id: "t-systems", account: "acc_1", all: true } as CompanyArgs, out);
      expect.fail("Should have exited");
    } catch (e) {
      expect((e as Error).message).toContain("process.exit(2)");
    } finally {
      exitSpy.mockRestore();
    }
  });

  it("company --sections → usage error exit 2 (sections not supported on company commands)", async () => {
    const { runCompanyGet } = await import("../../src/commands/company.js");
    const out = makeOut();
    const exitSpy = mockExit();

    try {
      await runCompanyGet(client as never, { id: "t-systems", account: "acc_1", sections: "skills" } as CompanyArgs, out);
      expect.fail("Should have exited");
    } catch (e) {
      expect((e as Error).message).toContain("process.exit(2)");
      expect((out.stderr.write as Mock).mock.calls.join("")).toContain("--sections");
    } finally {
      exitSpy.mockRestore();
    }
  });

  it("a 404 RESOURCE_NOT_FOUND (unknown identifier) surfaces as exit 4", async () => {
    const notFoundErr = new CurviateError({
      code: "RESOURCE_NOT_FOUND",
      message: "Company not found.",
      httpStatus: 404,
      userFixable: false,
      retryLikelyToSucceed: false,
    });
    (accountNs.companies.get as Mock).mockRejectedValue(notFoundErr);

    const { runCompanyGet } = await import("../../src/commands/company.js");
    const out = makeOut();
    const exitSpy = mockExit();

    try {
      await runCompanyGet(client as never, { id: "urn:li:organization:1", account: "acc_1", json: true } as CompanyArgs, out);
      expect.fail("Should have exited");
    } catch (e) {
      expect((e as Error).message).toContain("process.exit(4)");
    } finally {
      exitSpy.mockRestore();
    }
  });
});

// ---------------------------------------------------------------------------
// slim mode (no --verbose) — unaffected by the retrieve hard-move
// ---------------------------------------------------------------------------

describe("company slim mode (no --verbose)", () => {
  const richCompany = {
    id: "co_123",
    name: "Acme Corp",
    public_identifier: "acme-corp",
    profile_url: "https://linkedin.com/company/acme-corp",
    industry: "Technology",
    employee_count: 500,
    employee_count_range: { min: 201, max: 500, to: null },
    website: "https://acme.com",
    foundation_date: "2000-01-01",
    messaging: { is_enabled: true, thread_id: "t_1", extra: "hidden" },
    locations: [
      { city: "Austin", country: "US", area: "TX", is_headquarter: true },
    ],
    followers_count: 12000,
    viewer_permissions: { can_send_message: false },
    description: "A company description",
    activities: [{ id: "act_1" }],
  };

  let accountNs: ReturnType<typeof makeAccountNs>;
  let client: ReturnType<typeof makeClient>;

  beforeEach(() => {
    accountNs = makeAccountNs();
    client = makeClient(accountNs);
    (accountNs.companies.get as Mock).mockResolvedValue(richCompany);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("slim output has exactly the 12 fields", async () => {
    const { runCompanyGet } = await import("../../src/commands/company.js");
    const out = makeOut();

    await runCompanyGet(client as never, { id: "acme-corp", account: "acc_1", json: true } as CompanyArgs, out);

    const written = (out.stdout.write as Mock).mock.calls.map((c) => c[0] as string).join("");
    const result = JSON.parse(written) as Record<string, unknown>;
    expect(Object.keys(result)).toHaveLength(12);
  });

  it("headquarters synthesized from is_headquarter location", async () => {
    const { runCompanyGet } = await import("../../src/commands/company.js");
    const out = makeOut();

    await runCompanyGet(client as never, { id: "acme-corp", account: "acc_1", json: true } as CompanyArgs, out);

    const written = (out.stdout.write as Mock).mock.calls.map((c) => c[0] as string).join("");
    const result = JSON.parse(written) as Record<string, unknown>;
    expect(result["headquarters"]).toEqual({ city: "Austin", country: "US", area: "TX" });
  });
});

// ---------------------------------------------------------------------------
// --verbose mode
// ---------------------------------------------------------------------------

describe("company --verbose mode", () => {
  const richCompany = {
    id: "co_123",
    name: "Acme Corp",
    viewer_permissions: { can_send_message: false },
    description: "A company description",
    locations: [{ city: "Austin", country: "US", is_headquarter: true }],
  };

  let accountNs: ReturnType<typeof makeAccountNs>;
  let client: ReturnType<typeof makeClient>;

  beforeEach(() => {
    accountNs = makeAccountNs();
    client = makeClient(accountNs);
    (accountNs.companies.get as Mock).mockResolvedValue(richCompany);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("--verbose returns full SDK response including viewer_permissions, locations array", async () => {
    const { runCompanyGet } = await import("../../src/commands/company.js");
    const out = makeOut();

    await runCompanyGet(
      client as never,
      { id: "acme-corp", account: "acc_1", json: true, verbose: true } as CompanyArgs,
      out,
    );

    const written = (out.stdout.write as Mock).mock.calls.map((c) => c[0] as string).join("");
    const result = JSON.parse(written) as Record<string, unknown>;
    expect(result).toHaveProperty("viewer_permissions");
    expect(result).toHaveProperty("description");
    expect(result).toHaveProperty("locations");
  });
});

// ---------------------------------------------------------------------------
// company employees <id>
// ---------------------------------------------------------------------------

describe("company employees command", () => {
  let accountNs: ReturnType<typeof makeAccountNs>;
  let client: ReturnType<typeof makeClient>;

  beforeEach(() => {
    accountNs = makeAccountNs();
    client = makeClient(accountNs);
    (accountNs.companies.employees as Mock).mockResolvedValue({
      object: "company_employee_list",
      items: [{ id: "ACoA1", public_identifier: "frank", full_name: "Frank Employee", headline: "Engineer", location: "Berlin", network_distance: null }],
      paging: { total_count: 1 },
      cursor: null,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("company employees <cid> --account <id> --keywords engineer — forwards keywords/location/limit/cursor", async () => {
    const { runCompanyEmployees } = await import("../../src/commands/company.js");
    const out = makeOut();

    await runCompanyEmployees(client as never, {
      id: "112013061",
      account: "acc_1",
      json: true,
      keywords: "engineer",
      location: "reg_1",
      limit: "5",
      cursor: "cur_0",
    } as CompanyArgs, out);

    expect(accountNs.companies.employees).toHaveBeenCalledWith("112013061", {
      limit: 5,
      cursor: "cur_0",
      keywords: "engineer",
      location: "reg_1",
    });
  });

  it("prints the employee list (slim projection keeps paging/cursor)", async () => {
    const { runCompanyEmployees } = await import("../../src/commands/company.js");
    const out = makeOut();

    await runCompanyEmployees(client as never, { id: "112013061", account: "acc_1", json: true } as CompanyArgs, out);

    const written = (out.stdout.write as Mock).mock.calls.map((c) => c[0] as string).join("");
    const result = JSON.parse(written) as Record<string, unknown>;
    expect(result["object"]).toBe("company_employee_list");
    expect((result["items"] as unknown[])).toHaveLength(1);
    expect(result["paging"]).toEqual({ total_count: 1 });
    expect(result["cursor"]).toBeNull();
  });

  it("--preview → usage error exit 2 (read command)", async () => {
    const { runCompanyEmployees } = await import("../../src/commands/company.js");
    const out = makeOut();
    const exitSpy = mockExit();

    try {
      await runCompanyEmployees(client as never, { id: "112013061", account: "acc_1", preview: true } as CompanyArgs, out);
      expect.fail("Should have exited");
    } catch (e) {
      expect((e as Error).message).toContain("process.exit(2)");
    } finally {
      exitSpy.mockRestore();
    }
  });

  it("wrong usage: a non-numeric identifier — the server's 400 INVALID_REQUEST surfaces as exit 2", async () => {
    (accountNs.companies.employees as Mock).mockRejectedValue(makeInvalidRequestError());

    const { runCompanyEmployees } = await import("../../src/commands/company.js");
    const out = makeOut();
    const exitSpy = mockExit();

    try {
      await runCompanyEmployees(client as never, { id: "t-systems", account: "acc_1", json: true } as CompanyArgs, out);
      expect.fail("Should have exited");
    } catch (e) {
      expect((e as Error).message).toContain("process.exit(2)");
    } finally {
      exitSpy.mockRestore();
    }
    // The CLI does not duplicate the server-side numeric guard — it forwarded
    // the raw identifier and let the server's 400 come back.
    expect(accountNs.companies.employees).toHaveBeenCalledWith("t-systems", {});
  });
});

// ---------------------------------------------------------------------------
// company posts <id>
// ---------------------------------------------------------------------------

describe("company posts command", () => {
  let accountNs: ReturnType<typeof makeAccountNs>;
  let client: ReturnType<typeof makeClient>;

  beforeEach(() => {
    accountNs = makeAccountNs();
    client = makeClient(accountNs);
    (accountNs.companies.posts as Mock).mockResolvedValue({
      object: "company_post_list",
      items: [{ post_urn: "urn:li:activity:1", text: "We are hiring!", reaction_count: 1, comment_count: 0, author: { name: "Acme" } }],
      paging: { total_count: 1 },
      cursor: "cur_1",
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("company posts <cid> --account <id> --limit 3 — forwards limit as the only filter", async () => {
    const { runCompanyPosts } = await import("../../src/commands/company.js");
    const out = makeOut();

    await runCompanyPosts(client as never, { id: "112013061", account: "acc_1", json: true, limit: "3" } as CompanyArgs, out);

    expect(accountNs.companies.posts).toHaveBeenCalledWith("112013061", { limit: 3 });
  });

  it("prints post text verbatim (content pass-through)", async () => {
    const { runCompanyPosts } = await import("../../src/commands/company.js");
    const out = makeOut();

    await runCompanyPosts(client as never, { id: "112013061", account: "acc_1", json: true } as CompanyArgs, out);

    const written = (out.stdout.write as Mock).mock.calls.map((c) => c[0] as string).join("");
    const result = JSON.parse(written) as Record<string, unknown>;
    const items = result["items"] as Array<Record<string, unknown>>;
    expect(items[0]?.["text"]).toBe("We are hiring!");
  });
});

// ---------------------------------------------------------------------------
// company jobs <id>
// ---------------------------------------------------------------------------

describe("company jobs command", () => {
  let accountNs: ReturnType<typeof makeAccountNs>;
  let client: ReturnType<typeof makeClient>;

  beforeEach(() => {
    accountNs = makeAccountNs();
    client = makeClient(accountNs);
    (accountNs.companies.jobs as Mock).mockResolvedValue({
      object: "company_job_list",
      items: [{ job_urn: "urn:li:job:1", title: "Founders Associate", location: "Berlin", posted_at: "2026-06-01", easy_apply: true, company: { name: "Acme" } }],
      paging: { total_count: 1 },
      cursor: null,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("company jobs <cid> --account <id> --keywords founder — forwards keywords", async () => {
    const { runCompanyJobs } = await import("../../src/commands/company.js");
    const out = makeOut();

    await runCompanyJobs(client as never, { id: "112013061", account: "acc_1", json: true, keywords: "founder" } as CompanyArgs, out);

    expect(accountNs.companies.jobs).toHaveBeenCalledWith("112013061", { keywords: "founder" });
  });

  it("a valid-empty jobs result is not treated as an error", async () => {
    (accountNs.companies.jobs as Mock).mockResolvedValue({ object: "company_job_list", items: [], paging: { total_count: 0 }, cursor: null });

    const { runCompanyJobs } = await import("../../src/commands/company.js");
    const out = makeOut();

    await runCompanyJobs(client as never, { id: "112013061", account: "acc_1", json: true } as CompanyArgs, out);

    const written = (out.stdout.write as Mock).mock.calls.map((c) => c[0] as string).join("");
    const result = JSON.parse(written) as Record<string, unknown>;
    expect(result["items"]).toEqual([]);
    expect(result["paging"]).toEqual({ total_count: 0 });
  });
});

