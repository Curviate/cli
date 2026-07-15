/**
 * Tests for the v2 search extensions:
 *   search groups <keywords>           → search.groups               (GET, read, paginated)
 *   search services [filters]          → search.services             (POST body, read, paginated)
 *   search service-parameters          → search.getServiceParameters (GET, read)
 *
 * The SDK boundary is stubbed. Reads reject --preview. `search groups` requires
 * a keywords positional; `search service-parameters` requires --keywords.
 * `search services` assembles keywords + service_category/location/connections/
 * language into the body (comma-separated OR repeated values).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

function makeNs() {
  return { search: { groups: vi.fn(), services: vi.fn(), getServiceParameters: vi.fn() } };
}
function makeClient(ns: ReturnType<typeof makeNs>) {
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

describe("search groups", () => {
  let ns: ReturnType<typeof makeNs>;
  let client: ReturnType<typeof makeClient>;
  beforeEach(() => {
    ns = makeNs();
    client = makeClient(ns);
    (ns.search.groups as Mock).mockResolvedValue({ object: "group_search", items: [{ id: "9123014", name: "GTM" }], cursor: null });
  });
  afterEach(() => vi.restoreAllMocks());

  it("forwards the keywords positional plus limit", async () => {
    const { runSearchGroups } = await import("../../src/commands/search.js");
    const out = makeOut();
    await runSearchGroups(client as never, { account: "acc_1", json: true, keywords: "gtm engineering", limit: "5" } as Flags, out);
    expect(ns.search.groups).toHaveBeenCalledWith({ keywords: "gtm engineering", limit: 5 });
  });

  it("missing keywords → exit 2 before any call", async () => {
    const { runSearchGroups } = await import("../../src/commands/search.js");
    const out = makeOut();
    const exit = mockExit();
    try {
      await runSearchGroups(client as never, { account: "acc_1", json: true } as Flags, out);
      expect.fail("should exit");
    } catch (e) {
      expect((e as Error).message).toContain("process.exit(2)");
    } finally {
      exit.mockRestore();
    }
    expect(ns.search.groups).not.toHaveBeenCalled();
  });

  it("--preview → exit 2 (read command)", async () => {
    const { runSearchGroups } = await import("../../src/commands/search.js");
    const out = makeOut();
    const exit = mockExit();
    try {
      await runSearchGroups(client as never, { account: "acc_1", keywords: "x", preview: true } as Flags, out);
      expect.fail("should exit");
    } catch (e) {
      expect((e as Error).message).toContain("process.exit(2)");
    } finally {
      exit.mockRestore();
    }
  });
});

describe("search services", () => {
  let ns: ReturnType<typeof makeNs>;
  let client: ReturnType<typeof makeClient>;
  beforeEach(() => {
    ns = makeNs();
    client = makeClient(ns);
    (ns.search.services as Mock).mockResolvedValue({ object: "service_provider_search", items: [{ id: "p1" }], cursor: null });
  });
  afterEach(() => vi.restoreAllMocks());

  it("assembles service_category / connections into the body (typed arrays)", async () => {
    const { runSearchServices } = await import("../../src/commands/search.js");
    const out = makeOut();
    await runSearchServices(
      client as never,
      { account: "acc_1", json: true, "service-category": "296", connections: "2", limit: "10" } as Flags,
      out,
    );
    expect(ns.search.services).toHaveBeenCalledWith({
      service_category: ["296"],
      connections: [2],
      limit: 10,
    });
  });

  it("accepts a repeated --service-category flag (array) and comma-separated --language", async () => {
    const { runSearchServices } = await import("../../src/commands/search.js");
    const out = makeOut();
    await runSearchServices(
      client as never,
      { account: "acc_1", json: true, "service-category": ["296", "297"], language: "en,de" } as Flags,
      out,
    );
    expect(ns.search.services).toHaveBeenCalledWith({
      service_category: ["296", "297"],
      language: ["en", "de"],
    });
  });

  it("keywords-only search is allowed (server enforces at-least-one)", async () => {
    const { runSearchServices } = await import("../../src/commands/search.js");
    const out = makeOut();
    await runSearchServices(client as never, { account: "acc_1", json: true, keywords: "logo design" } as Flags, out);
    expect(ns.search.services).toHaveBeenCalledWith({ keywords: "logo design" });
  });

  it("--preview → exit 2 (read command)", async () => {
    const { runSearchServices } = await import("../../src/commands/search.js");
    const out = makeOut();
    const exit = mockExit();
    try {
      await runSearchServices(client as never, { account: "acc_1", keywords: "x", preview: true } as Flags, out);
      expect.fail("should exit");
    } catch (e) {
      expect((e as Error).message).toContain("process.exit(2)");
    } finally {
      exit.mockRestore();
    }
  });
});

describe("search service-parameters", () => {
  let ns: ReturnType<typeof makeNs>;
  let client: ReturnType<typeof makeClient>;
  beforeEach(() => {
    ns = makeNs();
    client = makeClient(ns);
    (ns.search.getServiceParameters as Mock).mockResolvedValue({ object: "service_parameter_list", items: [{ id: "296", label: "Marketing" }] });
  });
  afterEach(() => vi.restoreAllMocks());

  it("forwards --type and --keywords", async () => {
    const { runSearchServiceParameters } = await import("../../src/commands/search.js");
    const out = makeOut();
    await runSearchServiceParameters(client as never, { account: "acc_1", json: true, type: "location", keywords: "united" } as Flags, out);
    expect(ns.search.getServiceParameters).toHaveBeenCalledWith({ type: "location", keywords: "united" });
  });

  it("defaults type off (server defaults to service_category) when only --keywords is given", async () => {
    const { runSearchServiceParameters } = await import("../../src/commands/search.js");
    const out = makeOut();
    await runSearchServiceParameters(client as never, { account: "acc_1", json: true, keywords: "marke" } as Flags, out);
    expect(ns.search.getServiceParameters).toHaveBeenCalledWith({ keywords: "marke" });
  });

  it("missing --keywords → exit 2", async () => {
    const { runSearchServiceParameters } = await import("../../src/commands/search.js");
    const out = makeOut();
    const exit = mockExit();
    try {
      await runSearchServiceParameters(client as never, { account: "acc_1", type: "location" } as Flags, out);
      expect.fail("should exit");
    } catch (e) {
      expect((e as Error).message).toContain("process.exit(2)");
    } finally {
      exit.mockRestore();
    }
    expect(ns.search.getServiceParameters).not.toHaveBeenCalled();
  });

  it("--all → exit 2 (non-paginated, mirrors search parameters)", async () => {
    const { runSearchServiceParameters } = await import("../../src/commands/search.js");
    const out = makeOut();
    const exit = mockExit();
    try {
      await runSearchServiceParameters(client as never, { account: "acc_1", keywords: "x", all: true } as Flags, out);
      expect.fail("should exit");
    } catch (e) {
      expect((e as Error).message).toContain("process.exit(2)");
    } finally {
      exit.mockRestore();
    }
  });
});
