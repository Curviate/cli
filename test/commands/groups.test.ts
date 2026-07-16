/**
 * Tests for the `groups` command group:
 *   groups list [--member <vanity|url|provider-id>]  → groups.list      (read, paginated)
 *   groups get <group>                               → groups.get       (read, scalar)
 *   groups members <group> [--name <q>]               → groups.members   (read, paginated)
 *
 * The SDK boundary is stubbed. Reads reject --preview (exit 2). `--member`
 * maps to the endpoint's `profile` filter (the CLI's own `--profile` is
 * reserved for config-profile selection). A provider-id-shaped `--member` is
 * resolved to a public identifier via `users.get` first (WP6 must-fix 1) —
 * the endpoint's `profile` filter silently 200s with an empty list on a raw
 * provider id, so an unresolvable identifier exits 2 instead.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Mock } from "vitest";
import { CurviateError } from "@curviate/sdk";

function makeNs() {
  return { groups: { list: vi.fn(), get: vi.fn(), members: vi.fn() }, users: { get: vi.fn() } };
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

describe("groups list", () => {
  let ns: ReturnType<typeof makeNs>;
  let client: ReturnType<typeof makeClient>;
  beforeEach(() => {
    ns = makeNs();
    client = makeClient(ns);
    (ns.groups.list as Mock).mockResolvedValue({ object: "group_list", items: [{ id: "9123014", name: "GTM Engineering" }], cursor: null });
  });
  afterEach(() => vi.restoreAllMocks());

  it("reads own groups by default (no profile filter)", async () => {
    const { runGroupsList } = await import("../../src/commands/groups.js");
    const out = makeOut();
    await runGroupsList(client as never, { account: "acc_1", json: true } as Flags, out);
    expect(client.account).toHaveBeenCalledWith("acc_1");
    expect(ns.groups.list).toHaveBeenCalledWith({});
    expect((JSON.parse(stdout(out)) as { items: unknown[] }).items).toHaveLength(1);
  });

  it("--member (vanity slug) maps to the endpoint's `profile` filter, plus limit/cursor — zero extra calls", async () => {
    const { runGroupsList } = await import("../../src/commands/groups.js");
    const out = makeOut();
    await runGroupsList(client as never, { account: "acc_1", json: true, member: "sophie-keller", limit: "5", cursor: "c0" } as Flags, out);
    expect(ns.groups.list).toHaveBeenCalledWith({ profile: "sophie-keller", limit: 5, cursor: "c0" });
    expect(ns.users.get).not.toHaveBeenCalled();
  });

  it("--member (/in/ URL) is normalized to its slug — zero extra calls", async () => {
    const { runGroupsList } = await import("../../src/commands/groups.js");
    const out = makeOut();
    await runGroupsList(client as never, { account: "acc_1", json: true, member: "https://www.linkedin.com/in/sophie-keller/" } as Flags, out);
    expect(ns.groups.list).toHaveBeenCalledWith({ profile: "sophie-keller" });
    expect(ns.users.get).not.toHaveBeenCalled();
  });

  it("--member (provider id) resolves to public_identifier via users.get, then forwards it as the profile filter (WP6 must-fix 1)", async () => {
    (ns.users.get as Mock).mockResolvedValue({ object: "user_profile", id: "ACoAAA_x", public_identifier: "sophie-keller" });
    const { runGroupsList } = await import("../../src/commands/groups.js");
    const out = makeOut();
    await runGroupsList(client as never, { account: "acc_1", json: true, member: "ACoAAA_x" } as Flags, out);
    expect(ns.users.get).toHaveBeenCalledWith("ACoAAA_x", {});
    expect(ns.groups.list).toHaveBeenCalledWith({ profile: "sophie-keller" });
  });

  it("--member (unresolvable provider id) exits 2 with the fixed usage-error message, never a silent empty list", async () => {
    (ns.users.get as Mock).mockRejectedValue(new Error("not found"));
    const { runGroupsList } = await import("../../src/commands/groups.js");
    const out = makeOut();
    const exit = mockExit();
    try {
      await runGroupsList(client as never, { account: "acc_1", json: true, member: "ACoAAA_ghost" } as Flags, out);
      expect.fail("should exit");
    } catch (e) {
      expect((e as Error).message).toContain("process.exit(2)");
    } finally {
      exit.mockRestore();
    }
    expect(ns.groups.list).not.toHaveBeenCalled();
    expect(out.stderr.write).toHaveBeenCalledWith("error: pass a vanity slug or /in/ URL, or a resolvable provider id.\n");
  });

  it("--member (provider id resolves but carries no public_identifier) also exits 2 with the fixed message", async () => {
    (ns.users.get as Mock).mockResolvedValue({ object: "user_profile", id: "ACoAAA_x" });
    const { runGroupsList } = await import("../../src/commands/groups.js");
    const out = makeOut();
    const exit = mockExit();
    try {
      await runGroupsList(client as never, { account: "acc_1", json: true, member: "ACoAAA_x" } as Flags, out);
      expect.fail("should exit");
    } catch (e) {
      expect((e as Error).message).toContain("process.exit(2)");
    } finally {
      exit.mockRestore();
    }
    expect(ns.groups.list).not.toHaveBeenCalled();
  });

  it("--preview → exit 2 (read command)", async () => {
    const { runGroupsList } = await import("../../src/commands/groups.js");
    const out = makeOut();
    const exit = mockExit();
    try {
      await runGroupsList(client as never, { account: "acc_1", preview: true } as Flags, out);
      expect.fail("should exit");
    } catch (e) {
      expect((e as Error).message).toContain("process.exit(2)");
    } finally {
      exit.mockRestore();
    }
    expect(ns.groups.list).not.toHaveBeenCalled();
  });

  it("--all streams every page, walking the cursor", async () => {
    (ns.groups.list as Mock)
      .mockResolvedValueOnce({ object: "group_list", items: [{ id: "1" }], cursor: "c1" })
      .mockResolvedValueOnce({ object: "group_list", items: [{ id: "2" }], cursor: null });
    const { runGroupsList } = await import("../../src/commands/groups.js");
    const out = makeOut();
    await runGroupsList(client as never, { account: "acc_1", json: true, all: true, "page-delay": "0" } as Flags, out);
    const lines = stdout(out).trim().split("\n").filter(Boolean);
    expect(lines).toHaveLength(2);
    expect(ns.groups.list).toHaveBeenNthCalledWith(2, { cursor: "c1" });
  });

  it("without --account → exit 2", async () => {
    const { runGroupsList } = await import("../../src/commands/groups.js");
    const out = makeOut();
    const exit = mockExit();
    try {
      await runGroupsList(client as never, { json: true } as Flags, out);
      expect.fail("should exit");
    } catch (e) {
      expect((e as Error).message).toContain("process.exit(2)");
    } finally {
      exit.mockRestore();
    }
  });
});

describe("groups get", () => {
  let ns: ReturnType<typeof makeNs>;
  let client: ReturnType<typeof makeClient>;
  beforeEach(() => {
    ns = makeNs();
    client = makeClient(ns);
    (ns.groups.get as Mock).mockResolvedValue({ object: "group", id: "9123014", name: "GTM Engineering", member_count: 5000 });
  });
  afterEach(() => vi.restoreAllMocks());

  it("passes the group id/URL verbatim and prints the detail", async () => {
    const { runGroupsGet } = await import("../../src/commands/groups.js");
    const out = makeOut();
    await runGroupsGet(client as never, { account: "acc_1", json: true, group: "9123014" } as Flags, out);
    expect(ns.groups.get).toHaveBeenCalledWith("9123014");
    expect((JSON.parse(stdout(out)) as { member_count: number }).member_count).toBe(5000);
  });

  it("--all → exit 2 (non-paginated scalar read)", async () => {
    const { runGroupsGet } = await import("../../src/commands/groups.js");
    const out = makeOut();
    const exit = mockExit();
    try {
      await runGroupsGet(client as never, { account: "acc_1", group: "9123014", all: true } as Flags, out);
      expect.fail("should exit");
    } catch (e) {
      expect((e as Error).message).toContain("process.exit(2)");
    } finally {
      exit.mockRestore();
    }
  });

  it("a 404 surfaces as exit 4", async () => {
    (ns.groups.get as Mock).mockRejectedValue(
      new CurviateError({ code: "RESOURCE_NOT_FOUND", message: "not found", httpStatus: 404, userFixable: false, retryLikelyToSucceed: false }),
    );
    const { runGroupsGet } = await import("../../src/commands/groups.js");
    const out = makeOut();
    const exit = mockExit();
    try {
      await runGroupsGet(client as never, { account: "acc_1", group: "nope", json: true } as Flags, out);
      expect.fail("should exit");
    } catch (e) {
      expect((e as Error).message).toContain("process.exit(4)");
    } finally {
      exit.mockRestore();
    }
  });
});

describe("groups members", () => {
  let ns: ReturnType<typeof makeNs>;
  let client: ReturnType<typeof makeClient>;
  beforeEach(() => {
    ns = makeNs();
    client = makeClient(ns);
    (ns.groups.members as Mock).mockResolvedValue({ object: "group_member_list", items: [{ name: "Raphael Redmer" }], cursor: null });
  });
  afterEach(() => vi.restoreAllMocks());

  it("forwards the group positional and --name filter", async () => {
    const { runGroupsMembers } = await import("../../src/commands/groups.js");
    const out = makeOut();
    await runGroupsMembers(client as never, { account: "acc_1", json: true, group: "9123014", name: "raphael" } as Flags, out);
    expect(ns.groups.members).toHaveBeenCalledWith("9123014", { name: "raphael" });
  });

  it("no --name → full roster (no name filter forwarded)", async () => {
    const { runGroupsMembers } = await import("../../src/commands/groups.js");
    const out = makeOut();
    await runGroupsMembers(client as never, { account: "acc_1", json: true, group: "9123014" } as Flags, out);
    expect(ns.groups.members).toHaveBeenCalledWith("9123014", {});
  });

  it("--preview → exit 2 (read command)", async () => {
    const { runGroupsMembers } = await import("../../src/commands/groups.js");
    const out = makeOut();
    const exit = mockExit();
    try {
      await runGroupsMembers(client as never, { account: "acc_1", group: "9123014", preview: true } as Flags, out);
      expect.fail("should exit");
    } catch (e) {
      expect((e as Error).message).toContain("process.exit(2)");
    } finally {
      exit.mockRestore();
    }
  });

  // Fix 3 (WP6-B): the server honors --limit as a LOWER bound — it returns
  // >= limit items up to its own internal page size (observed: PAGE_SIZE 10),
  // not exactly limit. `--limit 5` still forwards to the server (a smaller
  // requested page is still a real hint upstream), but the CLI slices the
  // returned items down to the requested N client-side — least-surprise: the
  // user asked for 5, they should see 5.
  it("--limit 5 slices the server's over-fetched page down to 5 items", async () => {
    (ns.groups.members as Mock).mockResolvedValue({
      object: "group_member_list",
      items: Array.from({ length: 10 }, (_, i) => ({ name: `Member ${i}` })),
      cursor: "c1",
    });
    const { runGroupsMembers } = await import("../../src/commands/groups.js");
    const out = makeOut();
    await runGroupsMembers(client as never, { account: "acc_1", json: true, group: "9123014", limit: "5" } as Flags, out);
    expect(ns.groups.members).toHaveBeenCalledWith("9123014", { limit: 5 }); // still forwarded upstream
    const result = JSON.parse(stdout(out)) as { items: unknown[]; cursor: string | null };
    expect(result.items).toHaveLength(5);
    expect(result.cursor).toBe("c1"); // envelope's cursor is untouched by the slice
  });

  it("no --limit → no slicing, full page passes through", async () => {
    (ns.groups.members as Mock).mockResolvedValue({
      object: "group_member_list",
      items: Array.from({ length: 10 }, (_, i) => ({ name: `Member ${i}` })),
      cursor: null,
    });
    const { runGroupsMembers } = await import("../../src/commands/groups.js");
    const out = makeOut();
    await runGroupsMembers(client as never, { account: "acc_1", json: true, group: "9123014" } as Flags, out);
    const result = JSON.parse(stdout(out)) as { items: unknown[] };
    expect(result.items).toHaveLength(10);
  });

  it("--limit larger than the returned page is a no-op (never pads)", async () => {
    (ns.groups.members as Mock).mockResolvedValue({
      object: "group_member_list",
      items: [{ name: "Only One" }],
      cursor: null,
    });
    const { runGroupsMembers } = await import("../../src/commands/groups.js");
    const out = makeOut();
    await runGroupsMembers(client as never, { account: "acc_1", json: true, group: "9123014", limit: "20" } as Flags, out);
    const result = JSON.parse(stdout(out)) as { items: unknown[] };
    expect(result.items).toHaveLength(1);
  });

  it("--all is unaffected by the slice — every item across pages still streams", async () => {
    (ns.groups.members as Mock)
      .mockResolvedValueOnce({ object: "group_member_list", items: Array.from({ length: 10 }, (_, i) => ({ name: `A${i}` })), cursor: "c1" })
      .mockResolvedValueOnce({ object: "group_member_list", items: Array.from({ length: 10 }, (_, i) => ({ name: `B${i}` })), cursor: null });
    const { runGroupsMembers } = await import("../../src/commands/groups.js");
    const out = makeOut();
    await runGroupsMembers(client as never, { account: "acc_1", json: true, group: "9123014", limit: "5", all: true, "page-delay": "0" } as Flags, out);
    const lines = stdout(out).trim().split("\n").filter(Boolean);
    expect(lines).toHaveLength(20); // both full pages — the slice never applies to --all streaming
  });
});
