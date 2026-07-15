/**
 * Tests for the profile-insights subcommands (the acting account's own
 * insight surface, mounted under the `profile` noun):
 *
 *   profile subscription  → profile.subscription (scalar read)
 *   profile analytics     → profile.analytics     (scalar read)
 *   profile visitors      → profile.visitors      (paginated read)
 *   profile ssi           → profile.ssi           (scalar read)
 *
 * These are self-reads of the connected account only — never a third party.
 * All four are reads: --preview is a usage error (exit 2); --all is a usage
 * error on the three scalar reads and streams on `visitors`.
 *
 * The SDK boundary is stubbed (a fake account-scoped `profile` namespace), the
 * way every command test isolates the run function from the network.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Mock } from "vitest";
import { CurviateError } from "@curviate/sdk";

function makeProfileNs() {
  return {
    profile: {
      subscription: vi.fn(),
      analytics: vi.fn(),
      visitors: vi.fn(),
      ssi: vi.fn(),
    },
  };
}

function makeClient(ns: ReturnType<typeof makeProfileNs>) {
  return { account: vi.fn().mockReturnValue(ns) };
}

function makeOut() {
  return { stdout: { write: vi.fn() }, stderr: { write: vi.fn() } };
}

function mockExit() {
  return vi.spyOn(process, "exit").mockImplementation((code?: number | string | null) => {
    throw new Error(`process.exit(${code})`);
  });
}

type Flags = Record<string, unknown>;

function writtenStdout(out: ReturnType<typeof makeOut>): string {
  return (out.stdout.write as Mock).mock.calls.map((c) => c[0] as string).join("");
}

describe("profile subscription", () => {
  let ns: ReturnType<typeof makeProfileNs>;
  let client: ReturnType<typeof makeClient>;

  beforeEach(() => {
    ns = makeProfileNs();
    client = makeClient(ns);
    (ns.profile.subscription as Mock).mockResolvedValue({
      object: "profile_subscription",
      has_premium: true,
      plan_title: "Sales Navigator Core",
      subscriptions: [{ title: "Sales Navigator Core" }],
    });
  });

  afterEach(() => vi.restoreAllMocks());

  it("calls profile.subscription() on the bound account and prints the full response", async () => {
    const { runProfileSubscription } = await import("../../src/commands/profile.js");
    const out = makeOut();

    await runProfileSubscription(client as never, { account: "acc_1", json: true } as Flags, out);

    expect(client.account).toHaveBeenCalledWith("acc_1");
    expect(ns.profile.subscription).toHaveBeenCalledWith();
    const result = JSON.parse(writtenStdout(out)) as Record<string, unknown>;
    expect(result["has_premium"]).toBe(true);
    expect(result["plan_title"]).toBe("Sales Navigator Core");
  });

  it("a free account (has_premium:false, plan_title:null) is a valid result, not an error", async () => {
    (ns.profile.subscription as Mock).mockResolvedValue({
      object: "profile_subscription",
      has_premium: false,
      plan_title: null,
      subscriptions: [],
    });
    const { runProfileSubscription } = await import("../../src/commands/profile.js");
    const out = makeOut();

    await runProfileSubscription(client as never, { account: "acc_1", json: true } as Flags, out);

    const result = JSON.parse(writtenStdout(out)) as Record<string, unknown>;
    expect(result["has_premium"]).toBe(false);
    expect(result["plan_title"]).toBeNull();
  });

  it("without --account → exit 2 (account_id required), no SDK call", async () => {
    const { runProfileSubscription } = await import("../../src/commands/profile.js");
    const out = makeOut();
    const exit = mockExit();
    try {
      await runProfileSubscription(client as never, { json: true } as Flags, out);
      expect.fail("should have exited");
    } catch (e) {
      expect((e as Error).message).toContain("process.exit(2)");
    } finally {
      exit.mockRestore();
    }
    expect(ns.profile.subscription).not.toHaveBeenCalled();
  });

  it("--preview → usage error exit 2 (read command)", async () => {
    const { runProfileSubscription } = await import("../../src/commands/profile.js");
    const out = makeOut();
    const exit = mockExit();
    try {
      await runProfileSubscription(client as never, { account: "acc_1", preview: true } as Flags, out);
      expect.fail("should have exited");
    } catch (e) {
      expect((e as Error).message).toContain("process.exit(2)");
    } finally {
      exit.mockRestore();
    }
    expect(ns.profile.subscription).not.toHaveBeenCalled();
  });
});

describe("profile analytics", () => {
  let ns: ReturnType<typeof makeProfileNs>;
  let client: ReturnType<typeof makeClient>;

  beforeEach(() => {
    ns = makeProfileNs();
    client = makeClient(ns);
    (ns.profile.analytics as Mock).mockResolvedValue({
      object: "profile_analytics",
      profile_viewers: { count: 42 },
      followers: { count: 1200 },
      post_impressions: { count: 0 },
      search_appearances: { count: null },
    });
  });

  afterEach(() => vi.restoreAllMocks());

  it("calls profile.analytics() and prints the headline metrics (count 0 is a real zero)", async () => {
    const { runProfileAnalytics } = await import("../../src/commands/profile.js");
    const out = makeOut();

    await runProfileAnalytics(client as never, { account: "acc_1", json: true } as Flags, out);

    expect(ns.profile.analytics).toHaveBeenCalledWith();
    const result = JSON.parse(writtenStdout(out)) as Record<string, Record<string, unknown>>;
    expect(result["profile_viewers"]?.["count"]).toBe(42);
    expect(result["post_impressions"]?.["count"]).toBe(0);
  });

  it("--all → usage error exit 2 (non-paginated scalar read)", async () => {
    const { runProfileAnalytics } = await import("../../src/commands/profile.js");
    const out = makeOut();
    const exit = mockExit();
    try {
      await runProfileAnalytics(client as never, { account: "acc_1", all: true } as Flags, out);
      expect.fail("should have exited");
    } catch (e) {
      expect((e as Error).message).toContain("process.exit(2)");
    } finally {
      exit.mockRestore();
    }
  });
});

describe("profile ssi", () => {
  let ns: ReturnType<typeof makeProfileNs>;
  let client: ReturnType<typeof makeClient>;

  beforeEach(() => {
    ns = makeProfileNs();
    client = makeClient(ns);
    (ns.profile.ssi as Mock).mockResolvedValue({
      object: "profile_ssi",
      overall: 63.4,
      pillars: { establish_brand: 15.1, find_people: 16.0, engage_insights: 16.3, build_relationships: 16.0 },
      industry_rank: 12,
      network_rank: 8,
      active_seat: true,
    });
  });

  afterEach(() => vi.restoreAllMocks());

  it("calls profile.ssi() and prints the score preserving float precision", async () => {
    const { runProfileSsi } = await import("../../src/commands/profile.js");
    const out = makeOut();

    await runProfileSsi(client as never, { account: "acc_1", json: true } as Flags, out);

    expect(ns.profile.ssi).toHaveBeenCalledWith();
    const result = JSON.parse(writtenStdout(out)) as Record<string, unknown>;
    expect(result["overall"]).toBe(63.4);
    expect(result["industry_rank"]).toBe(12);
  });

  it("a 5xx from the SDK surfaces as a mapped exit code, not a crash", async () => {
    (ns.profile.ssi as Mock).mockRejectedValue(
      new CurviateError({
        code: "PLATFORM_ERROR",
        message: "upstream error",
        httpStatus: 502,
        userFixable: false,
        retryLikelyToSucceed: true,
      }),
    );
    const { runProfileSsi } = await import("../../src/commands/profile.js");
    const out = makeOut();
    const exit = mockExit();
    try {
      await runProfileSsi(client as never, { account: "acc_1", json: true } as Flags, out);
      expect.fail("should have exited");
    } catch (e) {
      expect((e as Error).message).toContain("process.exit(7)");
    } finally {
      exit.mockRestore();
    }
  });
});

describe("profile visitors", () => {
  let ns: ReturnType<typeof makeProfileNs>;
  let client: ReturnType<typeof makeClient>;

  beforeEach(() => {
    ns = makeProfileNs();
    client = makeClient(ns);
    (ns.profile.visitors as Mock).mockResolvedValue({
      object: "profile_visitor_list",
      items: [{ kind: "identified", name: "Sophie Keller", headline: "GTM" }],
      cursor: null,
    });
  });

  afterEach(() => vi.restoreAllMocks());

  it("forwards --limit/--cursor and prints the page", async () => {
    const { runProfileVisitors } = await import("../../src/commands/profile.js");
    const out = makeOut();

    await runProfileVisitors(client as never, { account: "acc_1", json: true, limit: "10", cursor: "cur_0" } as Flags, out);

    expect(ns.profile.visitors).toHaveBeenCalledWith({ limit: 10, cursor: "cur_0" });
    const result = JSON.parse(writtenStdout(out)) as Record<string, unknown>;
    expect((result["items"] as unknown[])).toHaveLength(1);
  });

  it("--preview → usage error exit 2 (read command)", async () => {
    const { runProfileVisitors } = await import("../../src/commands/profile.js");
    const out = makeOut();
    const exit = mockExit();
    try {
      await runProfileVisitors(client as never, { account: "acc_1", preview: true } as Flags, out);
      expect.fail("should have exited");
    } catch (e) {
      expect((e as Error).message).toContain("process.exit(2)");
    } finally {
      exit.mockRestore();
    }
  });

  it("--all streams every page as NDJSON, walking the cursor to exhaustion", async () => {
    (ns.profile.visitors as Mock)
      .mockResolvedValueOnce({ object: "profile_visitor_list", items: [{ kind: "identified", name: "A" }], cursor: "c1" })
      .mockResolvedValueOnce({ object: "profile_visitor_list", items: [{ kind: "aggregate", count: 3 }], cursor: null });

    const { runProfileVisitors } = await import("../../src/commands/profile.js");
    const out = makeOut();

    await runProfileVisitors(client as never, { account: "acc_1", json: true, all: true, "page-delay": "0" } as Flags, out);

    const lines = writtenStdout(out).trim().split("\n").filter(Boolean);
    expect(lines).toHaveLength(2);
    expect((JSON.parse(lines[0]!) as Record<string, unknown>)["name"]).toBe("A");
    expect(ns.profile.visitors).toHaveBeenCalledTimes(2);
    // Second page carried the cursor from the first response.
    expect(ns.profile.visitors).toHaveBeenNthCalledWith(2, { cursor: "c1" });
  });
});
