/**
 * Tests for the shared search-filters escape-hatch helper.
 *
 * The rich search bodies (35-40 filters, many nested) are reachable through a
 * --filters <json> / --filters-file <path> / --filters - (stdin) escape hatch
 * that merges arbitrary JSON into the request body. This file asserts the
 * parse / merge / error contract that every search command depends on.
 */

import { describe, it, expect, vi } from "vitest";
import { assembleFilters, splitCsv, splitCsvNumbers } from "../../src/lib/search-filters.js";

function makeReaders(opts: { file?: string; stdin?: string } = {}) {
  return {
    readFile: vi.fn(async () => {
      if (opts.file === undefined) throw new Error("no file");
      return opts.file;
    }),
    readStdin: vi.fn(async () => opts.stdin ?? ""),
  };
}

describe("assembleFilters — JSON escape hatch", () => {
  it("no --filters source → empty base body", async () => {
    const r = await assembleFilters({}, makeReaders());
    expect(r).toEqual({ body: {} });
  });

  it("--filters '<json>' inline → merges parsed object into the body", async () => {
    const r = await assembleFilters(
      { filters: '{"industry":["96"],"network_distance":[1,2]}' },
      makeReaders(),
    );
    expect(r).toEqual({ body: { industry: ["96"], network_distance: [1, 2] } });
  });

  it("--filters-file <path> → reads the file and merges the parsed object", async () => {
    const readers = makeReaders({ file: '{"location":["103644278"]}' });
    const r = await assembleFilters({ "filters-file": "/some/path.json" }, readers);
    expect(readers.readFile).toHaveBeenCalledWith("/some/path.json");
    expect(r).toEqual({ body: { location: ["103644278"] } });
  });

  it("--filters - → reads JSON from stdin and merges", async () => {
    const readers = makeReaders({ stdin: '{"company":["1441"]}' });
    const r = await assembleFilters({ filters: "-" }, readers);
    expect(readers.readStdin).toHaveBeenCalled();
    expect(r).toEqual({ body: { company: ["1441"] } });
  });

  it("invalid JSON → returns an error (no body)", async () => {
    const r = await assembleFilters({ filters: "{ not valid json " }, makeReaders());
    expect(r).toHaveProperty("error");
    expect("error" in r && r.error).toMatch(/valid JSON/i);
  });

  it("non-object JSON (array) → returns an error (no body)", async () => {
    const r = await assembleFilters({ filters: "[1,2,3]" }, makeReaders());
    expect(r).toHaveProperty("error");
    expect("error" in r && r.error).toMatch(/object/i);
  });

  it("non-object JSON (scalar) → returns an error", async () => {
    const r = await assembleFilters({ filters: "42" }, makeReaders());
    expect(r).toHaveProperty("error");
  });

  it("unreadable --filters-file → returns an error", async () => {
    const readers = makeReaders(); // readFile throws
    const r = await assembleFilters({ "filters-file": "/missing.json" }, readers);
    expect(r).toHaveProperty("error");
    expect("error" in r && r.error).toMatch(/cannot read/i);
  });

  it("--filters-file wins when both --filters-file and --filters - are given", async () => {
    const readers = makeReaders({ file: '{"from":"file"}', stdin: '{"from":"stdin"}' });
    const r = await assembleFilters({ "filters-file": "/p.json", filters: "-" }, readers);
    expect(r).toEqual({ body: { from: "file" } });
    expect(readers.readStdin).not.toHaveBeenCalled();
  });
});

describe("splitCsv — comma-separated array flags", () => {
  it("splits on commas and trims", () => {
    expect(splitCsv("a, b ,c")).toEqual(["a", "b", "c"]);
  });

  it("single value → single-element array", () => {
    expect(splitCsv("solo")).toEqual(["solo"]);
  });

  it("drops empty segments from trailing/double commas", () => {
    expect(splitCsv("a,,b,")).toEqual(["a", "b"]);
  });
});

describe("splitCsvNumbers — comma-separated numeric array flags", () => {
  it("parses each segment to a number", () => {
    expect(splitCsvNumbers("1,2,3")).toEqual([1, 2, 3]);
  });

  it("ignores non-numeric segments", () => {
    expect(splitCsvNumbers("1,x,3")).toEqual([1, 3]);
  });
});
