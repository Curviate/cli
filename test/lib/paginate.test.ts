import { describe, it, expect, vi } from "vitest";
import { streamAll, PaginateError } from "../../src/lib/paginate.js";

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

  it("stops after maxPages and emits a truncation note", async () => {
    const method = makePaginatedMethod([
      { items: ["a"], cursor: "next" },
      { items: ["b"], cursor: "next2" },
      { items: ["c"], cursor: null },
    ]);

    const notes: string[] = [];
    const collected: string[] = [];
    for await (const item of streamAll(
      method as never,
      {},
      { maxPages: 2, onTruncated: (msg: string) => notes.push(msg) },
    )) {
      collected.push(item as string);
    }
    expect(collected).toEqual(["a", "b"]);
    expect(notes.length).toBeGreaterThan(0);
    expect(notes[0]).toContain("truncated");
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
});
