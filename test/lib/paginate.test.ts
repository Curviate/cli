import { describe, it, expect, vi } from "vitest";
import type { Mock } from "vitest";
import { streamAll, PaginateError } from "../../src/lib/paginate.js";

function makeOut() {
  return { stdout: { write: vi.fn() }, stderr: { write: vi.fn() } };
}

// A minimal paginatable method stub factory.
function makePaginatedMethod(pages: Array<{ items: string[]; cursor: string | null }>) {
  let callIndex = 0;
  return vi.fn(async () => {
    const page = pages[callIndex++];
    if (!page) throw new Error("no more pages");
    return page;
  });
}

describe("lib/paginate — streamAll", () => {
  it("yields all items across pages", async () => {
    const method = makePaginatedMethod([
      { items: ["a", "b"], cursor: "next" },
      { items: ["c"], cursor: null },
    ]);
    const collected: string[] = [];
    for await (const item of streamAll(method as never, {}, { maxPages: 100 })) {
      collected.push(item as string);
    }
    expect(collected).toEqual(["a", "b", "c"]);
    expect(method).toHaveBeenCalledTimes(2);
  });

  it("stops after maxPages and calls onTruncated with (pagesFetched, hasMore)", async () => {
    const method = makePaginatedMethod([
      { items: ["a"], cursor: "next" },
      { items: ["b"], cursor: "next2" },
      { items: ["c"], cursor: null },
    ]);

    const truncations: Array<{ pagesFetched: number; hasMore: boolean }> = [];
    const collected: string[] = [];
    for await (const item of streamAll(
      method as never,
      {},
      { maxPages: 2, onTruncated: (pagesFetched: number, hasMore: boolean) => truncations.push({ pagesFetched, hasMore }) },
    )) {
      collected.push(item as string);
    }
    expect(collected).toEqual(["a", "b"]);
    expect(truncations).toHaveLength(1);
    expect(truncations[0]!.pagesFetched).toBe(2);
    expect(truncations[0]!.hasMore).toBe(true);
  });

  it("exits 0 after truncation (no error thrown)", async () => {
    const method = makePaginatedMethod([
      { items: ["a"], cursor: "next" },
      { items: ["b"], cursor: "more" },
    ]);

    // Should NOT throw — just stop
    const collected: string[] = [];
    await expect(
      (async () => {
        for await (const item of streamAll(method as never, {}, { maxPages: 1 })) {
          collected.push(item as string);
        }
      })(),
    ).resolves.not.toThrow();
    expect(collected).toEqual(["a"]);
  });

  it("passes initial params to first page", async () => {
    const method = vi.fn(async (params: Record<string, unknown>) => ({
      items: [],
      cursor: null,
      _params: params,
    }));
    // Consume the async iterable.
    for await (const item of streamAll(method as never, { limit: 10, filter: "test" }, { maxPages: 10 })) {
      void item; // consumed
    }
    expect(method).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 10, filter: "test" }),
    );
  });

  it("injects cursor from previous page into next call", async () => {
    const calls: Record<string, unknown>[] = [];
    const method = vi.fn(async (params: Record<string, unknown>) => {
      calls.push(params);
      if (params["cursor"] === undefined) {
        return { items: ["a"], cursor: "page2cursor" };
      }
      return { items: ["b"], cursor: null };
    });

    const items: unknown[] = [];
    for await (const item of streamAll(method as never, {}, { maxPages: 10 })) {
      items.push(item);
    }
    expect(items).toEqual(["a", "b"]);
    expect(calls[1]).toMatchObject({ cursor: "page2cursor" });
  });

  it("handles response with data[] array instead of items[]", async () => {
    const method = vi.fn(async () => ({
      data: ["x", "y"],
      cursor: null,
    }));
    const items: unknown[] = [];
    for await (const item of streamAll(method as never, {}, { maxPages: 10 })) {
      items.push(item);
    }
    expect(items).toEqual(["x", "y"]);
  });

  it("throws PaginateError (exitCode 2) when used on a non-paginated response", async () => {
    // A method that returns a response with neither items nor data
    const method = vi.fn(async () => ({ id: "not-a-list" }));
    await expect(
      (async () => {
        for await (const item of streamAll(method as never, {}, { maxPages: 10 })) {
          void item; // should throw before yielding
        }
      })(),
    ).rejects.toBeInstanceOf(PaginateError);
  });

  // ---------------------------------------------------------------------------
  // The `out` option is the single source of truth for the --all truncation
  // contract: BOTH the machine-readable JSON sentinel on stdout AND the
  // human-readable prose note on stderr, on every
  // command, with no per-call-site divergence.
  // ---------------------------------------------------------------------------

  it("with `out`: truncation writes the stream_truncated JSON sentinel to stdout AND a prose note to stderr", async () => {
    const method = makePaginatedMethod([
      { items: ["a"], cursor: "next" },
      { items: ["b"], cursor: "next2" },
      { items: ["c"], cursor: null },
    ]);
    const out = makeOut();

    const collected: string[] = [];
    for await (const item of streamAll(method as never, {}, { maxPages: 2, out })) {
      collected.push(item as string);
    }
    expect(collected).toEqual(["a", "b"]);

    // Exactly one stdout write for the sentinel; it is the last thing written
    // and it is a bare, valid JSON line — never mixed into the item stream.
    const stdoutLines = (out.stdout.write as Mock).mock.calls.map((c) => c[0] as string);
    expect(stdoutLines).toHaveLength(1);
    const sentinel = JSON.parse(stdoutLines[0]!.trim()) as Record<string, unknown>;
    expect(sentinel).toEqual({ object: "stream_truncated", pages_fetched: 2, has_more: true });
    expect(Object.keys(sentinel).sort()).toEqual(["has_more", "object", "pages_fetched"]);
    expect(typeof sentinel["object"]).toBe("string");
    expect(Number.isInteger(sentinel["pages_fetched"])).toBe(true);
    expect(typeof sentinel["has_more"]).toBe("boolean");

    // Complementary, not exclusive: stderr also gets a human-readable note.
    const stderrText = (out.stderr.write as Mock).mock.calls.map((c) => c[0] as string).join("");
    expect(stderrText).toMatch(/truncat/i);
  });

  it("with `out`: natural exhaustion (cursor null) writes neither the sentinel nor a truncation note", async () => {
    const method = makePaginatedMethod([
      { items: ["a"], cursor: "next" },
      { items: ["b"], cursor: null },
    ]);
    const out = makeOut();

    const collected: string[] = [];
    for await (const item of streamAll(method as never, {}, { maxPages: 100, out })) {
      collected.push(item as string);
    }
    expect(collected).toEqual(["a", "b"]);
    expect(out.stdout.write).not.toHaveBeenCalled();
    expect(out.stderr.write).not.toHaveBeenCalled();
  });

  it("with `out`: pages_fetched in the sentinel reflects the actual truncation point (3-page stub, maxPages 2)", async () => {
    const method = makePaginatedMethod([
      { items: ["a"], cursor: "next" },
      { items: ["b"], cursor: "next2" },
      { items: ["c"], cursor: null },
    ]);
    const out = makeOut();

    for await (const item of streamAll(method as never, {}, { maxPages: 2, out })) {
      void item;
    }
    const sentinel = JSON.parse(
      (out.stdout.write as Mock).mock.calls[0]![0] as string,
    ) as Record<string, unknown>;
    expect(sentinel["pages_fetched"]).toBe(2);
  });

  it("`onTruncated` still fires alongside `out` (back-compat escape hatch, e.g. for telemetry/tests)", async () => {
    const method = makePaginatedMethod([
      { items: ["a"], cursor: "next" },
      { items: ["b"], cursor: "next2" },
    ]);
    const out = makeOut();
    const onTruncated = vi.fn();

    for await (const item of streamAll(method as never, {}, { maxPages: 1, out, onTruncated })) {
      void item;
    }
    expect(onTruncated).toHaveBeenCalledWith(1, true);
  });
});
