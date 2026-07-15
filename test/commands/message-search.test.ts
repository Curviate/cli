/**
 * Tests for `message search <query>` → messaging.searchChats (read, paginated).
 *
 * The SDK boundary is stubbed. A read: --preview → exit 2. The query positional
 * is required. A token-prefix no-match returns an empty list (not an error).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Mock } from "vitest";

function makeNs() {
  return { messaging: { searchChats: vi.fn() } };
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

describe("message search", () => {
  let ns: ReturnType<typeof makeNs>;
  let client: ReturnType<typeof makeClient>;
  beforeEach(() => {
    ns = makeNs();
    client = makeClient(ns);
    (ns.messaging.searchChats as Mock).mockResolvedValue({ object: "chat_search", items: [{ id: "chat_1", unread_count: 1 }], cursor: null });
  });
  afterEach(() => vi.restoreAllMocks());

  it("forwards the query positional plus limit/cursor", async () => {
    const { runMessageSearch } = await import("../../src/commands/message.js");
    const out = makeOut();
    await runMessageSearch(client as never, { account: "acc_1", json: true, query: "sophie", limit: "20", cursor: "c0" } as Flags, out);
    expect(client.account).toHaveBeenCalledWith("acc_1");
    expect(ns.messaging.searchChats).toHaveBeenCalledWith({ query: "sophie", limit: 20, cursor: "c0" });
    expect((JSON.parse(stdout(out)) as { items: unknown[] }).items).toHaveLength(1);
  });

  it("a token-prefix no-match (empty list) is a valid result, not an error", async () => {
    (ns.messaging.searchChats as Mock).mockResolvedValue({ object: "chat_search", items: [], cursor: null });
    const { runMessageSearch } = await import("../../src/commands/message.js");
    const out = makeOut();
    await runMessageSearch(client as never, { account: "acc_1", json: true, query: "zzz" } as Flags, out);
    expect((JSON.parse(stdout(out)) as { items: unknown[] }).items).toEqual([]);
  });

  it("missing query → exit 2 before any call", async () => {
    const { runMessageSearch } = await import("../../src/commands/message.js");
    const out = makeOut();
    const exit = mockExit();
    try {
      await runMessageSearch(client as never, { account: "acc_1", json: true } as Flags, out);
      expect.fail("should exit");
    } catch (e) {
      expect((e as Error).message).toContain("process.exit(2)");
    } finally {
      exit.mockRestore();
    }
    expect(ns.messaging.searchChats).not.toHaveBeenCalled();
  });

  it("--preview → exit 2 (read command)", async () => {
    const { runMessageSearch } = await import("../../src/commands/message.js");
    const out = makeOut();
    const exit = mockExit();
    try {
      await runMessageSearch(client as never, { account: "acc_1", query: "sophie", preview: true } as Flags, out);
      expect.fail("should exit");
    } catch (e) {
      expect((e as Error).message).toContain("process.exit(2)");
    } finally {
      exit.mockRestore();
    }
  });

  it("--all streams pages, walking the cursor", async () => {
    (ns.messaging.searchChats as Mock)
      .mockResolvedValueOnce({ object: "chat_search", items: [{ id: "chat_1" }], cursor: "c1" })
      .mockResolvedValueOnce({ object: "chat_search", items: [{ id: "chat_2" }], cursor: null });
    const { runMessageSearch } = await import("../../src/commands/message.js");
    const out = makeOut();
    await runMessageSearch(client as never, { account: "acc_1", json: true, query: "a", all: true, "page-delay": "0" } as Flags, out);
    const lines = stdout(out).trim().split("\n").filter(Boolean);
    expect(lines).toHaveLength(2);
    expect(ns.messaging.searchChats).toHaveBeenNthCalledWith(2, { query: "a", cursor: "c1" });
  });
});
