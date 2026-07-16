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

  // Curation 1 (LinkedIn-Actions M3 verbosity curation, founder-approved,
  // binding model: generous SUFFICIENT default + --verbose exposes only
  // deep/noisy extras). `message search` is the richest/noisiest response in
  // the whole 26-command set — a raw substrate passthrough with a typo'd
  // field (is_mentionned) and read-receipt/UI-state/attachment internals.
  // Default keeps who/what/unread/recency/direction/id; the rest moves to
  // --verbose only. See slimMessageSearch in lib/slim.ts.
  const fullSearchItem = {
    object: "chat",
    id: "chat_1",
    account_id: "acc_1",
    name: "Sophie Keller",
    type: "1to1",
    is_group: false,
    is_1to1: true,
    is_channel: false,
    is_pinned: false,
    is_readonly: false,
    is_archived: false,
    muted_until: false,
    unread_count: 2,
    folders: ["INBOX"],
    provider: "linkedin",
    created_at: "2026-01-01T00:00:00Z",
    last_message_timestamp: "2026-07-15T12:00:00Z",
    user_id: "ACoAA_sophie",
    last_message: {
      object: "message",
      id: "msg_1",
      account_id: "acc_1",
      chat_id: "chat_1",
      sender_id: "ACoAA_sophie",
      text: "Let's connect next week",
      attachments: [
        { id: "att_1", mimetype: "image/png", type: "img", filename: "x.png", file_size: 100, unavailable: false },
      ],
      timestamp: "2026-07-15T12:00:00Z",
      is_sender: false,
      is_seen: true,
      is_delivered: true,
      is_edited: false,
      is_mentionned: false,
      reactions: [{ type: "LIKE", count: 1 }],
      reaction_count: 1,
      provider: "linkedin",
    },
    user: {
      id: "ACoAA_sophie",
      type: "individual",
      display_name: "Sophie Keller",
      profile_url: "https://www.linkedin.com/in/sophie-keller",
      public_picture_url: "https://example.com/pic.jpg",
    },
  };

  it("default output keeps who/what/unread/recency/direction/id and drops the read-receipt/UI-state/attachment internals", async () => {
    (ns.messaging.searchChats as Mock).mockResolvedValue({ object: "chat_list", items: [fullSearchItem], cursor: null });
    const { runMessageSearch } = await import("../../src/commands/message.js");
    const out = makeOut();
    await runMessageSearch(client as never, { account: "acc_1", json: true, query: "sophie" } as Flags, out);
    const result = JSON.parse(stdout(out)) as { items: Array<Record<string, unknown>>; cursor: unknown };
    const item = result.items[0]!;

    // Retrieval id + the triage set the founder called out explicitly.
    expect(item["id"]).toBe("chat_1");
    expect((item["user"] as Record<string, unknown>)["id"]).toBe("ACoAA_sophie");
    expect((item["last_message"] as Record<string, unknown>)["text"]).toBe("Let's connect next week");

    // Rest of the default field set.
    expect(item["object"]).toBe("chat");
    expect(item["name"]).toBe("Sophie Keller");
    expect(item["type"]).toBe("1to1");
    expect(item["unread_count"]).toBe(2);
    expect(item["last_message_timestamp"]).toBe("2026-07-15T12:00:00Z");
    expect(item["user_id"]).toBe("ACoAA_sophie");
    expect(item["user"]).toEqual({
      id: "ACoAA_sophie",
      display_name: "Sophie Keller",
      profile_url: "https://www.linkedin.com/in/sophie-keller",
    });
    expect(item["last_message"]).toEqual({
      id: "msg_1",
      sender_id: "ACoAA_sophie",
      text: "Let's connect next week",
      timestamp: "2026-07-15T12:00:00Z",
      is_sender: false,
    });
    expect(result.cursor).toBeNull();

    // Verbose-only fields are gone from the default.
    expect(item).not.toHaveProperty("account_id");
    expect(item).not.toHaveProperty("is_group");
    expect(item).not.toHaveProperty("is_1to1");
    expect(item).not.toHaveProperty("is_channel");
    expect(item).not.toHaveProperty("is_pinned");
    expect(item).not.toHaveProperty("is_readonly");
    expect(item).not.toHaveProperty("is_archived");
    expect(item).not.toHaveProperty("muted_until");
    expect(item).not.toHaveProperty("folders");
    expect(item).not.toHaveProperty("provider");
    expect(item).not.toHaveProperty("created_at");
    const lastMessage = item["last_message"] as Record<string, unknown>;
    expect(lastMessage).not.toHaveProperty("chat_id");
    expect(lastMessage).not.toHaveProperty("account_id");
    expect(lastMessage).not.toHaveProperty("attachments");
    expect(lastMessage).not.toHaveProperty("is_seen");
    expect(lastMessage).not.toHaveProperty("is_delivered");
    expect(lastMessage).not.toHaveProperty("is_edited");
    expect(lastMessage).not.toHaveProperty("is_mentionned");
    expect(lastMessage).not.toHaveProperty("reactions");
    expect(lastMessage).not.toHaveProperty("reaction_count");
    expect(lastMessage).not.toHaveProperty("provider");
    const user = item["user"] as Record<string, unknown>;
    expect(user).not.toHaveProperty("type");
    expect(user).not.toHaveProperty("public_picture_url");
  });

  it("--verbose returns the full raw item, every read-receipt/UI-state/attachment field included", async () => {
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
