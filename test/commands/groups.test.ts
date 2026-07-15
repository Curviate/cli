/**
 * Tests for the `groups` command group:
 *   groups list [--member <vanity>]      → groups.list      (read, paginated)
 *   groups get <group>                   → groups.get       (read, scalar)
 *   groups members <group> [--name <q>]  → groups.members   (read, paginated)
 *
 * The SDK boundary is stubbed. Reads reject --preview (exit 2). `--member`
 * maps to the endpoint's `profile` filter (the CLI's own `--profile` is
 * reserved for config-profile selection).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Mock } from "vitest";
import { CurviateError } from "@curviate/sdk";

function makeNs() {
  return { groups: { list: vi.fn(), get: vi.fn(), members: vi.fn() } };
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

  it("--member maps to the endpoint's `profile` filter, plus limit/cursor", async () => {
    const { runGroupsList } = await import("../../src/commands/groups.js");
    const out = makeOut();
    await runGroupsList(client as never, { account: "acc_1", json: true, member: "sophie-keller", limit: "5", cursor: "c0" } as Flags, out);
    expect(ns.groups.list).toHaveBeenCalledWith({ profile: "sophie-keller", limit: 5, cursor: "c0" });
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
});
