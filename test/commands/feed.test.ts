/**
 * Tests for the `feed` command group:
 *   feed home [--sort recent|relevant]   → feed.home (read, paginated)
 *
 * The SDK boundary is stubbed. A read: --preview is a usage error (exit 2).
 * --sort is forwarded verbatim (server-authoritative). The feed is unbounded
 * and reordering — walk the cursor (--all) to exhaustion.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Mock } from "vitest";

function makeNs() {
  return { feed: { home: vi.fn() } };
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
function stdout(out: ReturnType<typeof makeOut>): string {
  return (out.stdout.write as Mock).mock.calls.map((c) => c[0] as string).join("");
}
type Flags = Record<string, unknown>;

describe("feed home", () => {
  let ns: ReturnType<typeof makeNs>;
  let client: ReturnType<typeof makeClient>;
  beforeEach(() => {
    ns = makeNs();
    client = makeClient(ns);
    (ns.feed.home as Mock).mockResolvedValue({ object: "feed_post_list", items: [{ id: "urn:li:activity:1", text: "hello" }], cursor: "c1" });
  });
  afterEach(() => vi.restoreAllMocks());

  it("default: no --sort forwarded, prints the page", async () => {
    const { runFeedHome } = await import("../../src/commands/feed.js");
    const out = makeOut();
    await runFeedHome(client as never, { account: "acc_1", json: true } as Flags, out);
    expect(client.account).toHaveBeenCalledWith("acc_1");
    expect(ns.feed.home).toHaveBeenCalledWith({});
    expect((JSON.parse(stdout(out)) as { items: unknown[] }).items).toHaveLength(1);
  });

  it("forwards --sort relevant and --limit", async () => {
    const { runFeedHome } = await import("../../src/commands/feed.js");
    const out = makeOut();
    await runFeedHome(client as never, { account: "acc_1", json: true, sort: "relevant", limit: "10" } as Flags, out);
    expect(ns.feed.home).toHaveBeenCalledWith({ sort: "relevant", limit: 10 });
  });

  it("--preview → exit 2 (read command)", async () => {
    const { runFeedHome } = await import("../../src/commands/feed.js");
    const out = makeOut();
    const exit = mockExit();
    try {
      await runFeedHome(client as never, { account: "acc_1", preview: true } as Flags, out);
      expect.fail("should exit");
    } catch (e) {
      expect((e as Error).message).toContain("process.exit(2)");
    } finally {
      exit.mockRestore();
    }
    expect(ns.feed.home).not.toHaveBeenCalled();
  });

  it("--all streams pages and walks the cursor to exhaustion", async () => {
    (ns.feed.home as Mock)
      .mockResolvedValueOnce({ object: "feed_post_list", items: [{ id: "1" }], cursor: "c1" })
      .mockResolvedValueOnce({ object: "feed_post_list", items: [{ id: "2" }], cursor: null });
    const { runFeedHome } = await import("../../src/commands/feed.js");
    const out = makeOut();
    await runFeedHome(client as never, { account: "acc_1", json: true, all: true, sort: "recent", "page-delay": "0" } as Flags, out);
    const lines = stdout(out).trim().split("\n").filter(Boolean);
    expect(lines).toHaveLength(2);
    // The follow-up page carries the cursor; the cursor's carrier is authoritative for sort.
    expect(ns.feed.home).toHaveBeenNthCalledWith(2, { sort: "recent", cursor: "c1" });
  });

  it("without --account → exit 2", async () => {
    const { runFeedHome } = await import("../../src/commands/feed.js");
    const out = makeOut();
    const exit = mockExit();
    try {
      await runFeedHome(client as never, { json: true } as Flags, out);
      expect.fail("should exit");
    } catch (e) {
      expect((e as Error).message).toContain("process.exit(2)");
    } finally {
      exit.mockRestore();
    }
  });
});
