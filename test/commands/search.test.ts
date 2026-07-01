/**
 * Tests for the `search` command group.
 * Key assertions: search people/companies/posts/jobs use POST body,
 * cursor/limit go to query (not body), --url seeds the body url field.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Mock } from "vitest";

function makeAccountNs() {
  return {
    search: {
      people: vi.fn(),
      companies: vi.fn(),
      posts: vi.fn(),
      jobs: vi.fn(),
      getParameters: vi.fn(),
    },
  };
}

function makeClient(accountNs: ReturnType<typeof makeAccountNs>) {
  return {
    account: vi.fn().mockReturnValue(accountNs),
  };
}

type SearchArgs = {
  keywords?: string;
  url?: string;
  type?: string;
  limit?: string;
  cursor?: string;
  all?: boolean;
  "max-pages"?: string;
  account?: string;
  json?: boolean;
  verbose?: boolean;
  preview?: boolean;
  fields?: string;
  "api-key"?: string;
  "base-url"?: string;
  timeout?: string;
  profile?: string;
  // filter escape hatch + named convenience flags
  filters?: string;
  "filters-file"?: string;
  industry?: string;
  location?: string;
  company?: string;
  "past-company"?: string;
  school?: string;
  "network-distance"?: string;
  "connections-of"?: string;
  "followers-of"?: string;
  "sort-by"?: string;
  "date-posted"?: string;
  "content-type"?: string;
  seniority?: string;
  function?: string;
  "employment-type"?: string;
  "job-type"?: string;
  region?: string;
  // People-specific filter flags
  title?: string;
  "profile-language"?: string;
};

function makeExitMock() {
  return vi.spyOn(process, "exit").mockImplementation((code?: number | string | null) => {
    throw new Error(`process.exit(${code})`);
  });
}

describe("search people", () => {
  let accountNs: ReturnType<typeof makeAccountNs>;
  let client: ReturnType<typeof makeClient>;

  beforeEach(() => {
    accountNs = makeAccountNs();
    client = makeClient(accountNs);
    (accountNs.search.people as Mock).mockResolvedValue({ object: "people_search_result", items: [], cursor: null });
    (accountNs.search.companies as Mock).mockResolvedValue({ object: "company_search_result", items: [], cursor: null });
    (accountNs.search.posts as Mock).mockResolvedValue({ object: "post_search_result", items: [], cursor: null });
    (accountNs.search.jobs as Mock).mockResolvedValue({ object: "job_search_result", items: [], cursor: null });
    (accountNs.search.getParameters as Mock).mockResolvedValue({ object: "search_parameter_list", parameters: [] });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("search people --keywords ai — calls search.people with body containing keywords", async () => {
    const { runSearchPeople } = await import("../../src/commands/search.js");
    const out = { stdout: { write: vi.fn() }, stderr: { write: vi.fn() } };

    await runSearchPeople(client as never, { keywords: "ai", account: "acc_1", json: true } as SearchArgs, out);

    expect(client.account).toHaveBeenCalledWith("acc_1");
    expect(accountNs.search.people).toHaveBeenCalledWith(
      expect.objectContaining({ keywords: "ai" }),
    );
  });

  it("search people --url <url> — passes url in body", async () => {
    const { runSearchPeople } = await import("../../src/commands/search.js");
    const out = { stdout: { write: vi.fn() }, stderr: { write: vi.fn() } };

    const searchUrl = "https://www.linkedin.com/search/results/people/?keywords=ai";
    await runSearchPeople(client as never, { url: searchUrl, account: "acc_1", json: true } as SearchArgs, out);

    expect(accountNs.search.people).toHaveBeenCalledWith(
      expect.objectContaining({ url: searchUrl }),
    );
  });

  it("search people --cursor c1 --limit 5 — passes cursor+limit to SDK method", async () => {
    const { runSearchPeople } = await import("../../src/commands/search.js");
    const out = { stdout: { write: vi.fn() }, stderr: { write: vi.fn() } };

    await runSearchPeople(client as never, {
      account: "acc_1",
      cursor: "c1",
      limit: "5",
      json: true,
    } as SearchArgs, out);

    // The SDK method receives cursor+limit merged into the body/query param
    // (the SDK internally splits them out to query)
    expect(accountNs.search.people).toHaveBeenCalledWith(
      expect.objectContaining({ cursor: "c1", limit: 5 }),
    );
  });

  it("search people --preview → usage error exit 2 (read command)", async () => {
    const { runSearchPeople } = await import("../../src/commands/search.js");
    const out = { stdout: { write: vi.fn() }, stderr: { write: vi.fn() } };

    const exitSpy = vi.spyOn(process, "exit").mockImplementation((code?: number | string | null) => { throw new Error(`process.exit(${code})`); });
    try {
      await runSearchPeople(client as never, { account: "acc_1", preview: true } as SearchArgs, out);
      expect.fail("Should have exited");
    } catch (e) {
      expect((e as Error).message).toContain("process.exit(2)");
    } finally {
      exitSpy.mockRestore();
    }
  });

  it("search people --all — streams NDJSON over 2 pages", async () => {
    const { runSearchPeople } = await import("../../src/commands/search.js");
    const out = { stdout: { write: vi.fn() }, stderr: { write: vi.fn() } };

    (accountNs.search.people as Mock)
      .mockResolvedValueOnce({ items: [{ id: "p1" }, { id: "p2" }], cursor: "c1" })
      .mockResolvedValueOnce({ items: [{ id: "p3" }], cursor: null });

    await runSearchPeople(client as never, { account: "acc_1", all: true } as SearchArgs, out);

    const writtenLines = (out.stdout.write as Mock).mock.calls.map((c) => c[0] as string);
    const ndjsonLines = writtenLines.filter((l) => l.trim().startsWith("{"));
    expect(ndjsonLines).toHaveLength(3);
  });
});

describe("search people — filters escape hatch + named flags", () => {
  let accountNs: ReturnType<typeof makeAccountNs>;
  let client: ReturnType<typeof makeClient>;

  beforeEach(() => {
    accountNs = makeAccountNs();
    client = makeClient(accountNs);
    (accountNs.search.people as Mock).mockResolvedValue({ items: [], cursor: null });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("--filters '<json>' merges the parsed object into the POST body verbatim", async () => {
    const { runSearchPeople } = await import("../../src/commands/search.js");
    const out = { stdout: { write: vi.fn() }, stderr: { write: vi.fn() } };

    await runSearchPeople(client as never, {
      account: "acc_1",
      filters: '{"open_to":["recruiters"],"profile_language":["en"]}',
      json: true,
    } as SearchArgs, out);

    const body = (accountNs.search.people as Mock).mock.calls[0]![0] as Record<string, unknown>;
    expect(body).toEqual({ open_to: ["recruiters"], profile_language: ["en"] });
  });

  it("--keywords + --filters combine (keywords merges over filters)", async () => {
    const { runSearchPeople } = await import("../../src/commands/search.js");
    const out = { stdout: { write: vi.fn() }, stderr: { write: vi.fn() } };

    await runSearchPeople(client as never, {
      account: "acc_1",
      keywords: "ml",
      filters: '{"industry":["96"]}',
      json: true,
    } as SearchArgs, out);

    const body = (accountNs.search.people as Mock).mock.calls[0]![0] as Record<string, unknown>;
    expect(body).toEqual({ industry: ["96"], keywords: "ml" });
  });

  it("named flags map to the exact API field names (string arrays comma-split)", async () => {
    const { runSearchPeople } = await import("../../src/commands/search.js");
    const out = { stdout: { write: vi.fn() }, stderr: { write: vi.fn() } };

    await runSearchPeople(client as never, {
      account: "acc_1",
      industry: "96,4",
      location: "103644278",
      company: "1441",
      "past-company": "111",
      school: "222",
      "network-distance": "1,2",
      "connections-of": "ACoAAB",
      "followers-of": "ACoAAC",
      json: true,
    } as SearchArgs, out);

    const body = (accountNs.search.people as Mock).mock.calls[0]![0] as Record<string, unknown>;
    expect(body).toEqual({
      industry: ["96", "4"],
      location: ["103644278"],
      company: ["1441"],
      past_company: ["111"],
      school: ["222"],
      network_distance: [1, 2],
      connections_of: "ACoAAB",
      followers_of: "ACoAAC",
    });
  });

  it("named flags merge OVER --filters for the same key", async () => {
    const { runSearchPeople } = await import("../../src/commands/search.js");
    const out = { stdout: { write: vi.fn() }, stderr: { write: vi.fn() } };

    await runSearchPeople(client as never, {
      account: "acc_1",
      filters: '{"industry":["OLD"],"keywords":"from-filters"}',
      industry: "96",
      json: true,
    } as SearchArgs, out);

    const body = (accountNs.search.people as Mock).mock.calls[0]![0] as Record<string, unknown>;
    expect(body["industry"]).toEqual(["96"]);
    expect(body["keywords"]).toBe("from-filters");
  });

  it("bad --filters JSON exits 2 before any SDK call", async () => {
    const { runSearchPeople } = await import("../../src/commands/search.js");
    const out = { stdout: { write: vi.fn() }, stderr: { write: vi.fn() } };
    const exitSpy = makeExitMock();

    try {
      await runSearchPeople(client as never, {
        account: "acc_1",
        filters: "{ not valid json ",
      } as SearchArgs, out);
      expect.fail("should have exited");
    } catch (e) {
      expect((e as Error).message).toContain("process.exit(2)");
    } finally {
      exitSpy.mockRestore();
    }
    expect(accountNs.search.people).not.toHaveBeenCalled();
  });

  it("non-object --filters (array) exits 2 before any SDK call", async () => {
    const { runSearchPeople } = await import("../../src/commands/search.js");
    const out = { stdout: { write: vi.fn() }, stderr: { write: vi.fn() } };
    const exitSpy = makeExitMock();

    try {
      await runSearchPeople(client as never, {
        account: "acc_1",
        filters: "[1,2,3]",
      } as SearchArgs, out);
      expect.fail("should have exited");
    } catch (e) {
      expect((e as Error).message).toContain("process.exit(2)");
    } finally {
      exitSpy.mockRestore();
    }
    expect(accountNs.search.people).not.toHaveBeenCalled();
  });
});

describe("search companies / posts / jobs", () => {
  let accountNs: ReturnType<typeof makeAccountNs>;
  let client: ReturnType<typeof makeClient>;

  beforeEach(() => {
    accountNs = makeAccountNs();
    client = makeClient(accountNs);
    (accountNs.search.companies as Mock).mockResolvedValue({ items: [], cursor: null });
    (accountNs.search.posts as Mock).mockResolvedValue({ items: [], cursor: null });
    (accountNs.search.jobs as Mock).mockResolvedValue({ items: [], cursor: null });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("search companies --keywords acme — calls search.companies", async () => {
    const { runSearchCompanies } = await import("../../src/commands/search.js");
    const out = { stdout: { write: vi.fn() }, stderr: { write: vi.fn() } };

    await runSearchCompanies(client as never, { keywords: "acme", account: "acc_1", json: true } as SearchArgs, out);

    expect(accountNs.search.companies).toHaveBeenCalledWith(
      expect.objectContaining({ keywords: "acme" }),
    );
  });

  it("search companies --url <url> — passes url in body (newly declared flag)", async () => {
    const { runSearchCompanies } = await import("../../src/commands/search.js");
    const out = { stdout: { write: vi.fn() }, stderr: { write: vi.fn() } };

    const searchUrl = "https://www.linkedin.com/search/results/companies/?keywords=acme";
    await runSearchCompanies(client as never, { url: searchUrl, account: "acc_1", json: true } as SearchArgs, out);

    expect(accountNs.search.companies).toHaveBeenCalledWith(
      expect.objectContaining({ url: searchUrl }),
    );
  });

  it("search companies named flags + --filters map to exact API fields", async () => {
    const { runSearchCompanies } = await import("../../src/commands/search.js");
    const out = { stdout: { write: vi.fn() }, stderr: { write: vi.fn() } };

    await runSearchCompanies(client as never, {
      account: "acc_1",
      industry: "96",
      location: "103644278",
      "network-distance": "1",
      filters: '{"has_job_offers":true}',
      json: true,
    } as SearchArgs, out);

    const body = (accountNs.search.companies as Mock).mock.calls[0]![0] as Record<string, unknown>;
    expect(body).toEqual({
      has_job_offers: true,
      industry: ["96"],
      location: ["103644278"],
      network_distance: [1],
    });
  });

  it("search posts --keywords ai — calls search.posts", async () => {
    const { runSearchPosts } = await import("../../src/commands/search.js");
    const out = { stdout: { write: vi.fn() }, stderr: { write: vi.fn() } };

    await runSearchPosts(client as never, { keywords: "ai", account: "acc_1", json: true } as SearchArgs, out);

    expect(accountNs.search.posts).toHaveBeenCalledWith(
      expect.objectContaining({ keywords: "ai" }),
    );
  });

  it("search posts --url + named scalar flags map to exact API fields", async () => {
    const { runSearchPosts } = await import("../../src/commands/search.js");
    const out = { stdout: { write: vi.fn() }, stderr: { write: vi.fn() } };

    const searchUrl = "https://www.linkedin.com/search/results/content/?keywords=ai";
    await runSearchPosts(client as never, {
      account: "acc_1",
      url: searchUrl,
      "sort-by": "relevance",
      "date-posted": "past-week",
      "content-type": "videos",
      json: true,
    } as SearchArgs, out);

    const body = (accountNs.search.posts as Mock).mock.calls[0]![0] as Record<string, unknown>;
    expect(body).toEqual({
      url: searchUrl,
      sort_by: "relevance",
      date_posted: "past_week",  // hyphen → underscore normalized
      content_type: "videos",
    });
  });

  it("search jobs --keywords engineer — calls search.jobs", async () => {
    const { runSearchJobs } = await import("../../src/commands/search.js");
    const out = { stdout: { write: vi.fn() }, stderr: { write: vi.fn() } };

    await runSearchJobs(client as never, { keywords: "engineer", account: "acc_1", json: true } as SearchArgs, out);

    expect(accountNs.search.jobs).toHaveBeenCalledWith(
      expect.objectContaining({ keywords: "engineer" }),
    );
  });

  it("search jobs --url + named flags (string arrays + scalars) map to exact API fields", async () => {
    const { runSearchJobs } = await import("../../src/commands/search.js");
    const out = { stdout: { write: vi.fn() }, stderr: { write: vi.fn() } };

    const searchUrl = "https://www.linkedin.com/jobs/search/?keywords=engineer";
    await runSearchJobs(client as never, {
      account: "acc_1",
      url: searchUrl,
      location: "103644278,90000084",
      industry: "96",
      seniority: "3",
      function: "eng",
      "job-type": "F",
      company: "1441",
      "sort-by": "DD",
      region: "eu",
      filters: '{"easy_apply":true}',
      json: true,
    } as SearchArgs, out);

    const body = (accountNs.search.jobs as Mock).mock.calls[0]![0] as Record<string, unknown>;
    // --location on jobs maps to body region (single string, not location array).
    // When both --location and --region are supplied, --region wins (applied last).
    expect(body).toEqual({
      easy_apply: true,
      url: searchUrl,
      industry: ["96"],
      seniority: ["3"],
      function: ["eng"],
      job_type: ["F"],
      company: ["1441"],
      sort_by: "DD",
      region: "eu",  // --region wins over --location on jobs
    });
  });

  it("search jobs bad --filters exits 2 before any SDK call", async () => {
    const { runSearchJobs } = await import("../../src/commands/search.js");
    const out = { stdout: { write: vi.fn() }, stderr: { write: vi.fn() } };
    const exitSpy = makeExitMock();

    try {
      await runSearchJobs(client as never, {
        account: "acc_1",
        filters: "{bad",
      } as SearchArgs, out);
      expect.fail("should have exited");
    } catch (e) {
      expect((e as Error).message).toContain("process.exit(2)");
    } finally {
      exitSpy.mockRestore();
    }
    expect(accountNs.search.jobs).not.toHaveBeenCalled();
  });
});

describe("search parameters — GET, not paginated", () => {
  let accountNs: ReturnType<typeof makeAccountNs>;
  let client: ReturnType<typeof makeClient>;

  beforeEach(() => {
    accountNs = makeAccountNs();
    client = makeClient(accountNs);
    (accountNs.search.getParameters as Mock).mockResolvedValue({ parameters: [] });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("search parameters --type LOCATION --keywords london — calls getParameters", async () => {
    const { runSearchParameters } = await import("../../src/commands/search.js");
    const out = { stdout: { write: vi.fn() }, stderr: { write: vi.fn() } };

    await runSearchParameters(client as never, {
      type: "LOCATION",
      keywords: "london",
      account: "acc_1",
      json: true,
    } as SearchArgs, out);

    expect(accountNs.search.getParameters).toHaveBeenCalledWith(
      expect.objectContaining({ type: "LOCATION", keywords: "london" }),
    );
  });

  it("search parameters --preview → usage error exit 2", async () => {
    const { runSearchParameters } = await import("../../src/commands/search.js");
    const out = { stdout: { write: vi.fn() }, stderr: { write: vi.fn() } };

    const exitSpy = vi.spyOn(process, "exit").mockImplementation((code?: number | string | null) => { throw new Error(`process.exit(${code})`); });
    try {
      await runSearchParameters(client as never, {
        type: "LOCATION",
        account: "acc_1",
        preview: true,
      } as SearchArgs, out);
      expect.fail("Should have exited");
    } catch (e) {
      expect((e as Error).message).toContain("process.exit(2)");
    } finally {
      exitSpy.mockRestore();
    }
  });

  it("search parameters --all → usage error exit 2 (non-paginated)", async () => {
    const { runSearchParameters } = await import("../../src/commands/search.js");
    const out = { stdout: { write: vi.fn() }, stderr: { write: vi.fn() } };

    const exitSpy = vi.spyOn(process, "exit").mockImplementation((code?: number | string | null) => { throw new Error(`process.exit(${code})`); });
    try {
      await runSearchParameters(client as never, {
        type: "LOCATION",
        account: "acc_1",
        all: true,
      } as SearchArgs, out);
      expect.fail("Should have exited");
    } catch (e) {
      expect((e as Error).message).toContain("process.exit(2)");
    } finally {
      exitSpy.mockRestore();
    }
  });
});

// ---------------------------------------------------------------------------
// search people new filter flags + invalid-flag rejection
// ---------------------------------------------------------------------------

describe("search people filter flags (title, profile-language, invalid-flag rejection)", () => {
  let accountNs: ReturnType<typeof makeAccountNs>;
  let client: ReturnType<typeof makeClient>;

  beforeEach(() => {
    accountNs = makeAccountNs();
    client = makeClient(accountNs);
    (accountNs.search.people as Mock).mockResolvedValue({ items: [], cursor: null });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("--title maps to advanced_keywords.title (keyword string, not id)", async () => {
    const { runSearchPeople } = await import("../../src/commands/search.js");
    const out = { stdout: { write: vi.fn() }, stderr: { write: vi.fn() } };

    await runSearchPeople(client as never, {
      account: "acc_1",
      title: "AI Engineer",
      json: true,
    } as SearchArgs, out);

    const body = (accountNs.search.people as Mock).mock.calls[0]![0] as Record<string, unknown>;
    expect(body["advanced_keywords"]).toEqual({ title: "AI Engineer" });
  });

  it("--title merges INTO existing advanced_keywords from --filters (named flag wins on conflict)", async () => {
    const { runSearchPeople } = await import("../../src/commands/search.js");
    const out = { stdout: { write: vi.fn() }, stderr: { write: vi.fn() } };

    await runSearchPeople(client as never, {
      account: "acc_1",
      filters: '{"advanced_keywords":{"company":"Acme","title":"OLD"}}',
      title: "AI Engineer",
      json: true,
    } as SearchArgs, out);

    const body = (accountNs.search.people as Mock).mock.calls[0]![0] as Record<string, unknown>;
    // title overrides, company preserved (merge not overwrite)
    expect(body["advanced_keywords"]).toEqual({ company: "Acme", title: "AI Engineer" });
  });

  it("--profile-language maps to profile_language (comma-split array)", async () => {
    const { runSearchPeople } = await import("../../src/commands/search.js");
    const out = { stdout: { write: vi.fn() }, stderr: { write: vi.fn() } };

    await runSearchPeople(client as never, {
      account: "acc_1",
      "profile-language": "en,de,fr",
      json: true,
    } as SearchArgs, out);

    const body = (accountNs.search.people as Mock).mock.calls[0]![0] as Record<string, unknown>;
    expect(body["profile_language"]).toEqual(["en", "de", "fr"]);
  });

  it("--seniority on people → exit 2 (invalid on classic search)", async () => {
    const { runSearchPeople } = await import("../../src/commands/search.js");
    const out = { stdout: { write: vi.fn() }, stderr: { write: vi.fn() } };
    const exitSpy = makeExitMock();

    try {
      await runSearchPeople(client as never, {
        account: "acc_1",
        seniority: "3",
        json: true,
      } as SearchArgs, out);
      expect.fail("should have exited");
    } catch (e) {
      expect((e as Error).message).toContain("process.exit(2)");
    } finally {
      exitSpy.mockRestore();
    }
    expect(accountNs.search.people).not.toHaveBeenCalled();
  });

  it("--function on people → exit 2 (invalid on classic search)", async () => {
    const { runSearchPeople } = await import("../../src/commands/search.js");
    const out = { stdout: { write: vi.fn() }, stderr: { write: vi.fn() } };
    const exitSpy = makeExitMock();

    try {
      await runSearchPeople(client as never, {
        account: "acc_1",
        function: "eng",
        json: true,
      } as SearchArgs, out);
      expect.fail("should have exited");
    } catch (e) {
      expect((e as Error).message).toContain("process.exit(2)");
    } finally {
      exitSpy.mockRestore();
    }
    expect(accountNs.search.people).not.toHaveBeenCalled();
  });

  it("--employment-type on people → exit 2 (invalid on classic search)", async () => {
    const { runSearchPeople } = await import("../../src/commands/search.js");
    const out = { stdout: { write: vi.fn() }, stderr: { write: vi.fn() } };
    const exitSpy = makeExitMock();

    try {
      await runSearchPeople(client as never, {
        account: "acc_1",
        "employment-type": "F",
        json: true,
      } as SearchArgs, out);
      expect.fail("should have exited");
    } catch (e) {
      expect((e as Error).message).toContain("process.exit(2)");
    } finally {
      exitSpy.mockRestore();
    }
    expect(accountNs.search.people).not.toHaveBeenCalled();
  });

  it("--sort-by on people → exit 2 (invalid on classic search)", async () => {
    const { runSearchPeople } = await import("../../src/commands/search.js");
    const out = { stdout: { write: vi.fn() }, stderr: { write: vi.fn() } };
    const exitSpy = makeExitMock();

    try {
      await runSearchPeople(client as never, {
        account: "acc_1",
        "sort-by": "recent",
        json: true,
      } as SearchArgs, out);
      expect.fail("should have exited");
    } catch (e) {
      expect((e as Error).message).toContain("process.exit(2)");
    } finally {
      exitSpy.mockRestore();
    }
    expect(accountNs.search.people).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// search jobs --location → body region (single string)
// ---------------------------------------------------------------------------

describe("search jobs --location maps to region body field", () => {
  let accountNs: ReturnType<typeof makeAccountNs>;
  let client: ReturnType<typeof makeClient>;

  beforeEach(() => {
    accountNs = makeAccountNs();
    client = makeClient(accountNs);
    (accountNs.search.jobs as Mock).mockResolvedValue({ items: [], cursor: null });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("--location on jobs maps to body region (single string, not location array)", async () => {
    const { runSearchJobs } = await import("../../src/commands/search.js");
    const out = { stdout: { write: vi.fn() }, stderr: { write: vi.fn() } };

    await runSearchJobs(client as never, {
      account: "acc_1",
      location: "103644278",
      json: true,
    } as SearchArgs, out);

    const body = (accountNs.search.jobs as Mock).mock.calls[0]![0] as Record<string, unknown>;
    expect(body["region"]).toBe("103644278");
    expect(body["location"]).toBeUndefined();
  });

  it("--region on jobs maps to body region (alias)", async () => {
    const { runSearchJobs } = await import("../../src/commands/search.js");
    const out = { stdout: { write: vi.fn() }, stderr: { write: vi.fn() } };

    await runSearchJobs(client as never, {
      account: "acc_1",
      region: "eu",
      json: true,
    } as SearchArgs, out);

    const body = (accountNs.search.jobs as Mock).mock.calls[0]![0] as Record<string, unknown>;
    expect(body["region"]).toBe("eu");
  });

  it("--location on people/companies still maps to location array (unchanged)", async () => {
    const { runSearchPeople } = await import("../../src/commands/search.js");
    (accountNs.search.people as Mock).mockResolvedValue({ items: [], cursor: null });
    const out = { stdout: { write: vi.fn() }, stderr: { write: vi.fn() } };

    await runSearchPeople(client as never, {
      account: "acc_1",
      location: "103644278",
      json: true,
    } as SearchArgs, out);

    const body = (accountNs.search.people as Mock).mock.calls[0]![0] as Record<string, unknown>;
    expect(body["location"]).toEqual(["103644278"]);
    expect(body["region"]).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// search posts --date-posted hyphen → underscore normalization
// ---------------------------------------------------------------------------

describe("search posts --date-posted normalization (hyphen to underscore)", () => {
  let accountNs: ReturnType<typeof makeAccountNs>;
  let client: ReturnType<typeof makeClient>;

  beforeEach(() => {
    accountNs = makeAccountNs();
    client = makeClient(accountNs);
    (accountNs.search.posts as Mock).mockResolvedValue({ items: [], cursor: null });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("past-day alias normalizes to past_day", async () => {
    const { runSearchPosts } = await import("../../src/commands/search.js");
    const out = { stdout: { write: vi.fn() }, stderr: { write: vi.fn() } };

    await runSearchPosts(client as never, {
      account: "acc_1",
      "date-posted": "past-day",
      json: true,
    } as SearchArgs, out);

    const body = (accountNs.search.posts as Mock).mock.calls[0]![0] as Record<string, unknown>;
    expect(body["date_posted"]).toBe("past_day");
  });

  it("past-week alias normalizes to past_week", async () => {
    const { runSearchPosts } = await import("../../src/commands/search.js");
    const out = { stdout: { write: vi.fn() }, stderr: { write: vi.fn() } };

    await runSearchPosts(client as never, {
      account: "acc_1",
      "date-posted": "past-week",
      json: true,
    } as SearchArgs, out);

    const body = (accountNs.search.posts as Mock).mock.calls[0]![0] as Record<string, unknown>;
    expect(body["date_posted"]).toBe("past_week");
  });

  it("past-month alias normalizes to past_month", async () => {
    const { runSearchPosts } = await import("../../src/commands/search.js");
    const out = { stdout: { write: vi.fn() }, stderr: { write: vi.fn() } };

    await runSearchPosts(client as never, {
      account: "acc_1",
      "date-posted": "past-month",
      json: true,
    } as SearchArgs, out);

    const body = (accountNs.search.posts as Mock).mock.calls[0]![0] as Record<string, unknown>;
    expect(body["date_posted"]).toBe("past_month");
  });

  it("already-underscore value passes through unchanged", async () => {
    const { runSearchPosts } = await import("../../src/commands/search.js");
    const out = { stdout: { write: vi.fn() }, stderr: { write: vi.fn() } };

    await runSearchPosts(client as never, {
      account: "acc_1",
      "date-posted": "past_week",
      json: true,
    } as SearchArgs, out);

    const body = (accountNs.search.posts as Mock).mock.calls[0]![0] as Record<string, unknown>;
    expect(body["date_posted"]).toBe("past_week");
  });
});

// ---------------------------------------------------------------------------
// --all truncation: JSON sentinel to stdout, not prose to stderr
// ---------------------------------------------------------------------------

describe("--all truncation: JSON object written to stdout", () => {
  let accountNs: ReturnType<typeof makeAccountNs>;
  let client: ReturnType<typeof makeClient>;

  beforeEach(() => {
    accountNs = makeAccountNs();
    client = makeClient(accountNs);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("search people --all truncated → last stdout line is stream_truncated JSON object", async () => {
    const { runSearchPeople } = await import("../../src/commands/search.js");
    const out = { stdout: { write: vi.fn() }, stderr: { write: vi.fn() } };

    // Two pages with cursor — max-pages=1 triggers truncation after page 1
    (accountNs.search.people as Mock)
      .mockResolvedValueOnce({ items: [{ id: "p1" }], cursor: "c1" })
      .mockResolvedValueOnce({ items: [{ id: "p2" }], cursor: null });

    await runSearchPeople(client as never, {
      account: "acc_1",
      all: true,
      "max-pages": "1",
    } as SearchArgs, out);

    const writtenLines = (out.stdout.write as Mock).mock.calls.map((c) => c[0] as string);
    const lastLine = writtenLines[writtenLines.length - 1]!.trim();
    const parsed = JSON.parse(lastLine) as Record<string, unknown>;
    expect(parsed["object"]).toBe("stream_truncated");
    expect(parsed["pages_fetched"]).toBe(1);
    expect(parsed["has_more"]).toBe(true);
    // Nothing on stderr about truncation (no prose)
    expect((out.stderr.write as Mock).mock.calls.some((c) => String(c[0]).includes("truncated"))).toBe(false);
  });

  it("search jobs --all truncated → last stdout line is stream_truncated JSON", async () => {
    const { runSearchJobs } = await import("../../src/commands/search.js");
    const out = { stdout: { write: vi.fn() }, stderr: { write: vi.fn() } };

    (accountNs.search.jobs as Mock)
      .mockResolvedValueOnce({ items: [{ job_urn: "j1" }], cursor: "c1" })
      .mockResolvedValueOnce({ items: [{ job_urn: "j2" }], cursor: null });

    await runSearchJobs(client as never, {
      account: "acc_1",
      all: true,
      "max-pages": "1",
    } as SearchArgs, out);

    const writtenLines = (out.stdout.write as Mock).mock.calls.map((c) => c[0] as string);
    const lastLine = writtenLines[writtenLines.length - 1]!.trim();
    const parsed = JSON.parse(lastLine) as Record<string, unknown>;
    expect(parsed["object"]).toBe("stream_truncated");
    expect(parsed["pages_fetched"]).toBe(1);
    expect(parsed["has_more"]).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// search people slim defaults
// ---------------------------------------------------------------------------

describe("search people slim: correct field names, excluded fields, verbose restores", () => {
  const peopleItem = {
    id: "abc123",
    full_name: "Alice Smith",
    public_identifier: "alice-smith",
    headline: "AI Engineer",
    location: "Berlin, Germany",
    network_distance: "DISTANCE_2",
    avatar_url: "https://example.com/pic.jpg",
    linkedin_urn: "urn:li:member:123",
    is_premium: false,
    is_open_profile: false,
  };

  const sdkResponse = {
    object: "people_search_result",
    items: [peopleItem],
    config: { params: {} },
    paging: { start: 0, page_count: 1, total_count: 1 },
    cursor: null,
  };

  let accountNs: ReturnType<typeof makeAccountNs>;
  let client: ReturnType<typeof makeClient>;

  beforeEach(() => {
    accountNs = makeAccountNs();
    client = makeClient(accountNs);
    (accountNs.search.people as Mock).mockResolvedValue(sdkResponse);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("slim mode: contains id/full_name/public_identifier/headline/location/network_distance ONLY", async () => {
    const { runSearchPeople } = await import("../../src/commands/search.js");
    const out = { stdout: { write: vi.fn() }, stderr: { write: vi.fn() } };

    await runSearchPeople(client as never, { keywords: "ai", account: "acc_1", json: true } as SearchArgs, out);

    const written = (out.stdout.write as Mock).mock.calls.map((c) => c[0] as string).join("");
    const result = JSON.parse(written) as { items: Array<Record<string, unknown>> };
    const item = result.items[0]!;

    // Expected slim fields
    expect(item["id"]).toBe("abc123");
    expect(item["full_name"]).toBe("Alice Smith");
    expect(item["public_identifier"]).toBe("alice-smith");
    expect(item["headline"]).toBe("AI Engineer");
    expect(item["location"]).toBe("Berlin, Germany");
    expect(item["network_distance"]).toBe("DISTANCE_2");

    // Excluded verbose-only fields
    expect(item["avatar_url"]).toBeUndefined();
    expect(item["linkedin_urn"]).toBeUndefined();
    expect(item["is_premium"]).toBeUndefined();
    expect(item["is_open_profile"]).toBeUndefined();

    // Must NOT use old incorrect field names
    expect(item["provider_id"]).toBeUndefined();
    expect(item["first_name"]).toBeUndefined();
    expect(item["last_name"]).toBeUndefined();
  });

  it("--verbose restores avatar_url, linkedin_urn, is_premium", async () => {
    const { runSearchPeople } = await import("../../src/commands/search.js");
    const out = { stdout: { write: vi.fn() }, stderr: { write: vi.fn() } };

    await runSearchPeople(client as never, { keywords: "ai", account: "acc_1", json: true, verbose: true } as SearchArgs, out);

    const written = (out.stdout.write as Mock).mock.calls.map((c) => c[0] as string).join("");
    const result = JSON.parse(written) as { items: Array<Record<string, unknown>> };
    const item = result.items[0]!;
    expect(item["avatar_url"]).toBe("https://example.com/pic.jpg");
    expect(item["linkedin_urn"]).toBe("urn:li:member:123");
    expect(item["is_premium"]).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// search companies slim defaults
// ---------------------------------------------------------------------------

describe("search companies slim: field set, industry conditional omission", () => {
  let accountNs: ReturnType<typeof makeAccountNs>;
  let client: ReturnType<typeof makeClient>;

  beforeEach(() => {
    accountNs = makeAccountNs();
    client = makeClient(accountNs);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("slim mode: id/name/industry/location/followers_count; excludes summary/headcount/profile_url", async () => {
    const { runSearchCompanies } = await import("../../src/commands/search.js");
    const out = { stdout: { write: vi.fn() }, stderr: { write: vi.fn() } };

    (accountNs.search.companies as Mock).mockResolvedValue({
      items: [{
        id: "c1",
        name: "Acme AI",
        industry: ["technology", "internet"],
        location: "San Francisco, CA",
        followers_count: 5000,
        summary: "AI solutions",
        headcount: "51-200",
        profile_url: "https://linkedin.com/company/acme",
      }],
      cursor: null,
    });

    await runSearchCompanies(client as never, { keywords: "ai", account: "acc_1", json: true } as SearchArgs, out);

    const written = (out.stdout.write as Mock).mock.calls.map((c) => c[0] as string).join("");
    const result = JSON.parse(written) as { items: Array<Record<string, unknown>> };
    const item = result.items[0]!;

    expect(item["id"]).toBe("c1");
    expect(item["name"]).toBe("Acme AI");
    expect(item["industry"]).toEqual(["technology", "internet"]);
    expect(item["location"]).toBe("San Francisco, CA");
    expect(item["followers_count"]).toBe(5000);
    expect(item["summary"]).toBeUndefined();
    expect(item["headcount"]).toBeUndefined();
    expect(item["profile_url"]).toBeUndefined();
  });

  it("industry key ABSENT (not null/empty) when not returned by server", async () => {
    const { runSearchCompanies } = await import("../../src/commands/search.js");
    const out = { stdout: { write: vi.fn() }, stderr: { write: vi.fn() } };

    (accountNs.search.companies as Mock).mockResolvedValue({
      items: [{ id: "c2", name: "BetaCo", location: null, followers_count: null }],
      cursor: null,
    });

    await runSearchCompanies(client as never, { keywords: "ai", account: "acc_1", json: true } as SearchArgs, out);

    const written = (out.stdout.write as Mock).mock.calls.map((c) => c[0] as string).join("");
    const result = JSON.parse(written) as { items: Array<Record<string, unknown>> };
    const item = result.items[0]!;

    expect(item["id"]).toBe("c2");
    expect(Object.prototype.hasOwnProperty.call(item, "industry")).toBe(false);
  });

  it("--verbose restores summary, headcount, profile_url", async () => {
    const { runSearchCompanies } = await import("../../src/commands/search.js");
    const out = { stdout: { write: vi.fn() }, stderr: { write: vi.fn() } };

    (accountNs.search.companies as Mock).mockResolvedValue({
      items: [{
        id: "c1", name: "Acme AI",
        summary: "AI solutions", headcount: "51-200", profile_url: "https://linkedin.com/company/acme",
      }],
      cursor: null,
    });

    await runSearchCompanies(client as never, { keywords: "ai", account: "acc_1", json: true, verbose: true } as SearchArgs, out);

    const written = (out.stdout.write as Mock).mock.calls.map((c) => c[0] as string).join("");
    const result = JSON.parse(written) as { items: Array<Record<string, unknown>> };
    const item = result.items[0]!;
    expect(item["summary"]).toBe("AI solutions");
    expect(item["headcount"]).toBe("51-200");
    expect(item["profile_url"]).toBe("https://linkedin.com/company/acme");
  });
});

// ---------------------------------------------------------------------------
// search jobs slim defaults
// ---------------------------------------------------------------------------

describe("search jobs slim: company_name synthesized from nested company.name, verbose restores raw company object", () => {
  // REQ-164 regression fixture: NO top-level company_name key anywhere — only
  // the nested company.name. A projector reading item["company_name"] directly
  // would emit null here; only reading company.name passes.
  const jobItem = {
    job_urn: "urn:li:job:1",
    title: "AI Engineer",
    location: "Berlin, Germany",
    posted_at: "2026-01-01T00:00:00Z",
    easy_apply: true,
    company: { id: "c1", name: "Acme AI", logo_url: "https://logo.example.com" },
    reference_id: "ref_abc",
    url: "https://linkedin.com/jobs/view/1",
    reposted: false,
    promoted: false,
    benefits: [],
  };

  let accountNs: ReturnType<typeof makeAccountNs>;
  let client: ReturnType<typeof makeClient>;

  beforeEach(() => {
    accountNs = makeAccountNs();
    client = makeClient(accountNs);
    (accountNs.search.jobs as Mock).mockResolvedValue({ items: [jobItem], cursor: null });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("slim mode: company_name derived from nested company.name (no top-level key exists)", async () => {
    const { runSearchJobs } = await import("../../src/commands/search.js");
    const out = { stdout: { write: vi.fn() }, stderr: { write: vi.fn() } };

    await runSearchJobs(client as never, { keywords: "ai", account: "acc_1", json: true } as SearchArgs, out);

    const written = (out.stdout.write as Mock).mock.calls.map((c) => c[0] as string).join("");
    const result = JSON.parse(written) as { items: Array<Record<string, unknown>> };
    const item = result.items[0]!;

    expect(item["job_urn"]).toBe("urn:li:job:1");
    expect(item["title"]).toBe("AI Engineer");
    expect(item["location"]).toBe("Berlin, Germany");
    // This is the REQ-164 regression assertion: derived from company.name, not
    // a flat item["company_name"] passthrough (which does not exist on the fixture).
    expect(item["company_name"]).toBe("Acme AI");
    expect(item["posted_at"]).toBe("2026-01-01T00:00:00Z");
    expect(item["easy_apply"]).toBe(true);
    expect(item["company"]).toBeUndefined();
    expect(item["reference_id"]).toBeUndefined();
    expect(item["url"]).toBeUndefined();
    expect(item["reposted"]).toBeUndefined();
    expect(item["promoted"]).toBeUndefined();
    expect(item["benefits"]).toBeUndefined();
  });

  it("--verbose restores the raw company nested object; company_name is NOT synthesized in verbose", async () => {
    const { runSearchJobs } = await import("../../src/commands/search.js");
    const out = { stdout: { write: vi.fn() }, stderr: { write: vi.fn() } };

    await runSearchJobs(client as never, { keywords: "ai", account: "acc_1", json: true, verbose: true } as SearchArgs, out);

    const written = (out.stdout.write as Mock).mock.calls.map((c) => c[0] as string).join("");
    const result = JSON.parse(written) as { items: Array<Record<string, unknown>> };
    const item = result.items[0]!;
    expect(item["company"]).toEqual({ id: "c1", name: "Acme AI", logo_url: "https://logo.example.com" });
    // --verbose prints the raw response verbatim (no synthesis) — the raw
    // response has no top-level company_name key at all.
    expect(item["company_name"]).toBeUndefined();
  });

  it("company: null (REQ-177 — agency/confidential listing) → slim company_name is null, no crash", async () => {
    (accountNs.search.jobs as Mock).mockResolvedValue({
      items: [{ ...jobItem, company: null }],
      cursor: null,
    });
    const { runSearchJobs } = await import("../../src/commands/search.js");
    const out = { stdout: { write: vi.fn() }, stderr: { write: vi.fn() } };

    await runSearchJobs(client as never, { keywords: "ai", account: "acc_1", json: true } as SearchArgs, out);

    const written = (out.stdout.write as Mock).mock.calls.map((c) => c[0] as string).join("");
    const result = JSON.parse(written) as { items: Array<Record<string, unknown>> };
    const item = result.items[0]!;
    expect(item["company_name"]).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// search posts slim: 200-char text truncation + author.name only
// ---------------------------------------------------------------------------

describe("search posts slim: text truncation and author projection", () => {
  let accountNs: ReturnType<typeof makeAccountNs>;
  let client: ReturnType<typeof makeClient>;

  beforeEach(() => {
    accountNs = makeAccountNs();
    client = makeClient(accountNs);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("text >200 chars truncated to 200 chars in slim mode", async () => {
    const { runSearchPosts } = await import("../../src/commands/search.js");
    const out = { stdout: { write: vi.fn() }, stderr: { write: vi.fn() } };

    (accountNs.search.posts as Mock).mockResolvedValue({
      items: [{
        post_urn: "urn:li:activity:123",
        posted_at: "2026-01-01T00:00:00Z",
        author: { name: "Bob", member_urn: "urn:li:member:456", linkedin_urn: "urn:li:member:456" },
        text: "A".repeat(300),
        reaction_count: 42,
        comment_count: 7,
        share_url: "https://linkedin.com/posts/bob_1",
        repost_count: 1,
        impressions_count: 500,
      }],
      cursor: null,
    });

    await runSearchPosts(client as never, { keywords: "ai", account: "acc_1", json: true } as SearchArgs, out);

    const written = (out.stdout.write as Mock).mock.calls.map((c) => c[0] as string).join("");
    const result = JSON.parse(written) as { items: Array<Record<string, unknown>> };
    const item = result.items[0]!;

    // Expected slim fields
    expect(item["post_urn"]).toBe("urn:li:activity:123");
    expect(item["posted_at"]).toBe("2026-01-01T00:00:00Z");
    expect(item["author"]).toEqual({ name: "Bob" });  // only name sub-field
    expect((item["text"] as string).length).toBe(200);
    expect(item["text"]).toBe("A".repeat(200));
    expect(item["reaction_count"]).toBe(42);
    expect(item["comment_count"]).toBe(7);

    // Excluded verbose-only fields
    expect(item["share_url"]).toBeUndefined();
    expect(item["repost_count"]).toBeUndefined();
    expect(item["impressions_count"]).toBeUndefined();
    // author sub-fields beyond name excluded
    expect((item["author"] as Record<string, unknown>)["member_urn"]).toBeUndefined();
  });

  it("text <=200 chars not truncated", async () => {
    const { runSearchPosts } = await import("../../src/commands/search.js");
    const out = { stdout: { write: vi.fn() }, stderr: { write: vi.fn() } };

    (accountNs.search.posts as Mock).mockResolvedValue({
      items: [{ post_urn: "urn:li:activity:124", author: { name: "Alice" }, text: "Short post", reaction_count: 1, comment_count: 0 }],
      cursor: null,
    });

    await runSearchPosts(client as never, { keywords: "ai", account: "acc_1", json: true } as SearchArgs, out);

    const written = (out.stdout.write as Mock).mock.calls.map((c) => c[0] as string).join("");
    const result = JSON.parse(written) as { items: Array<Record<string, unknown>> };
    expect(result.items[0]!["text"]).toBe("Short post");
  });

  it("null text emits text: null", async () => {
    const { runSearchPosts } = await import("../../src/commands/search.js");
    const out = { stdout: { write: vi.fn() }, stderr: { write: vi.fn() } };

    (accountNs.search.posts as Mock).mockResolvedValue({
      items: [{ post_urn: "urn:li:activity:125", author: { name: "Carl" }, text: null, reaction_count: 0, comment_count: 0 }],
      cursor: null,
    });

    await runSearchPosts(client as never, { keywords: "ai", account: "acc_1", json: true } as SearchArgs, out);

    const written = (out.stdout.write as Mock).mock.calls.map((c) => c[0] as string).join("");
    const result = JSON.parse(written) as { items: Array<Record<string, unknown>> };
    expect(result.items[0]!["text"]).toBeNull();
  });

  it("--verbose restores full text and full author object", async () => {
    const { runSearchPosts } = await import("../../src/commands/search.js");
    const out = { stdout: { write: vi.fn() }, stderr: { write: vi.fn() } };

    const longText = "A".repeat(300);
    (accountNs.search.posts as Mock).mockResolvedValue({  // eslint-disable-line @typescript-eslint/no-unsafe-assignment
      items: [{
        post_urn: "urn:li:activity:123",
        author: { name: "Bob", member_urn: "urn:li:member:456" },
        text: longText,
        reaction_count: 42,
        comment_count: 7,
        share_url: "https://linkedin.com/posts/bob_1",
        repost_count: 1,
      }],
      cursor: null,
    });

    await runSearchPosts(client as never, { keywords: "ai", account: "acc_1", json: true, verbose: true } as SearchArgs, out);

    const written = (out.stdout.write as Mock).mock.calls.map((c) => c[0] as string).join("");
    const result = JSON.parse(written) as { items: Array<Record<string, unknown>> };
    const item = result.items[0]!;
    expect(item["text"]).toBe(longText);
    expect((item["author"] as Record<string, unknown>)["member_urn"]).toBe("urn:li:member:456");
    expect(item["share_url"]).toBe("https://linkedin.com/posts/bob_1");
    expect(item["repost_count"]).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// search jobs --date-posted: numeric days, no enum normalization
// ---------------------------------------------------------------------------

describe("search jobs --date-posted: numeric body field, no hyphen normalization", () => {
  let accountNs: ReturnType<typeof makeAccountNs>;
  let client: ReturnType<typeof makeClient>;

  beforeEach(() => {
    accountNs = makeAccountNs();
    client = makeClient(accountNs);
    (accountNs.search.jobs as Mock).mockResolvedValue({ items: [], cursor: null });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("--date-posted 7 → body date_posted: 7 (number)", async () => {
    const { runSearchJobs } = await import("../../src/commands/search.js");
    const out = { stdout: { write: vi.fn() }, stderr: { write: vi.fn() } };

    await runSearchJobs(client as never, {
      account: "acc_1",
      "date-posted": "7",
      json: true,
    } as SearchArgs, out);

    const body = (accountNs.search.jobs as Mock).mock.calls[0]![0] as Record<string, unknown>;
    expect(body["date_posted"]).toBe(7);
    expect(typeof body["date_posted"]).toBe("number");
  });

  it("--date-posted 30 → body date_posted: 30 (number)", async () => {
    const { runSearchJobs } = await import("../../src/commands/search.js");
    const out = { stdout: { write: vi.fn() }, stderr: { write: vi.fn() } };

    await runSearchJobs(client as never, {
      account: "acc_1",
      "date-posted": "30",
      json: true,
    } as SearchArgs, out);

    const body = (accountNs.search.jobs as Mock).mock.calls[0]![0] as Record<string, unknown>;
    expect(body["date_posted"]).toBe(30);
    expect(typeof body["date_posted"]).toBe("number");
  });

  it("jobs --date-posted is NOT hyphen-normalized (no string replacement applied)", async () => {
    // Posts normalise past-week → past_week; jobs just coerces to Number.
    // Passing "14" should arrive as the number 14, not a string.
    const { runSearchJobs } = await import("../../src/commands/search.js");
    const out = { stdout: { write: vi.fn() }, stderr: { write: vi.fn() } };

    await runSearchJobs(client as never, {
      account: "acc_1",
      "date-posted": "14",
      json: true,
    } as SearchArgs, out);

    const body = (accountNs.search.jobs as Mock).mock.calls[0]![0] as Record<string, unknown>;
    expect(body["date_posted"]).toBe(14);
    expect(typeof body["date_posted"]).toBe("number");
  });
});
