/**
 * Tests for the v2 companies extension:
 *   company managed                          → companies.managed             (read, self, paginated)
 *   company followers <id>                   → companies.followers           (read, paginated) [re-added]
 *   company invitable-followers <id>         → companies.invitableFollowers  (read, paginated)
 *   company chats <id>                       → companies.chats               (Beta, read, paginated)
 *   company chat <id> <chat_id>              → companies.chat                (Beta, read, scalar)
 *   company messages <id> <chat_id>          → companies.messages            (Beta, read, paginated)
 *   company message <id> <chat_id> <msg_id>  → companies.message             (Beta, read, scalar)
 *   company search-chats <id> (mode)         → companies.searchChats         (Beta, read, paginated)
 *
 * The SDK boundary is stubbed. Every subcommand is a read: --preview → exit 2.
 * A numeric <id> passes straight through; a slug/URL is resolved to the numeric
 * provider_id via companies.get first (mirrors `company employees`).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Mock } from "vitest";

function makeNs() {
  return {
    companies: {
      get: vi.fn(),
      managed: vi.fn(),
      followers: vi.fn(),
      invitableFollowers: vi.fn(),
      chats: vi.fn(),
      chat: vi.fn(),
      messages: vi.fn(),
      message: vi.fn(),
      searchChats: vi.fn(),
    },
  };
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

describe("company managed", () => {
  let ns: ReturnType<typeof makeNs>;
  let client: ReturnType<typeof makeClient>;
  beforeEach(() => {
    ns = makeNs();
    client = makeClient(ns);
    (ns.companies.managed as Mock).mockResolvedValue({ object: "managed_company_list", items: [{ id: "112013061" }], cursor: null });
  });
  afterEach(() => vi.restoreAllMocks());

  it("lists administered pages with no identifier (a self read)", async () => {
    const { runCompanyManaged } = await import("../../src/commands/company.js");
    const out = makeOut();
    await runCompanyManaged(client as never, { account: "acc_1", json: true, limit: "5" } as Flags, out);
    expect(ns.companies.managed).toHaveBeenCalledWith({ limit: 5 });
    expect(ns.companies.get).not.toHaveBeenCalled();
    expect((JSON.parse(stdout(out)) as { items: unknown[] }).items).toHaveLength(1);
  });

  it("--preview → exit 2 (read command)", async () => {
    const { runCompanyManaged } = await import("../../src/commands/company.js");
    const out = makeOut();
    const exit = mockExit();
    try {
      await runCompanyManaged(client as never, { account: "acc_1", preview: true } as Flags, out);
      expect.fail("should exit");
    } catch (e) {
      expect((e as Error).message).toContain("process.exit(2)");
    } finally {
      exit.mockRestore();
    }
  });
});

describe("company followers (re-added)", () => {
  let ns: ReturnType<typeof makeNs>;
  let client: ReturnType<typeof makeClient>;
  beforeEach(() => {
    ns = makeNs();
    client = makeClient(ns);
    (ns.companies.followers as Mock).mockResolvedValue({ object: "company_follower_list", items: [{ degree: 1 }], cursor: null });
  });
  afterEach(() => vi.restoreAllMocks());

  it("numeric id passes through with NO companies.get call", async () => {
    const { runCompanyFollowers } = await import("../../src/commands/company.js");
    const out = makeOut();
    await runCompanyFollowers(client as never, { account: "acc_1", json: true, id: "112013061", limit: "3" } as Flags, out);
    expect(ns.companies.get).not.toHaveBeenCalled();
    expect(ns.companies.followers).toHaveBeenCalledWith("112013061", { limit: 3 });
  });

  it("a slug is resolved to the numeric id via companies.get first", async () => {
    (ns.companies.get as Mock).mockResolvedValue({ id: "112013061" });
    const { runCompanyFollowers } = await import("../../src/commands/company.js");
    const out = makeOut();
    await runCompanyFollowers(client as never, { account: "acc_1", json: true, id: "anthropic" } as Flags, out);
    expect(ns.companies.get).toHaveBeenCalledWith("anthropic");
    expect(ns.companies.followers).toHaveBeenCalledWith("112013061", {});
  });

  it("--all streams every page, walking the cursor", async () => {
    (ns.companies.followers as Mock)
      .mockResolvedValueOnce({ object: "company_follower_list", items: [{ degree: 1 }], cursor: "c1" })
      .mockResolvedValueOnce({ object: "company_follower_list", items: [{ degree: 2 }], cursor: null });
    const { runCompanyFollowers } = await import("../../src/commands/company.js");
    const out = makeOut();
    await runCompanyFollowers(client as never, { account: "acc_1", json: true, id: "112013061", all: true, "page-delay": "0" } as Flags, out);
    const lines = stdout(out).trim().split("\n").filter(Boolean);
    expect(lines).toHaveLength(2);
    expect(ns.companies.followers).toHaveBeenNthCalledWith(2, "112013061", { cursor: "c1" });
  });
});

describe("company invitable-followers", () => {
  let ns: ReturnType<typeof makeNs>;
  let client: ReturnType<typeof makeClient>;
  beforeEach(() => {
    ns = makeNs();
    client = makeClient(ns);
    (ns.companies.invitableFollowers as Mock).mockResolvedValue({ object: "company_invitable_follower_list", items: [], cursor: null });
  });
  afterEach(() => vi.restoreAllMocks());

  it("numeric id passes through, empty list is a valid result", async () => {
    const { runCompanyInvitableFollowers } = await import("../../src/commands/company.js");
    const out = makeOut();
    await runCompanyInvitableFollowers(client as never, { account: "acc_1", json: true, id: "112013061" } as Flags, out);
    expect(ns.companies.invitableFollowers).toHaveBeenCalledWith("112013061", {});
    expect((JSON.parse(stdout(out)) as { items: unknown[] }).items).toEqual([]);
  });
});

describe("company chats / chat (Beta)", () => {
  let ns: ReturnType<typeof makeNs>;
  let client: ReturnType<typeof makeClient>;
  beforeEach(() => {
    ns = makeNs();
    client = makeClient(ns);
    (ns.companies.chats as Mock).mockResolvedValue({ object: "company_chat_list", items: [{ id: "chat_1" }], cursor: null });
    (ns.companies.chat as Mock).mockResolvedValue({ object: "company_chat", id: "chat_1", last_message: { text: "hi" } });
  });
  afterEach(() => vi.restoreAllMocks());

  it("chats lists the inbox for a numeric id", async () => {
    const { runCompanyChats } = await import("../../src/commands/company.js");
    const out = makeOut();
    await runCompanyChats(client as never, { account: "acc_1", json: true, id: "112013061", limit: "10" } as Flags, out);
    expect(ns.companies.chats).toHaveBeenCalledWith("112013061", { limit: 10 });
  });

  it("chat retrieves one conversation (id + chat_id), content passes through verbatim", async () => {
    const { runCompanyChat } = await import("../../src/commands/company.js");
    const out = makeOut();
    await runCompanyChat(client as never, { account: "acc_1", json: true, id: "112013061", chatId: "chat_1" } as Flags, out);
    expect(ns.companies.chat).toHaveBeenCalledWith("112013061", "chat_1");
    const result = JSON.parse(stdout(out)) as { last_message: { text: string } };
    expect(result.last_message.text).toBe("hi");
  });

  it("chat --all → exit 2 (non-paginated scalar)", async () => {
    const { runCompanyChat } = await import("../../src/commands/company.js");
    const out = makeOut();
    const exit = mockExit();
    try {
      await runCompanyChat(client as never, { account: "acc_1", id: "112013061", chatId: "chat_1", all: true } as Flags, out);
      expect.fail("should exit");
    } catch (e) {
      expect((e as Error).message).toContain("process.exit(2)");
    } finally {
      exit.mockRestore();
    }
  });
});

describe("company messages / message (Beta)", () => {
  let ns: ReturnType<typeof makeNs>;
  let client: ReturnType<typeof makeClient>;
  beforeEach(() => {
    ns = makeNs();
    client = makeClient(ns);
    (ns.companies.messages as Mock).mockResolvedValue({ object: "company_chat_message_list", items: [{ id: "m1", text: "hi" }], cursor: null });
    (ns.companies.message as Mock).mockResolvedValue({ object: "company_chat_message", id: "m1", text: "hi" });
  });
  afterEach(() => vi.restoreAllMocks());

  it("messages lists a conversation's messages (id + chat_id + pagination)", async () => {
    const { runCompanyMessages } = await import("../../src/commands/company.js");
    const out = makeOut();
    await runCompanyMessages(client as never, { account: "acc_1", json: true, id: "112013061", chatId: "chat_1", limit: "20" } as Flags, out);
    expect(ns.companies.messages).toHaveBeenCalledWith("112013061", "chat_1", { limit: 20 });
  });

  it("message retrieves one message (id + chat_id + message_id)", async () => {
    const { runCompanyMessage } = await import("../../src/commands/company.js");
    const out = makeOut();
    await runCompanyMessage(client as never, { account: "acc_1", json: true, id: "112013061", chatId: "chat_1", messageId: "m1" } as Flags, out);
    expect(ns.companies.message).toHaveBeenCalledWith("112013061", "chat_1", "m1");
  });
});

describe("company search-chats (Beta) — exactly one mode", () => {
  let ns: ReturnType<typeof makeNs>;
  let client: ReturnType<typeof makeClient>;
  beforeEach(() => {
    ns = makeNs();
    client = makeClient(ns);
    (ns.companies.searchChats as Mock).mockResolvedValue({ object: "company_chat_search", items: [{ id: "chat_1" }], cursor: null });
  });
  afterEach(() => vi.restoreAllMocks());

  it("--topic mode forwards the topic filter", async () => {
    const { runCompanySearchChats } = await import("../../src/commands/company.js");
    const out = makeOut();
    await runCompanySearchChats(client as never, { account: "acc_1", json: true, id: "112013061", topic: "1" } as Flags, out);
    expect(ns.companies.searchChats).toHaveBeenCalledWith("112013061", { topic: "1" });
  });

  it("--unread mode sends unread:true", async () => {
    const { runCompanySearchChats } = await import("../../src/commands/company.js");
    const out = makeOut();
    await runCompanySearchChats(client as never, { account: "acc_1", json: true, id: "112013061", unread: true } as Flags, out);
    expect(ns.companies.searchChats).toHaveBeenCalledWith("112013061", { unread: true });
  });

  it("two modes (--query + --topic) → arity error exit 2 BEFORE any call", async () => {
    const { runCompanySearchChats } = await import("../../src/commands/company.js");
    const out = makeOut();
    const exit = mockExit();
    try {
      await runCompanySearchChats(client as never, { account: "acc_1", json: true, id: "112013061", query: "x", topic: "1" } as Flags, out);
      expect.fail("should exit");
    } catch (e) {
      expect((e as Error).message).toContain("process.exit(2)");
    } finally {
      exit.mockRestore();
    }
    expect(ns.companies.searchChats).not.toHaveBeenCalled();
    expect(ns.companies.get).not.toHaveBeenCalled();
  });

  it("zero modes → arity error exit 2 (exactly one mode required)", async () => {
    const { runCompanySearchChats } = await import("../../src/commands/company.js");
    const out = makeOut();
    const exit = mockExit();
    try {
      await runCompanySearchChats(client as never, { account: "acc_1", json: true, id: "112013061" } as Flags, out);
      expect.fail("should exit");
    } catch (e) {
      expect((e as Error).message).toContain("process.exit(2)");
    } finally {
      exit.mockRestore();
    }
    expect(ns.companies.searchChats).not.toHaveBeenCalled();
  });
});
