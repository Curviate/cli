/**
 * Tests for the `notifications` command group:
 *   notifications list [--filter <stream>]  → notifications.list      (read, paginated)
 *   notifications delete <card_urn>          → notifications.delete    (write, --preview)
 *   notifications show-less <card_urn>       → notifications.showLess  (write, --preview)
 *
 * The SDK boundary is stubbed. list rejects --preview. The two writes follow
 * the destructive-write convention (job close): --preview-capable, no confirm
 * prompt. The card_urn passes through verbatim (the SDK percent-encodes it).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Mock } from "vitest";

const CARD_URN = "urn:li:fsd_notificationCard:(urn:li:fs_notification:abc,NOTIFICATIONS,def)";

function makeNs() {
  return { notifications: { list: vi.fn(), delete: vi.fn(), showLess: vi.fn() } };
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

describe("notifications list", () => {
  let ns: ReturnType<typeof makeNs>;
  let client: ReturnType<typeof makeClient>;
  beforeEach(() => {
    ns = makeNs();
    client = makeClient(ns);
    (ns.notifications.list as Mock).mockResolvedValue({
      object: "notification_list",
      unread_count: 3,
      latest_published_at: "2026-07-15T00:00:00Z",
      items: [{ card_urn: CARD_URN, injected: false }],
      cursor: null,
    });
  });
  afterEach(() => vi.restoreAllMocks());

  it("prints cards plus the account-level unread_count watermark", async () => {
    const { runNotificationsList } = await import("../../src/commands/notifications.js");
    const out = makeOut();
    await runNotificationsList(client as never, { account: "acc_1", json: true } as Flags, out);
    expect(ns.notifications.list).toHaveBeenCalledWith({});
    const result = JSON.parse(stdout(out)) as Record<string, unknown>;
    expect(result["unread_count"]).toBe(3);
    expect(result["latest_published_at"]).toBe("2026-07-15T00:00:00Z");
  });

  it("forwards --filter/--limit/--cursor", async () => {
    const { runNotificationsList } = await import("../../src/commands/notifications.js");
    const out = makeOut();
    await runNotificationsList(client as never, { account: "acc_1", json: true, filter: "mentions", limit: "20", cursor: "c0" } as Flags, out);
    expect(ns.notifications.list).toHaveBeenCalledWith({ filter: "mentions", limit: 20, cursor: "c0" });
  });

  it("--preview → exit 2 (read command)", async () => {
    const { runNotificationsList } = await import("../../src/commands/notifications.js");
    const out = makeOut();
    const exit = mockExit();
    try {
      await runNotificationsList(client as never, { account: "acc_1", preview: true } as Flags, out);
      expect.fail("should exit");
    } catch (e) {
      expect((e as Error).message).toContain("process.exit(2)");
    } finally {
      exit.mockRestore();
    }
  });
});

describe("notifications delete", () => {
  let ns: ReturnType<typeof makeNs>;
  let client: ReturnType<typeof makeClient>;
  beforeEach(() => {
    ns = makeNs();
    client = makeClient(ns);
    (ns.notifications.delete as Mock).mockResolvedValue({ object: "notification_delete_result", deleted: true });
  });
  afterEach(() => vi.restoreAllMocks());

  it("passes the card_urn verbatim and prints the result", async () => {
    const { runNotificationsDelete } = await import("../../src/commands/notifications.js");
    const out = makeOut();
    await runNotificationsDelete(client as never, { account: "acc_1", json: true, cardUrn: CARD_URN } as Flags, out);
    expect(ns.notifications.delete).toHaveBeenCalledWith(CARD_URN);
    expect((JSON.parse(stdout(out)) as { deleted: boolean }).deleted).toBe(true);
  });

  it("--preview renders notifications.delete WITHOUT sending", async () => {
    const { runNotificationsDelete } = await import("../../src/commands/notifications.js");
    const out = makeOut();
    await runNotificationsDelete(client as never, { account: "acc_1", json: true, cardUrn: CARD_URN, preview: true } as Flags, out);
    expect(ns.notifications.delete).not.toHaveBeenCalled();
    const preview = JSON.parse(stdout(out)) as { method: string; args: Record<string, unknown>; account: string };
    expect(preview.method).toBe("notifications.delete");
    expect(preview.args["card_urn"]).toBe(CARD_URN);
    expect(preview.account).toBe("acc_1");
  });
});

describe("notifications show-less", () => {
  let ns: ReturnType<typeof makeNs>;
  let client: ReturnType<typeof makeClient>;
  beforeEach(() => {
    ns = makeNs();
    client = makeClient(ns);
    (ns.notifications.showLess as Mock).mockResolvedValue({ object: "notification_show_less_result", applied: true });
  });
  afterEach(() => vi.restoreAllMocks());

  it("passes the card_urn verbatim and prints the result", async () => {
    const { runNotificationsShowLess } = await import("../../src/commands/notifications.js");
    const out = makeOut();
    await runNotificationsShowLess(client as never, { account: "acc_1", json: true, cardUrn: CARD_URN } as Flags, out);
    expect(ns.notifications.showLess).toHaveBeenCalledWith(CARD_URN);
  });

  it("--preview renders notifications.showLess WITHOUT sending", async () => {
    const { runNotificationsShowLess } = await import("../../src/commands/notifications.js");
    const out = makeOut();
    await runNotificationsShowLess(client as never, { account: "acc_1", json: true, cardUrn: CARD_URN, preview: true } as Flags, out);
    expect(ns.notifications.showLess).not.toHaveBeenCalled();
    const preview = JSON.parse(stdout(out)) as { method: string };
    expect(preview.method).toBe("notifications.showLess");
  });
});
