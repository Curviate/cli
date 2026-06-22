/**
 * Tests for the `connect` command group.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Mock } from "vitest";

function makeAccountNs() {
  return {
    invites: {
      send: vi.fn(),
      listSent: vi.fn(),
      listReceived: vi.fn(),
      respond: vi.fn(),
      cancel: vi.fn(),
    },
  };
}

function makeClient(accountNs: ReturnType<typeof makeAccountNs>) {
  return {
    account: vi.fn().mockReturnValue(accountNs),
  };
}

type ConnectArgs = {
  id?: string;
  note?: string;
  action?: string;
  account?: string;
  json?: boolean;
  preview?: boolean;
  all?: boolean;
  "max-pages"?: string;
  limit?: string;
  cursor?: string;
  fields?: string;
  "api-key"?: string;
  "base-url"?: string;
  timeout?: string;
  profile?: string;
};

describe("connect <id> — send invitation", () => {
  let accountNs: ReturnType<typeof makeAccountNs>;
  let client: ReturnType<typeof makeClient>;

  beforeEach(() => {
    accountNs = makeAccountNs();
    client = makeClient(accountNs);
    (accountNs.invites.send as Mock).mockResolvedValue({ status: "sent" });
    (accountNs.invites.listSent as Mock).mockResolvedValue({ items: [], cursor: null });
    (accountNs.invites.listReceived as Mock).mockResolvedValue({ items: [], cursor: null });
    (accountNs.invites.respond as Mock).mockResolvedValue({ status: "accepted" });
    (accountNs.invites.cancel as Mock).mockResolvedValue({ status: "cancelled" });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("connect <member-url> — resolves URL to slug, calls invites.send", async () => {
    const { runConnectSend } = await import("../../src/commands/connect.js");
    const out = { stdout: { write: vi.fn() }, stderr: { write: vi.fn() } };

    await runConnectSend(client as never, {
      id: "https://www.linkedin.com/in/jdoe/?trk=x",
      account: "acc_1",
      json: true,
    } as ConnectArgs, out);

    expect(client.account).toHaveBeenCalledWith("acc_1");
    expect(accountNs.invites.send).toHaveBeenCalledWith(
      expect.objectContaining({ recipient_identifier: "jdoe" }),
    );
  });

  it("connect bare slug — passes slug unchanged", async () => {
    const { runConnectSend } = await import("../../src/commands/connect.js");
    const out = { stdout: { write: vi.fn() }, stderr: { write: vi.fn() } };

    await runConnectSend(client as never, { id: "jdoe", account: "acc_1", json: true } as ConnectArgs, out);

    expect(accountNs.invites.send).toHaveBeenCalledWith(
      expect.objectContaining({ recipient_identifier: "jdoe" }),
    );
  });

  it("connect URN — passes URN unchanged", async () => {
    const { runConnectSend } = await import("../../src/commands/connect.js");
    const out = { stdout: { write: vi.fn() }, stderr: { write: vi.fn() } };

    await runConnectSend(client as never, {
      id: "urn:li:fsd_profile:ABC123",
      account: "acc_1",
      json: true,
    } as ConnectArgs, out);

    expect(accountNs.invites.send).toHaveBeenCalledWith(
      expect.objectContaining({ recipient_identifier: "urn:li:fsd_profile:ABC123" }),
    );
  });

  it("connect <id> --note <text> — passes message field", async () => {
    const { runConnectSend } = await import("../../src/commands/connect.js");
    const out = { stdout: { write: vi.fn() }, stderr: { write: vi.fn() } };

    await runConnectSend(client as never, {
      id: "jdoe",
      note: "Hello!",
      account: "acc_1",
      json: true,
    } as ConnectArgs, out);

    expect(accountNs.invites.send).toHaveBeenCalledWith(
      expect.objectContaining({ recipient_identifier: "jdoe", message: "Hello!" }),
    );
  });

  it("connect --preview — renders preview, does not call send", async () => {
    const { runConnectSend } = await import("../../src/commands/connect.js");
    const out = { stdout: { write: vi.fn() }, stderr: { write: vi.fn() } };

    await runConnectSend(client as never, {
      id: "jdoe",
      account: "acc_1",
      preview: true,
    } as ConnectArgs, out);

    expect(accountNs.invites.send).not.toHaveBeenCalled();
    const written = (out.stdout.write as Mock).mock.calls.map((c) => c[0] as string).join("");
    const parsed = JSON.parse(written);
    expect(parsed.method).toBe("invites.send");
  });
});

describe("connect sent / received — list reads", () => {
  let accountNs: ReturnType<typeof makeAccountNs>;
  let client: ReturnType<typeof makeClient>;

  beforeEach(() => {
    accountNs = makeAccountNs();
    client = makeClient(accountNs);
    (accountNs.invites.listSent as Mock).mockResolvedValue({ items: [{ id: "s1" }], cursor: null });
    (accountNs.invites.listReceived as Mock).mockResolvedValue({ items: [{ id: "r1" }], cursor: null });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("connect sent — calls invites.listSent", async () => {
    const { runConnectSent } = await import("../../src/commands/connect.js");
    const out = { stdout: { write: vi.fn() }, stderr: { write: vi.fn() } };

    await runConnectSent(client as never, { account: "acc_1", json: true } as ConnectArgs, out);

    expect(accountNs.invites.listSent).toHaveBeenCalled();
  });

  it("connect sent --preview → usage error exit 2", async () => {
    const { runConnectSent } = await import("../../src/commands/connect.js");
    const out = { stdout: { write: vi.fn() }, stderr: { write: vi.fn() } };

    const exitSpy = vi.spyOn(process, "exit").mockImplementation((code?: number | string | null) => { throw new Error(`process.exit(${code})`); });
    try {
      await runConnectSent(client as never, { account: "acc_1", preview: true } as ConnectArgs, out);
      expect.fail("Should have exited");
    } catch (e) {
      expect((e as Error).message).toContain("process.exit(2)");
    } finally {
      exitSpy.mockRestore();
    }
  });

  it("connect received — calls invites.listReceived", async () => {
    const { runConnectReceived } = await import("../../src/commands/connect.js");
    const out = { stdout: { write: vi.fn() }, stderr: { write: vi.fn() } };

    await runConnectReceived(client as never, { account: "acc_1", json: true } as ConnectArgs, out);

    expect(accountNs.invites.listReceived).toHaveBeenCalled();
  });

  it("connect received --all — streams NDJSON", async () => {
    const { runConnectReceived } = await import("../../src/commands/connect.js");
    const out = { stdout: { write: vi.fn() }, stderr: { write: vi.fn() } };

    (accountNs.invites.listReceived as Mock)
      .mockResolvedValueOnce({ items: [{ id: "r1" }, { id: "r2" }], cursor: "c1" })
      .mockResolvedValueOnce({ items: [{ id: "r3" }], cursor: null });

    await runConnectReceived(client as never, { account: "acc_1", all: true } as ConnectArgs, out);

    const writtenLines = (out.stdout.write as Mock).mock.calls.map((c) => c[0] as string);
    const ndjsonLines = writtenLines.filter((l) => l.trim().startsWith("{"));
    expect(ndjsonLines).toHaveLength(3);
  });
});

describe("connect respond / cancel — writes, invitation_id NOT resolved", () => {
  let accountNs: ReturnType<typeof makeAccountNs>;
  let client: ReturnType<typeof makeClient>;

  beforeEach(() => {
    accountNs = makeAccountNs();
    client = makeClient(accountNs);
    (accountNs.invites.respond as Mock).mockResolvedValue({ status: "accepted" });
    (accountNs.invites.cancel as Mock).mockResolvedValue({ status: "cancelled" });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("connect respond <id> --action accept — calls respond with verbatim id", async () => {
    const { runConnectRespond } = await import("../../src/commands/connect.js");
    const out = { stdout: { write: vi.fn() }, stderr: { write: vi.fn() } };

    await runConnectRespond(client as never, {
      id: "inv_123",
      action: "accept",
      account: "acc_1",
      json: true,
    } as ConnectArgs, out);

    expect(accountNs.invites.respond).toHaveBeenCalledWith("inv_123", { action: "accept" });
  });

  it("connect respond --preview — renders preview without calling respond", async () => {
    const { runConnectRespond } = await import("../../src/commands/connect.js");
    const out = { stdout: { write: vi.fn() }, stderr: { write: vi.fn() } };

    await runConnectRespond(client as never, {
      id: "inv_123",
      action: "accept",
      account: "acc_1",
      preview: true,
    } as ConnectArgs, out);

    expect(accountNs.invites.respond).not.toHaveBeenCalled();
    const written = (out.stdout.write as Mock).mock.calls.map((c) => c[0] as string).join("");
    const parsed = JSON.parse(written);
    expect(parsed.method).toBe("invites.respond");
  });

  it("connect cancel <id> — calls cancel with verbatim id (not URL-resolved)", async () => {
    const { runConnectCancel } = await import("../../src/commands/connect.js");
    const out = { stdout: { write: vi.fn() }, stderr: { write: vi.fn() } };

    // invitation_id could look like a URL-ish string but must NOT be resolved
    await runConnectCancel(client as never, {
      id: "inv_abc",
      account: "acc_1",
      json: true,
    } as ConnectArgs, out);

    expect(accountNs.invites.cancel).toHaveBeenCalledWith("inv_abc");
  });

  it("connect cancel --preview — renders preview without calling cancel", async () => {
    const { runConnectCancel } = await import("../../src/commands/connect.js");
    const out = { stdout: { write: vi.fn() }, stderr: { write: vi.fn() } };

    await runConnectCancel(client as never, {
      id: "inv_abc",
      account: "acc_1",
      preview: true,
    } as ConnectArgs, out);

    expect(accountNs.invites.cancel).not.toHaveBeenCalled();
    const written = (out.stdout.write as Mock).mock.calls.map((c) => c[0] as string).join("");
    const parsed = JSON.parse(written);
    expect(parsed.method).toBe("invites.cancel");
  });
});
