/**
 * `job list --state ALL` — the best-effort client-side union.
 *
 * ALL queries every enum state (DRAFT|OPEN|CLOSED|REVIEW|SUSPENDED), re-filters
 * each state's items against their own `state` (LinkedIn's filter is
 * best-effort), and merges the results de-duplicated by id. A modest pause
 * separates the per-state fetches (disabled here with --page-delay 0 to keep
 * the tests instant). With --all each state's pages stream as NDJSON, unioned
 * across the whole set; without it, the first page of each state is merged into
 * one envelope with no unified cursor.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import type { Mock } from "vitest";

const STATES = ["DRAFT", "OPEN", "CLOSED", "REVIEW", "SUSPENDED"] as const;

function makeClient(listImpl: (p: { state: string; limit?: number }) => unknown) {
  // The real SDK `jobs.list` returns a Promise — the mock must too (the --all
  // union path chains `.then()` on it).
  const jobs = { list: vi.fn(async (p: { state: string; limit?: number }) => listImpl(p)) };
  return { client: { account: vi.fn().mockReturnValue({ jobs }) }, jobs };
}
function makeOut() {
  return { stdout: { write: vi.fn() }, stderr: { write: vi.fn() } };
}
function stdoutText(out: ReturnType<typeof makeOut>): string {
  return (out.stdout.write as Mock).mock.calls.map((c) => c[0] as string).join("");
}
function stderrText(out: ReturnType<typeof makeOut>): string {
  return (out.stderr.write as Mock).mock.calls.map((c) => c[0] as string).join("");
}

// Each state query returns one posting whose own `state` matches the query
// (OPEN maps to the item state LISTED), so it survives the re-filter.
function onePerState(p: { state: string }) {
  const itemState = p.state === "OPEN" ? "LISTED" : p.state;
  return { object: "list", items: [{ id: `job_${p.state}`, state: itemState, title: p.state }], cursor: null };
}

describe("job list --state ALL — non-streaming union", () => {
  afterEach(() => vi.restoreAllMocks());

  it("queries every enum state once and merges the results into one envelope", async () => {
    const { runJobList } = await import("../../src/commands/job.js");
    const { client, jobs } = makeClient(onePerState);
    const out = makeOut();

    await runJobList(client as never, { state: "ALL", account: "acc_1", json: true, "page-delay": "0" } as never, out);

    // One call per enum state, each carrying that state.
    expect(jobs.list).toHaveBeenCalledTimes(STATES.length);
    const requestedStates = (jobs.list as Mock).mock.calls.map((c) => (c[0] as { state: string }).state);
    expect(new Set(requestedStates)).toEqual(new Set(STATES));

    // Merged envelope carries one item per state (all distinct ids).
    const parsed = JSON.parse(stdoutText(out)) as { items: Array<{ id: string }> };
    expect(parsed.items.map((i) => i.id).sort()).toEqual(STATES.map((s) => `job_${s}`).sort());

    // The best-effort-union caveat is surfaced on stderr.
    expect(stderrText(out)).toMatch(/best-effort client-side union/i);
  });

  it("de-duplicates by id when the same posting surfaces under two states", async () => {
    const { runJobList } = await import("../../src/commands/job.js");
    const { client } = makeClient((p) => {
      if (p.state === "DRAFT") return { items: [{ id: "dup", state: "DRAFT" }], cursor: null };
      if (p.state === "CLOSED") return { items: [{ id: "dup", state: "CLOSED" }], cursor: null };
      return { items: [], cursor: null };
    });
    const out = makeOut();

    await runJobList(client as never, { state: "ALL", account: "acc_1", json: true, "page-delay": "0" } as never, out);

    const parsed = JSON.parse(stdoutText(out)) as { items: Array<{ id: string }> };
    expect(parsed.items.filter((i) => i.id === "dup")).toHaveLength(1);
  });

  it("re-filters each state's items against their own state (drops best-effort noise)", async () => {
    const { runJobList } = await import("../../src/commands/job.js");
    // The DRAFT query returns a CLOSED-state item (best-effort noise) alongside a real DRAFT item.
    const { client } = makeClient((p) => {
      if (p.state === "DRAFT") {
        return { items: [{ id: "real_draft", state: "DRAFT" }, { id: "noise_closed", state: "CLOSED" }], cursor: null };
      }
      return { items: [], cursor: null };
    });
    const out = makeOut();

    await runJobList(client as never, { state: "ALL", account: "acc_1", json: true, "page-delay": "0" } as never, out);

    const parsed = JSON.parse(stdoutText(out)) as { items: Array<{ id: string }> };
    const ids = parsed.items.map((i) => i.id);
    expect(ids).toContain("real_draft");
    // The CLOSED-state item returned by the DRAFT query is dropped by that query's
    // re-filter; only the CLOSED query would surface it (and it returns nothing here).
    expect(ids).not.toContain("noise_closed");
  });
});

describe("job list --state ALL --all — streaming union (NDJSON)", () => {
  afterEach(() => vi.restoreAllMocks());

  it("streams a de-duplicated NDJSON union and announces NDJSON mode + the caveat", async () => {
    const { runJobList } = await import("../../src/commands/job.js");
    const { client, jobs } = makeClient(onePerState);
    const out = makeOut();

    await runJobList(client as never, { state: "ALL", all: true, account: "acc_1", json: true, "page-delay": "0" } as never, out);

    expect(jobs.list).toHaveBeenCalledTimes(STATES.length);

    // One NDJSON object per unique posting.
    const lines = stdoutText(out).trim().split("\n").filter(Boolean);
    const ids = lines.map((l) => (JSON.parse(l) as { id: string }).id).sort();
    expect(ids).toEqual(STATES.map((s) => `job_${s}`).sort());

    const stderr = stderrText(out);
    expect(stderr).toContain("NDJSON");
    expect(stderr).toMatch(/best-effort client-side union/i);
  });
});

describe("job list --state — ALL is the only special value", () => {
  afterEach(() => vi.restoreAllMocks());

  it("a non-enum, non-ALL state still exits 2 (usage error)", async () => {
    const { runJobList } = await import("../../src/commands/job.js");
    const { client, jobs } = makeClient(onePerState);
    const out = makeOut();
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: number | string | null) => {
      throw new Error(`process.exit(${code})`);
    }) as never);

    await expect(
      runJobList(client as never, { state: "BOGUS", account: "acc_1", json: true } as never, out),
    ).rejects.toThrow("process.exit(2)");
    expect(jobs.list).not.toHaveBeenCalled();
    exitSpy.mockRestore();
  });
});
