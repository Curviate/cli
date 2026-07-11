/**
 * Tests for the `job` write + applicant surface.
 *
 * Assert the SDK method called + its exact args (the wire contract), plus the
 * AX behaviors: required-flag validation names the missing flag and makes no
 * SDK call; paid publish requires an explicit budget; binary resume honors -o.
 *
 *   job list --state <s>                         → jobs.list({ state, limit?, cursor? })
 *   job create <flags>                           → jobs.create(body)  (nested job_title/company + apply_method oneOf)
 *   job update <id> <flags>                      → jobs.update(id, partialBody)
 *   job budget <id>                              → jobs.getBudget(id)
 *   job publish <id> --mode <m> [--budget-*]     → jobs.publish(id, { mode, budget? })
 *   job close <id>                               → jobs.close(id)  (bodyless)
 *   job applicants <id>                          → jobs.listApplicants(id, params)  (POST-as-search)
 *   job applicant get <id> <app_id>              → jobs.getApplicant(id, app_id)
 *   job applicant resume <id> <app_id> -o <f>    → jobs.downloadResume(id, app_id)  (binary)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Mock } from "vitest";
import { readFileSync, existsSync, rmSync } from "node:fs";

function makeAccountNs() {
  return {
    jobs: {
      list: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      getBudget: vi.fn(),
      publish: vi.fn(),
      close: vi.fn(),
      listApplicants: vi.fn(),
      getApplicant: vi.fn(),
      downloadResume: vi.fn(),
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

const createFlags = {
  "job-title": "Founders Associate",
  company: "LEAGUES",
  "workplace-type": "HYBRID",
  location: "loc_123",
  "employment-status": "FULL_TIME",
  description: "A".repeat(220),
  "apply-method": "linkedin",
  "notification-email": "jobs@example.com",
};

describe("job list", () => {
  let accountNs: ReturnType<typeof makeAccountNs>;
  let client: ReturnType<typeof makeClient>;

  beforeEach(() => {
    accountNs = makeAccountNs();
    client = makeClient(accountNs);
    (accountNs.jobs.list as Mock).mockResolvedValue({ object: "job_list", items: [], cursor: null });
  });
  afterEach(() => vi.restoreAllMocks());

  it("job list --state OPEN calls jobs.list with the required state", async () => {
    const { runJobList } = await import("../../src/commands/job.js");
    await runJobList(client as never, { state: "OPEN", account: "acc_1", json: true } as Args, makeOut());
    expect(accountNs.jobs.list).toHaveBeenCalledWith({ state: "OPEN" });
  });

  it("job list forwards --limit and --cursor alongside state", async () => {
    const { runJobList } = await import("../../src/commands/job.js");
    await runJobList(client as never, { state: "OPEN", account: "acc_1", json: true, limit: "10", cursor: "c1" } as Args, makeOut());
    expect(accountNs.jobs.list).toHaveBeenCalledWith({ state: "OPEN", limit: 10, cursor: "c1" });
  });

  it("job list without --state exits 2 naming the flag and makes no SDK call", async () => {
    const { runJobList } = await import("../../src/commands/job.js");
    const exitSpy = mockExit();
    const out = makeOut();
    try {
      await runJobList(client as never, { account: "acc_1" } as Args, out);
      expect.fail("should have exited");
    } catch (e) {
      expect((e as Error).message).toContain("process.exit(2)");
    } finally {
      exitSpy.mockRestore();
    }
    const stderr = (out.stderr.write as Mock).mock.calls.map((c) => c[0] as string).join("");
    expect(stderr).toContain("--state");
    expect(accountNs.jobs.list).not.toHaveBeenCalled();
  });

  it("job list rejects an out-of-enum --state (exit 2, no SDK call)", async () => {
    const { runJobList } = await import("../../src/commands/job.js");
    const exitSpy = mockExit();
    try {
      await runJobList(client as never, { state: "ARCHIVED", account: "acc_1" } as Args, makeOut());
      expect.fail("should have exited");
    } catch (e) {
      expect((e as Error).message).toContain("process.exit(2)");
    } finally {
      exitSpy.mockRestore();
    }
    expect(accountNs.jobs.list).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// job list --state: D10 client-side re-filter (upstream filtering is
// best-effort; the request vocabulary OPEN maps to the response item's own
// state LISTED -- every other value is the identical string on both sides)
// ---------------------------------------------------------------------------

describe("job list --state re-filter (D10)", () => {
  let accountNs: ReturnType<typeof makeAccountNs>;
  let client: ReturnType<typeof makeClient>;

  beforeEach(() => {
    accountNs = makeAccountNs();
    client = makeClient(accountNs);
  });
  afterEach(() => vi.restoreAllMocks());

  it("--state OPEN: only items whose own state is LISTED survive; DRAFT items upstream returned anyway are dropped", async () => {
    (accountNs.jobs.list as Mock).mockResolvedValue({
      object: "job_posting_list",
      items: [
        { object: "job_posting", id: "job_1", title: "A", company: "Acme", state: "LISTED", applications_count: 0 },
        { object: "job_posting", id: "job_2", title: "B", company: "Acme", state: "DRAFT", applications_count: 0 },
      ],
      cursor: null,
    });
    const { runJobList } = await import("../../src/commands/job.js");
    const out = makeOut();

    await runJobList(client as never, { state: "OPEN", account: "acc_1", json: true } as Args, out);

    const written = (out.stdout.write as Mock).mock.calls.map((c) => c[0] as string).join("");
    const result = JSON.parse(written) as { items: Array<Record<string, unknown>> };
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.["id"]).toBe("job_1");
  });

  it("--state OPEN: dropped items produce a stderr note naming the count", async () => {
    (accountNs.jobs.list as Mock).mockResolvedValue({
      object: "job_posting_list",
      items: [
        { object: "job_posting", id: "job_1", title: "A", company: "Acme", state: "LISTED", applications_count: 0 },
        { object: "job_posting", id: "job_2", title: "B", company: "Acme", state: "DRAFT", applications_count: 0 },
        { object: "job_posting", id: "job_3", title: "C", company: "Acme", state: "CLOSED", applications_count: 0 },
      ],
      cursor: null,
    });
    const { runJobList } = await import("../../src/commands/job.js");
    const out = makeOut();

    await runJobList(client as never, { state: "OPEN", account: "acc_1", json: true } as Args, out);

    const stderr = (out.stderr.write as Mock).mock.calls.map((c) => c[0] as string).join("");
    expect(stderr).toMatch(/dropped 2 of 3/i);
  });

  it("--state DRAFT: identical request/response string, filters directly (no OPEN->LISTED mapping needed)", async () => {
    (accountNs.jobs.list as Mock).mockResolvedValue({
      object: "job_posting_list",
      items: [
        { object: "job_posting", id: "job_1", title: "A", company: "Acme", state: "DRAFT", applications_count: 0 },
        { object: "job_posting", id: "job_2", title: "B", company: "Acme", state: "LISTED", applications_count: 0 },
      ],
      cursor: null,
    });
    const { runJobList } = await import("../../src/commands/job.js");
    const out = makeOut();

    await runJobList(client as never, { state: "DRAFT", account: "acc_1", json: true } as Args, out);

    const written = (out.stdout.write as Mock).mock.calls.map((c) => c[0] as string).join("");
    const result = JSON.parse(written) as { items: Array<Record<string, unknown>> };
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.["id"]).toBe("job_1");
  });

  it("no items dropped -> no stderr note is written", async () => {
    (accountNs.jobs.list as Mock).mockResolvedValue({
      object: "job_posting_list",
      items: [
        { object: "job_posting", id: "job_1", title: "A", company: "Acme", state: "LISTED", applications_count: 0 },
      ],
      cursor: null,
    });
    const { runJobList } = await import("../../src/commands/job.js");
    const out = makeOut();

    await runJobList(client as never, { state: "OPEN", account: "acc_1", json: true } as Args, out);

    expect(out.stderr.write).not.toHaveBeenCalled();
  });

  it("cursor and envelope fields pass through untouched by the re-filter", async () => {
    (accountNs.jobs.list as Mock).mockResolvedValue({
      object: "job_posting_list",
      items: [
        { object: "job_posting", id: "job_1", title: "A", company: "Acme", state: "DRAFT", applications_count: 0 },
      ],
      cursor: "cur_next",
    });
    const { runJobList } = await import("../../src/commands/job.js");
    const out = makeOut();

    await runJobList(client as never, { state: "OPEN", account: "acc_1", json: true } as Args, out);

    const written = (out.stdout.write as Mock).mock.calls.map((c) => c[0] as string).join("");
    const result = JSON.parse(written) as Record<string, unknown>;
    expect(result["object"]).toBe("job_posting_list");
    expect(result["cursor"]).toBe("cur_next");
    expect(result["items"]).toEqual([]);
  });

  it("--all: re-filters each streamed item against its own state; the upstream cursor walk is unaffected by filtering", async () => {
    (accountNs.jobs.list as Mock)
      .mockResolvedValueOnce({
        items: [
          { object: "job_posting", id: "job_1", state: "LISTED" },
          { object: "job_posting", id: "job_2", state: "DRAFT" },
        ],
        cursor: "cur_2",
      })
      .mockResolvedValueOnce({
        items: [
          { object: "job_posting", id: "job_3", state: "LISTED" },
        ],
        cursor: null,
      });
    const { runJobList } = await import("../../src/commands/job.js");
    const out = makeOut();

    await runJobList(client as never, { state: "OPEN", account: "acc_1", all: true } as Args, out);

    // Both upstream pages were walked (the second call received the first
    // page's cursor) even though page 1 had a filtered-out item.
    expect(accountNs.jobs.list).toHaveBeenCalledTimes(2);
    expect((accountNs.jobs.list as Mock).mock.calls[1]?.[0]).toMatchObject({ cursor: "cur_2" });

    const written = (out.stdout.write as Mock).mock.calls.map((c) => c[0] as string).join("");
    const ids = written.trim().split("\n").map((line) => (JSON.parse(line) as Record<string, unknown>)["id"]);
    expect(ids).toEqual(["job_1", "job_3"]);

    const stderr = (out.stderr.write as Mock).mock.calls.map((c) => c[0] as string).join("");
    expect(stderr).toMatch(/dropped 1 of 2/i);
  });
});

describe("job create", () => {
  let accountNs: ReturnType<typeof makeAccountNs>;
  let client: ReturnType<typeof makeClient>;

  beforeEach(() => {
    accountNs = makeAccountNs();
    client = makeClient(accountNs);
    (accountNs.jobs.create as Mock).mockResolvedValue({ object: "job_posting", id: "job_1" });
  });
  afterEach(() => vi.restoreAllMocks());

  it("builds the nested job_title/company objects and a linkedin apply_method", async () => {
    const { runJobCreate } = await import("../../src/commands/job.js");
    await runJobCreate(client as never, { ...createFlags, account: "acc_1", json: true } as Args, makeOut());
    expect(accountNs.jobs.create).toHaveBeenCalledTimes(1);
    const body = (accountNs.jobs.create as Mock).mock.calls[0]![0] as Record<string, unknown>;
    expect(body).toMatchObject({
      job_title: { name: "Founders Associate" },
      company: { name: "LEAGUES" },
      workplace_type: "HYBRID",
      location: "loc_123",
      employment_status: "FULL_TIME",
      apply_method: { method: "linkedin", notification_email: "jobs@example.com" },
    });
    expect(body["description"]).toBe(createFlags.description);
  });

  it("--job-title-id / --company-id populate the id form of the nested objects", async () => {
    const { runJobCreate } = await import("../../src/commands/job.js");
    await runJobCreate(
      client as never,
      { ...createFlags, "job-title": undefined, "job-title-id": "jt_9", company: undefined, "company-id": "co_9", account: "acc_1", json: true } as Args,
      makeOut(),
    );
    const body = (accountNs.jobs.create as Mock).mock.calls[0]![0] as Record<string, unknown>;
    expect(body["job_title"]).toEqual({ id: "jt_9" });
    expect(body["company"]).toEqual({ id: "co_9" });
  });

  it("an external apply_method builds { method: 'external', website_url }", async () => {
    const { runJobCreate } = await import("../../src/commands/job.js");
    await runJobCreate(
      client as never,
      { ...createFlags, "apply-method": "external", "notification-email": undefined, "website-url": "https://apply.example.com", account: "acc_1", json: true } as Args,
      makeOut(),
    );
    const body = (accountNs.jobs.create as Mock).mock.calls[0]![0] as Record<string, unknown>;
    expect(body["apply_method"]).toEqual({ method: "external", website_url: "https://apply.example.com" });
  });

  it.each([
    ["job-title", { "job-title": undefined, "job-title-id": undefined }, "--job-title"],
    ["company", { company: undefined, "company-id": undefined }, "--company"],
    ["workplace-type", { "workplace-type": undefined }, "--workplace-type"],
    ["location", { location: undefined }, "--location"],
    ["employment-status", { "employment-status": undefined }, "--employment-status"],
    ["description", { description: undefined }, "--description"],
    ["apply-method", { "apply-method": undefined }, "--apply-method"],
  ])("missing %s exits 2 naming the flag, no SDK call", async (_name, override, mentioned) => {
    const { runJobCreate } = await import("../../src/commands/job.js");
    const exitSpy = mockExit();
    const out = makeOut();
    try {
      await runJobCreate(client as never, { ...createFlags, ...override, account: "acc_1" } as Args, out);
      expect.fail("should have exited");
    } catch (e) {
      expect((e as Error).message).toContain("process.exit(2)");
    } finally {
      exitSpy.mockRestore();
    }
    const stderr = (out.stderr.write as Mock).mock.calls.map((c) => c[0] as string).join("");
    expect(stderr).toContain(mentioned);
    expect(accountNs.jobs.create).not.toHaveBeenCalled();
  });

  it("apply-method linkedin without --notification-email exits 2 naming it", async () => {
    const { runJobCreate } = await import("../../src/commands/job.js");
    const exitSpy = mockExit();
    const out = makeOut();
    try {
      await runJobCreate(client as never, { ...createFlags, "notification-email": undefined, account: "acc_1" } as Args, out);
      expect.fail("should have exited");
    } catch (e) {
      expect((e as Error).message).toContain("process.exit(2)");
    } finally {
      exitSpy.mockRestore();
    }
    const stderr = (out.stderr.write as Mock).mock.calls.map((c) => c[0] as string).join("");
    expect(stderr).toContain("--notification-email");
    expect(accountNs.jobs.create).not.toHaveBeenCalled();
  });

  it("--preview renders the create body without calling the SDK", async () => {
    const { runJobCreate } = await import("../../src/commands/job.js");
    const out = makeOut();
    await runJobCreate(client as never, { ...createFlags, account: "acc_1", preview: true, json: true } as Args, out);
    expect(accountNs.jobs.create).not.toHaveBeenCalled();
    const preview = JSON.parse((out.stdout.write as Mock).mock.calls.map((c) => c[0] as string).join(""));
    expect(preview.method).toBe("jobs.create");
  });
});

describe("job update", () => {
  let accountNs: ReturnType<typeof makeAccountNs>;
  let client: ReturnType<typeof makeClient>;
  beforeEach(() => {
    accountNs = makeAccountNs();
    client = makeClient(accountNs);
    (accountNs.jobs.update as Mock).mockResolvedValue({ object: "job_posting", id: "job_1" });
  });
  afterEach(() => vi.restoreAllMocks());

  it("sends only the provided fields as a partial update", async () => {
    const { runJobUpdate } = await import("../../src/commands/job.js");
    await runJobUpdate(client as never, { id: "job_1", "workplace-type": "REMOTE", account: "acc_1", json: true } as Args, makeOut());
    expect(accountNs.jobs.update).toHaveBeenCalledWith("job_1", { workplace_type: "REMOTE" });
  });
});

describe("job budget / close", () => {
  let accountNs: ReturnType<typeof makeAccountNs>;
  let client: ReturnType<typeof makeClient>;
  beforeEach(() => {
    accountNs = makeAccountNs();
    client = makeClient(accountNs);
    (accountNs.jobs.getBudget as Mock).mockResolvedValue({ object: "job_budget" });
    (accountNs.jobs.close as Mock).mockResolvedValue({ object: "job_posting", state: "CLOSED" });
  });
  afterEach(() => vi.restoreAllMocks());

  it("job budget <id> calls jobs.getBudget", async () => {
    const { runJobBudget } = await import("../../src/commands/job.js");
    await runJobBudget(client as never, { id: "job_1", account: "acc_1", json: true } as Args, makeOut());
    expect(accountNs.jobs.getBudget).toHaveBeenCalledWith("job_1");
  });

  it("job close <id> calls jobs.close bodyless (single argument)", async () => {
    const { runJobClose } = await import("../../src/commands/job.js");
    await runJobClose(client as never, { id: "job_1", account: "acc_1", json: true } as Args, makeOut());
    expect(accountNs.jobs.close).toHaveBeenCalledWith("job_1");
    expect((accountNs.jobs.close as Mock).mock.calls[0]).toHaveLength(1);
  });
});

describe("job publish", () => {
  let accountNs: ReturnType<typeof makeAccountNs>;
  let client: ReturnType<typeof makeClient>;
  beforeEach(() => {
    accountNs = makeAccountNs();
    client = makeClient(accountNs);
    (accountNs.jobs.publish as Mock).mockResolvedValue({ object: "job_posting", state: "LISTED" });
  });
  afterEach(() => vi.restoreAllMocks());

  it("--mode FREE publishes with just { mode: 'FREE' }", async () => {
    const { runJobPublish } = await import("../../src/commands/job.js");
    await runJobPublish(client as never, { id: "j1", mode: "FREE", account: "acc_1", json: true } as Args, makeOut());
    expect(accountNs.jobs.publish).toHaveBeenCalledWith("j1", { mode: "FREE" });
  });

  it("--mode PROMOTED with budget flags publishes with the budget object", async () => {
    const { runJobPublish } = await import("../../src/commands/job.js");
    await runJobPublish(
      client as never,
      { id: "j1", mode: "PROMOTED", "budget-currency": "EUR", "budget-amount": "25", "budget-scope": "DAILY", account: "acc_1", json: true } as Args,
      makeOut(),
    );
    expect(accountNs.jobs.publish).toHaveBeenCalledWith("j1", { mode: "PROMOTED", budget: { currency: "EUR", amount: 25, scope: "DAILY" } });
  });

  it("without --mode exits 2 naming --mode and makes no SDK call", async () => {
    const { runJobPublish } = await import("../../src/commands/job.js");
    const exitSpy = mockExit();
    const out = makeOut();
    try {
      await runJobPublish(client as never, { id: "j1", account: "acc_1" } as Args, out);
      expect.fail("should have exited");
    } catch (e) {
      expect((e as Error).message).toContain("process.exit(2)");
    } finally {
      exitSpy.mockRestore();
    }
    const stderr = (out.stderr.write as Mock).mock.calls.map((c) => c[0] as string).join("");
    expect(stderr).toContain("--mode");
    expect(accountNs.jobs.publish).not.toHaveBeenCalled();
  });

  it("PROMOTED without a complete budget exits 2 naming a budget flag, no SDK call", async () => {
    const { runJobPublish } = await import("../../src/commands/job.js");
    const exitSpy = mockExit();
    const out = makeOut();
    try {
      await runJobPublish(client as never, { id: "j1", mode: "PROMOTED", "budget-currency": "EUR", account: "acc_1" } as Args, out);
      expect.fail("should have exited");
    } catch (e) {
      expect((e as Error).message).toContain("process.exit(2)");
    } finally {
      exitSpy.mockRestore();
    }
    const stderr = (out.stderr.write as Mock).mock.calls.map((c) => c[0] as string).join("");
    expect(stderr).toContain("--budget-amount");
    expect(accountNs.jobs.publish).not.toHaveBeenCalled();
  });

  it("rejects a --mode outside the enum (exit 2, no SDK call)", async () => {
    const { runJobPublish } = await import("../../src/commands/job.js");
    const exitSpy = mockExit();
    try {
      await runJobPublish(client as never, { id: "j1", mode: "GIVE_AWAY", account: "acc_1" } as Args, makeOut());
      expect.fail("should have exited");
    } catch (e) {
      expect((e as Error).message).toContain("process.exit(2)");
    } finally {
      exitSpy.mockRestore();
    }
    expect(accountNs.jobs.publish).not.toHaveBeenCalled();
  });

  it("--preview renders the publish body without calling the SDK", async () => {
    const { runJobPublish } = await import("../../src/commands/job.js");
    const out = makeOut();
    await runJobPublish(client as never, { id: "j1", mode: "FREE", account: "acc_1", preview: true, json: true } as Args, out);
    expect(accountNs.jobs.publish).not.toHaveBeenCalled();
    const preview = JSON.parse((out.stdout.write as Mock).mock.calls.map((c) => c[0] as string).join(""));
    expect(preview.method).toBe("jobs.publish");
    expect(preview.body).toEqual({ mode: "FREE" });
  });
});

describe("job applicants (POST-as-search) + applicant detail", () => {
  let accountNs: ReturnType<typeof makeAccountNs>;
  let client: ReturnType<typeof makeClient>;
  beforeEach(() => {
    accountNs = makeAccountNs();
    client = makeClient(accountNs);
    (accountNs.jobs.listApplicants as Mock).mockResolvedValue({ object: "applicant_list", items: [], cursor: null });
    (accountNs.jobs.getApplicant as Mock).mockResolvedValue({ object: "applicant", id: "app_1" });
  });
  afterEach(() => vi.restoreAllMocks());

  it("job applicants <id> calls listApplicants with the job id and empty filter", async () => {
    const { runJobApplicants } = await import("../../src/commands/job.js");
    await runJobApplicants(client as never, { id: "job_1", account: "acc_1", json: true } as Args, makeOut());
    expect(accountNs.jobs.listApplicants).toHaveBeenCalledWith("job_1", {});
  });

  it("job applicants forwards --ratings, --limit and --cursor", async () => {
    const { runJobApplicants } = await import("../../src/commands/job.js");
    await runJobApplicants(
      client as never,
      { id: "job_1", ratings: "GOOD_FIT,MAYBE", limit: "5", cursor: "c2", account: "acc_1", json: true } as Args,
      makeOut(),
    );
    expect(accountNs.jobs.listApplicants).toHaveBeenCalledWith("job_1", { ratings: ["GOOD_FIT", "MAYBE"], limit: 5, cursor: "c2" });
  });

  it("job applicant get <id> <app_id> calls getApplicant", async () => {
    const { runJobApplicantGet } = await import("../../src/commands/job.js");
    await runJobApplicantGet(client as never, { id: "job_1", applicantId: "app_1", account: "acc_1", json: true } as Args, makeOut());
    expect(accountNs.jobs.getApplicant).toHaveBeenCalledWith("job_1", "app_1");
  });
});

describe("job applicant resume (binary)", () => {
  const tmp = "/tmp/claude-1000/job-resume-test.pdf";
  let accountNs: ReturnType<typeof makeAccountNs>;
  let client: ReturnType<typeof makeClient>;
  beforeEach(() => {
    accountNs = makeAccountNs();
    client = makeClient(accountNs);
    (accountNs.jobs.downloadResume as Mock).mockResolvedValue(new TextEncoder().encode("%PDF-bytes").buffer);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    if (existsSync(tmp)) rmSync(tmp);
  });

  it("writes the resume bytes to -o <file>", async () => {
    const { runJobApplicantResume } = await import("../../src/commands/job.js");
    await runJobApplicantResume(client as never, { id: "job_1", applicantId: "app_1", output: tmp, account: "acc_1" } as Args, makeOut(), false);
    expect(accountNs.jobs.downloadResume).toHaveBeenCalledWith("job_1", "app_1");
    expect(existsSync(tmp)).toBe(true);
    expect(readFileSync(tmp).toString()).toBe("%PDF-bytes");
  });

  it("on a TTY without -o exits 2 (refuses to dump binary to the terminal)", async () => {
    const { runJobApplicantResume } = await import("../../src/commands/job.js");
    const exitSpy = mockExit();
    try {
      await runJobApplicantResume(client as never, { id: "job_1", applicantId: "app_1", account: "acc_1" } as Args, makeOut(), true);
      expect.fail("should have exited");
    } catch (e) {
      expect((e as Error).message).toContain("process.exit(2)");
    } finally {
      exitSpy.mockRestore();
    }
  });
});

describe("job write/read flag hygiene", () => {
  const PAGINATION_ONLY = ["limit", "cursor", "all", "max-pages"] as const;
  type CommandLike = { args?: Record<string, unknown>; subCommands?: Record<string, CommandLike> };

  async function sub(path: string[]): Promise<Record<string, unknown>> {
    const { jobCommand } = await import("../../src/commands/job.js");
    let node = jobCommand as unknown as CommandLike;
    for (const seg of path) node = (node.subCommands ?? {})[seg]!;
    return node?.args ?? {};
  }

  it("write subcommands omit pagination flags but keep --fields", async () => {
    for (const path of [["create"], ["update"], ["publish"], ["close"]]) {
      const args = await sub(path);
      for (const flag of PAGINATION_ONLY) {
        expect(args, `job ${path.join(" ")} must NOT include --${flag}`).not.toHaveProperty(flag);
      }
      expect(args, `job ${path.join(" ")} keeps --fields`).toHaveProperty("fields");
    }
  });

  it("list-read subcommands advertise pagination flags", async () => {
    for (const path of [["list"], ["applicants"]]) {
      const args = await sub(path);
      for (const flag of PAGINATION_ONLY) {
        expect(args, `job ${path.join(" ")} includes --${flag}`).toHaveProperty(flag);
      }
    }
  });

  it("no job command exposes --dry-run", async () => {
    for (const path of [["list"], ["create"], ["update"], ["budget"], ["publish"], ["close"], ["applicants"], ["applicant", "get"], ["applicant", "resume"]]) {
      const args = await sub(path);
      expect(args, `job ${path.join(" ")} must NOT have --dry-run`).not.toHaveProperty("dry-run");
    }
  });
});
