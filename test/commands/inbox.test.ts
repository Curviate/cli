/**
 * Tests for the `inbox` command group.
 *
 * Coverage:
 *   inbox list              → messaging.listChats (paginated: --all / --limit / --cursor)
 *   inbox get <chat_id>     → messaging.getChat (not paginated, rejects --all, rejects --preview)
 *   inbox messages <chat_id>→ messaging.listMessages (paginated)
 *   inbox sync              → messaging.syncMessages (rejects --all, rejects --preview)
 *   inbox sync-chat <chat_id> → messaging.syncChat (rejects --all, rejects --preview)
 *
 * IDs (chat_id, message_id) pass through verbatim — NOT resolved via resolveIdentifier.
 * All subcommands are account-scoped (error exit 2 when no account).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Mock } from "vitest";

function makeMessagingNs() {
  return {
    messaging: {
      listChats: vi.fn(),
      getChat: vi.fn(),
      listMessages: vi.fn(),
      syncMessages: vi.fn(),
      syncChat: vi.fn(),
    },
  };
}

function makeClient(ns: ReturnType<typeof makeMessagingNs>) {
  return {
    account: vi.fn().mockReturnValue(ns),
  };
}

type InboxArgs = {
  chatId?: string;
  account?: string;
  json?: boolean;
  fields?: string;
  limit?: string;
  cursor?: string;
  all?: boolean;
  "max-pages"?: string;
  preview?: boolean;
  "api-key"?: string;
  "base-url"?: string;
  timeout?: string;
  profile?: string;
};

describe("inbox list", () => {
  let ns: ReturnType<typeof makeMessagingNs>;
  let client: ReturnType<typeof makeClient>;

  beforeEach(() => {
    ns = makeMessagingNs();
    client = makeClient(ns);
    (ns.messaging.listChats as Mock).mockResolvedValue({ items: [], cursor: null });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("inbox list — calls messaging.listChats with account", async () => {
    const { runInboxList } = await import("../../src/commands/inbox.js");
    const out = { stdout: { write: vi.fn() }, stderr: { write: vi.fn() } };

    await runInboxList(client as never, { account: "acc_1", json: true } as InboxArgs, out);

    expect(client.account).toHaveBeenCalledWith("acc_1");
    expect(ns.messaging.listChats).toHaveBeenCalled();
  });

  it("inbox list --limit 5 --cursor c1 — passes limit and cursor to SDK", async () => {
    const { runInboxList } = await import("../../src/commands/inbox.js");
    const out = { stdout: { write: vi.fn() }, stderr: { write: vi.fn() } };

    await runInboxList(client as never, { account: "acc_1", json: true, limit: "5", cursor: "c1" } as InboxArgs, out);

    expect(ns.messaging.listChats).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 5, cursor: "c1" }),
    );
  });

  it("inbox list --all — streams NDJSON across pages", async () => {
    const { runInboxList } = await import("../../src/commands/inbox.js");
    const out = { stdout: { write: vi.fn() }, stderr: { write: vi.fn() } };

    (ns.messaging.listChats as Mock)
      .mockResolvedValueOnce({ items: [{ id: "c1" }, { id: "c2" }], cursor: "next" })
      .mockResolvedValueOnce({ items: [{ id: "c3" }], cursor: null });

    await runInboxList(client as never, { account: "acc_1", all: true } as InboxArgs, out);

    const lines = (out.stdout.write as Mock).mock.calls.map((c) => c[0] as string);
    const ndjson = lines.filter((l) => l.trim().startsWith("{"));
    expect(ndjson).toHaveLength(3);
  });

  it("inbox list --preview — usage error exit 2 (preview on read)", async () => {
    const { runInboxList } = await import("../../src/commands/inbox.js");
    const out = { stdout: { write: vi.fn() }, stderr: { write: vi.fn() } };

    const exitSpy = vi.spyOn(process, "exit").mockImplementation((code?: number | string | null) => {
      throw new Error(`process.exit(${code})`);
    });
    try {
      await runInboxList(client as never, { account: "acc_1", preview: true } as InboxArgs, out);
      expect.fail("should have exited");
    } catch (e) {
      expect((e as Error).message).toContain("process.exit(2)");
    } finally {
      exitSpy.mockRestore();
    }
  });

  it("inbox list — missing account exits 2", async () => {
    const { runInboxList } = await import("../../src/commands/inbox.js");
    const out = { stdout: { write: vi.fn() }, stderr: { write: vi.fn() } };

    const exitSpy = vi.spyOn(process, "exit").mockImplementation((code?: number | string | null) => {
      throw new Error(`process.exit(${code})`);
    });
    try {
      await runInboxList(client as never, { json: true } as InboxArgs, out);
      expect.fail("should have exited");
    } catch (e) {
      expect((e as Error).message).toContain("process.exit(2)");
    } finally {
      exitSpy.mockRestore();
    }
  });
});

describe("inbox get", () => {
  let ns: ReturnType<typeof makeMessagingNs>;
  let client: ReturnType<typeof makeClient>;

  beforeEach(() => {
    ns = makeMessagingNs();
    client = makeClient(ns);
    (ns.messaging.getChat as Mock).mockResolvedValue({ id: "chat_1" });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("inbox get <chat_id> — calls getChat with verbatim id", async () => {
    const { runInboxGet } = await import("../../src/commands/inbox.js");
    const out = { stdout: { write: vi.fn() }, stderr: { write: vi.fn() } };

    await runInboxGet(client as never, { chatId: "chat_abc", account: "acc_1", json: true } as InboxArgs, out);

    expect(ns.messaging.getChat).toHaveBeenCalledWith("chat_abc");
  });

  it("inbox get — rejects --preview (read command)", async () => {
    const { runInboxGet } = await import("../../src/commands/inbox.js");
    const out = { stdout: { write: vi.fn() }, stderr: { write: vi.fn() } };

    const exitSpy = vi.spyOn(process, "exit").mockImplementation((code?: number | string | null) => {
      throw new Error(`process.exit(${code})`);
    });
    try {
      await runInboxGet(client as never, { chatId: "chat_abc", account: "acc_1", preview: true } as InboxArgs, out);
      expect.fail("should have exited");
    } catch (e) {
      expect((e as Error).message).toContain("process.exit(2)");
    } finally {
      exitSpy.mockRestore();
    }
  });

  it("inbox get — rejects --all (not paginated)", async () => {
    const { runInboxGet } = await import("../../src/commands/inbox.js");
    const out = { stdout: { write: vi.fn() }, stderr: { write: vi.fn() } };

    const exitSpy = vi.spyOn(process, "exit").mockImplementation((code?: number | string | null) => {
      throw new Error(`process.exit(${code})`);
    });
    try {
      await runInboxGet(client as never, { chatId: "chat_abc", account: "acc_1", all: true } as InboxArgs, out);
      expect.fail("should have exited");
    } catch (e) {
      expect((e as Error).message).toContain("process.exit(2)");
    } finally {
      exitSpy.mockRestore();
    }
  });
});

describe("inbox messages", () => {
  let ns: ReturnType<typeof makeMessagingNs>;
  let client: ReturnType<typeof makeClient>;

  beforeEach(() => {
    ns = makeMessagingNs();
    client = makeClient(ns);
    (ns.messaging.listMessages as Mock).mockResolvedValue({ items: [], cursor: null });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("inbox messages <chat_id> — calls listMessages with verbatim chat_id", async () => {
    const { runInboxMessages } = await import("../../src/commands/inbox.js");
    const out = { stdout: { write: vi.fn() }, stderr: { write: vi.fn() } };

    await runInboxMessages(client as never, { chatId: "chat_xyz", account: "acc_1", json: true } as InboxArgs, out);

    expect(ns.messaging.listMessages).toHaveBeenCalledWith("chat_xyz", expect.anything());
  });

  it("inbox messages --limit 10 --cursor c2 — passes pagination params", async () => {
    const { runInboxMessages } = await import("../../src/commands/inbox.js");
    const out = { stdout: { write: vi.fn() }, stderr: { write: vi.fn() } };

    await runInboxMessages(client as never, {
      chatId: "chat_xyz",
      account: "acc_1",
      json: true,
      limit: "10",
      cursor: "c2",
    } as InboxArgs, out);

    expect(ns.messaging.listMessages).toHaveBeenCalledWith(
      "chat_xyz",
      expect.objectContaining({ limit: 10, cursor: "c2" }),
    );
  });

  it("inbox messages --all — streams NDJSON", async () => {
    const { runInboxMessages } = await import("../../src/commands/inbox.js");
    const out = { stdout: { write: vi.fn() }, stderr: { write: vi.fn() } };

    (ns.messaging.listMessages as Mock)
      .mockResolvedValueOnce({ items: [{ id: "m1" }], cursor: "next" })
      .mockResolvedValueOnce({ items: [{ id: "m2" }], cursor: null });

    await runInboxMessages(client as never, { chatId: "chat_xyz", account: "acc_1", all: true } as InboxArgs, out);

    const lines = (out.stdout.write as Mock).mock.calls.map((c) => c[0] as string);
    const ndjson = lines.filter((l) => l.trim().startsWith("{"));
    expect(ndjson).toHaveLength(2);
  });

  it("inbox messages --preview — usage error exit 2", async () => {
    const { runInboxMessages } = await import("../../src/commands/inbox.js");
    const out = { stdout: { write: vi.fn() }, stderr: { write: vi.fn() } };

    const exitSpy = vi.spyOn(process, "exit").mockImplementation((code?: number | string | null) => {
      throw new Error(`process.exit(${code})`);
    });
    try {
      await runInboxMessages(client as never, { chatId: "chat_xyz", account: "acc_1", preview: true } as InboxArgs, out);
      expect.fail("should have exited");
    } catch (e) {
      expect((e as Error).message).toContain("process.exit(2)");
    } finally {
      exitSpy.mockRestore();
    }
  });
});

describe("inbox sync / sync-chat", () => {
  let ns: ReturnType<typeof makeMessagingNs>;
  let client: ReturnType<typeof makeClient>;

  beforeEach(() => {
    ns = makeMessagingNs();
    client = makeClient(ns);
    (ns.messaging.syncMessages as Mock).mockResolvedValue({ synced: true });
    (ns.messaging.syncChat as Mock).mockResolvedValue({ synced: true });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("inbox sync — calls syncMessages", async () => {
    const { runInboxSync } = await import("../../src/commands/inbox.js");
    const out = { stdout: { write: vi.fn() }, stderr: { write: vi.fn() } };

    await runInboxSync(client as never, { account: "acc_1", json: true } as InboxArgs, out);

    expect(ns.messaging.syncMessages).toHaveBeenCalled();
  });

  it("inbox sync --preview — usage error exit 2 (read command)", async () => {
    const { runInboxSync } = await import("../../src/commands/inbox.js");
    const out = { stdout: { write: vi.fn() }, stderr: { write: vi.fn() } };

    const exitSpy = vi.spyOn(process, "exit").mockImplementation((code?: number | string | null) => {
      throw new Error(`process.exit(${code})`);
    });
    try {
      await runInboxSync(client as never, { account: "acc_1", preview: true } as InboxArgs, out);
      expect.fail("should have exited");
    } catch (e) {
      expect((e as Error).message).toContain("process.exit(2)");
    } finally {
      exitSpy.mockRestore();
    }
  });

  it("inbox sync --all — usage error exit 2 (not paginated)", async () => {
    const { runInboxSync } = await import("../../src/commands/inbox.js");
    const out = { stdout: { write: vi.fn() }, stderr: { write: vi.fn() } };

    const exitSpy = vi.spyOn(process, "exit").mockImplementation((code?: number | string | null) => {
      throw new Error(`process.exit(${code})`);
    });
    try {
      await runInboxSync(client as never, { account: "acc_1", all: true } as InboxArgs, out);
      expect.fail("should have exited");
    } catch (e) {
      expect((e as Error).message).toContain("process.exit(2)");
    } finally {
      exitSpy.mockRestore();
    }
  });

  it("inbox sync-chat <chat_id> — calls syncChat with verbatim chat_id", async () => {
    const { runInboxSyncChat } = await import("../../src/commands/inbox.js");
    const out = { stdout: { write: vi.fn() }, stderr: { write: vi.fn() } };

    await runInboxSyncChat(client as never, { chatId: "chat_abc", account: "acc_1", json: true } as InboxArgs, out);

    expect(ns.messaging.syncChat).toHaveBeenCalledWith("chat_abc");
  });

  it("inbox sync-chat --preview — usage error exit 2", async () => {
    const { runInboxSyncChat } = await import("../../src/commands/inbox.js");
    const out = { stdout: { write: vi.fn() }, stderr: { write: vi.fn() } };

    const exitSpy = vi.spyOn(process, "exit").mockImplementation((code?: number | string | null) => {
      throw new Error(`process.exit(${code})`);
    });
    try {
      await runInboxSyncChat(client as never, { chatId: "chat_abc", account: "acc_1", preview: true } as InboxArgs, out);
      expect.fail("should have exited");
    } catch (e) {
      expect((e as Error).message).toContain("process.exit(2)");
    } finally {
      exitSpy.mockRestore();
    }
  });

  it("inbox sync-chat --all — usage error exit 2 (not paginated)", async () => {
    const { runInboxSyncChat } = await import("../../src/commands/inbox.js");
    const out = { stdout: { write: vi.fn() }, stderr: { write: vi.fn() } };

    const exitSpy = vi.spyOn(process, "exit").mockImplementation((code?: number | string | null) => {
      throw new Error(`process.exit(${code})`);
    });
    try {
      await runInboxSyncChat(client as never, { chatId: "chat_abc", account: "acc_1", all: true } as InboxArgs, out);
      expect.fail("should have exited");
    } catch (e) {
      expect((e as Error).message).toContain("process.exit(2)");
    } finally {
      exitSpy.mockRestore();
    }
  });
});
