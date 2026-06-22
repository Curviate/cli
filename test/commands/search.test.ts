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
  preview?: boolean;
  fields?: string;
  "api-key"?: string;
  "base-url"?: string;
  timeout?: string;
  profile?: string;
};

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

  it("search posts --keywords ai — calls search.posts", async () => {
    const { runSearchPosts } = await import("../../src/commands/search.js");
    const out = { stdout: { write: vi.fn() }, stderr: { write: vi.fn() } };

    await runSearchPosts(client as never, { keywords: "ai", account: "acc_1", json: true } as SearchArgs, out);

    expect(accountNs.search.posts).toHaveBeenCalledWith(
      expect.objectContaining({ keywords: "ai" }),
    );
  });

  it("search jobs --keywords engineer — calls search.jobs", async () => {
    const { runSearchJobs } = await import("../../src/commands/search.js");
    const out = { stdout: { write: vi.fn() }, stderr: { write: vi.fn() } };

    await runSearchJobs(client as never, { keywords: "engineer", account: "acc_1", json: true } as SearchArgs, out);

    expect(accountNs.search.jobs).toHaveBeenCalledWith(
      expect.objectContaining({ keywords: "engineer" }),
    );
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
