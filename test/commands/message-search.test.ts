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

  // Curation 2 (LinkedIn-Actions M3, post-qa-live-reverify fix).
  // The original curation (see git history) was built from the SDK TYPE,
  // which over-declares fields the live `search-chats` endpoint does NOT
  // return (`user{}`, `last_message_timestamp`, `last_message.timestamp`,
  // `last_message.is_sender`, read-receipt/UI-state/reaction/folder
  // metadata) — the slim projector synthesized those as null, a footgun for
  // a typed agent reading e.g. `item.user.display_name`. This fixture is the
  // LIVE-ACTUAL item shape qa captured against the real substrate: object,
  // account_id, id, name, type, is_group, is_1to1, unread_count, user_id,
  // last_message{object, account_id, id, text, sender_id, attachments[]}.
  // No `user{}`, no timestamps, no is_sender — those keys simply do not
  // exist on the wire, and the fixture must not invent them either.
  const fullSearchItem = {
    object: "chat",
    account_id: "acc_1",
    id: "chat_1",
    name: "Sophie Keller",
    type: "1to1",
    is_group: false,
    is_1to1: true,
    unread_count: 2,
    user_id: "ACoAA_sophie",
    last_message: {
      object: "message",
      account_id: "acc_1",
      id: "msg_1",
      text: "Let's connect next week",
      sender_id: "ACoAA_sophie",
      attachments: [
        { id: "att_1", mimetype: "image/png", type: "img", filename: "x.png", file_size: 100, unavailable: false },
      ],
    },
  };

  it("default output keeps identity/priority/content/retrieval-id and drops the live-verbose-only fields — no synthesized user{}/timestamp/is_sender", async () => {
    (ns.messaging.searchChats as Mock).mockResolvedValue({ object: "chat_list", items: [fullSearchItem], cursor: null });
    const { runMessageSearch } = await import("../../src/commands/message.js");
    const out = makeOut();
    await runMessageSearch(client as never, { account: "acc_1", json: true, query: "sophie" } as Flags, out);
    const result = JSON.parse(stdout(out)) as { items: Array<Record<string, unknown>>; cursor: unknown };
    const item = result.items[0]!;

    // Retrieval id + the triage set the founder called out explicitly.
    expect(item["id"]).toBe("chat_1");
    expect(item["user_id"]).toBe("ACoAA_sophie");
    expect((item["last_message"] as Record<string, unknown>)["text"]).toBe("Let's connect next week");

    // Rest of the default field set.
    expect(item["object"]).toBe("chat");
    expect(item["name"]).toBe("Sophie Keller");
    expect(item["type"]).toBe("1to1");
    expect(item["unread_count"]).toBe(2);
    expect(item["last_message"]).toEqual({
      id: "msg_1",
      sender_id: "ACoAA_sophie",
      text: "Let's connect next week",
    });
    expect(result.cursor).toBeNull();

    // Verbose-only fields (live-actual, redundant-with-type or noisy) are
    // gone from the default.
    expect(item).not.toHaveProperty("account_id");
    expect(item).not.toHaveProperty("is_group");
    expect(item).not.toHaveProperty("is_1to1");
    const lastMessage = item["last_message"] as Record<string, unknown>;
    expect(lastMessage).not.toHaveProperty("account_id");
    expect(lastMessage).not.toHaveProperty("attachments");

    // The whole point of the fix: no field the live endpoint doesn't return
    // is ever synthesized into the default — no null `user{}`, no null
    // timestamp, no null is_sender.
    expect(item).not.toHaveProperty("user");
    expect(item).not.toHaveProperty("last_message_timestamp");
    expect(lastMessage).not.toHaveProperty("timestamp");
    expect(lastMessage).not.toHaveProperty("is_sender");
  });

  it("--verbose returns the full raw item, exactly the live-actual keys — account_id/is_group/is_1to1/last_message.attachments included, still no user{}/timestamp/is_sender", async () => {
    (ns.messaging.searchChats as Mock).mockResolvedValue({ object: "chat_list", items: [fullSearchItem], cursor: null });
    const { runMessageSearch } = await import("../../src/commands/message.js");
    const out = makeOut();
    await runMessageSearch(client as never, { account: "acc_1", json: true, query: "sophie", verbose: true } as Flags, out);
    const result = JSON.parse(stdout(out)) as { items: Array<Record<string, unknown>> };
    expect(result.items[0]).toEqual(fullSearchItem);
  });

  it("--all streams the raw (unslimmed) item — slim does not apply to the NDJSON path", async () => {
    (ns.messaging.searchChats as Mock).mockResolvedValueOnce({ object: "chat_list", items: [fullSearchItem], cursor: null });
    const { runMessageSearch } = await import("../../src/commands/message.js");
    const out = makeOut();
    await runMessageSearch(client as never, { account: "acc_1", json: true, query: "sophie", all: true, "page-delay": "0" } as Flags, out);
    const lines = stdout(out).trim().split("\n").filter(Boolean);
    expect(JSON.parse(lines[0]!)).toEqual(fullSearchItem);
  });
});
