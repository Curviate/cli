/**
 * Tests for the `sales-nav` command group.
 *
 * Coverage:
 *   sales-nav sync [--cursor] [--limit]                                → salesNavigator.syncMessages
 *   sales-nav search people [filters…]                                 → salesNavigator.searchPeople (POST)
 *   sales-nav search companies [filters…]                              → salesNavigator.searchCompanies (POST)
 *   sales-nav search parameters --type <t>                             → salesNavigator.getParameters (GET)
 *   sales-nav message new --to <id> "<text>" [--attach…] [--voice <f>] [--video <f>] → salesNavigator.startChat (multipart)
 *   sales-nav profile <identifier>                                      → salesNavigator.getProfile (resolveIdentifier)
 *   sales-nav save-lead <user_id> [--list-id <id>]                     → salesNavigator.saveLead
 *
 * Tier-gate:
 *   TIER_NOT_ACTIVE → exit 5 + JSON requiredTier
 *   LINKEDIN_FEATURE_NOT_SUBSCRIBED → exit 5 + JSON code
 *
 * --preview on writes: renders preview, no SDK call.
 * --preview on reads: exit 2.
 * POST searches use method POST.
 * No sales-nav inmail-balance command exists.
 * resolveIdentifier applied to profile <identifier> but NOT to save-lead <user_id>.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Mock } from "vitest";
import { writeFile, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

// ─── Mock client factory ───────────────────────────────────────────────────

function makeSalesNavNs() {
  return {
    salesNavigator: {
      syncMessages: vi.fn(),
      searchPeople: vi.fn(),
      searchCompanies: vi.fn(),
      getParameters: vi.fn(),
      startChat: vi.fn(),
      getProfile: vi.fn(),
      saveLead: vi.fn(),
    },
  };
}

function makeClient(ns: ReturnType<typeof makeSalesNavNs>) {
  return {
    account: vi.fn().mockReturnValue(ns),
  };
}

type SalesNavFlags = {
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
  // Command-specific
  to?: string;
  text?: string;
  attach?: string | string[];
  voice?: string;
  video?: string;
  type?: string;
  keywords?: string;
  identifier?: string;
  userId?: string;
  "list-id"?: string;
  output?: string;
};

// ─── Shared helpers ────────────────────────────────────────────────────────

function makeOut() {
  return {
    stdout: { write: vi.fn() },
    stderr: { write: vi.fn() },
  };
}

function mockExit() {
  return vi.spyOn(process, "exit").mockImplementation((code?: number | string | null) => {
    throw new Error(`process.exit(${code})`);
  });
}

function makeTierError(code: string, requiredTier?: string) {
  return Object.assign(new Error(`Tier error: ${code}`), {
    code,
    requiredTier,
    userFixable: true,
    retryLikelyToSucceed: false,
    toJSON: () => ({ code, requiredTier, message: `Tier error: ${code}` }),
  });
}

// ─── Tier gate tests ───────────────────────────────────────────────────────

describe("sales-nav tier gate", () => {
  let ns: ReturnType<typeof makeSalesNavNs>;
  let client: ReturnType<typeof makeClient>;

  beforeEach(() => {
    ns = makeSalesNavNs();
    client = makeClient(ns);
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("TS-001: sales-nav search people — TIER_NOT_ACTIVE → exit 5, JSON contains requiredTier", async () => {
    const tierErr = makeTierError("TIER_NOT_ACTIVE", "sn");
    (ns.salesNavigator.searchPeople as Mock).mockRejectedValue(tierErr);

    const { CurviateError } = await import("@curviate/sdk");
    Object.setPrototypeOf(tierErr, CurviateError.prototype);

    const { runSalesNavSearchPeople } = await import("../../src/commands/sales-nav.js");
    const out = makeOut();
    const exitSpy = mockExit();

    try {
      await runSalesNavSearchPeople(client as never, { account: "acc_1", json: true }, out);
    } catch (e) {
      expect((e as Error).message).toContain("process.exit(5)");
    } finally {
      exitSpy.mockRestore();
    }

    const written = (out.stdout.write as Mock).mock.calls.map((c) => c[0] as string).join("");
    const parsed = JSON.parse(written);
    expect(parsed.error.code).toBe("TIER_NOT_ACTIVE");
    expect(parsed.error.requiredTier).toBe("sn");
  });

  it("TS-001 stderr diagnostic: sales-nav search people — TIER_NOT_ACTIVE → stderr contains error code, no vendor name", async () => {
    const tierErr = makeTierError("TIER_NOT_ACTIVE", "sn");
    (ns.salesNavigator.searchPeople as Mock).mockRejectedValue(tierErr);

    const { CurviateError } = await import("@curviate/sdk");
    Object.setPrototypeOf(tierErr, CurviateError.prototype);

    const { runSalesNavSearchPeople } = await import("../../src/commands/sales-nav.js");
    const out = makeOut();
    const exitSpy = mockExit();

    try {
      await runSalesNavSearchPeople(client as never, { account: "acc_1", json: true }, out);
    } catch (e) {
      expect((e as Error).message).toContain("process.exit(5)");
    } finally {
      exitSpy.mockRestore();
    }

    // In JSON mode, renderError writes the error envelope to stdout and a one-liner to stderr.
    const stderrWritten = (out.stderr.write as Mock).mock.calls.map((c) => c[0] as string).join("");
    expect(stderrWritten).toBeTruthy();
    // The stderr diagnostic must not contain the substrate vendor name.
    expect(stderrWritten.toLowerCase()).not.toContain("unipile");
    expect(stderrWritten).toContain("TIER_NOT_ACTIVE");
  });

  it("TS-002: sales-nav profile — LINKEDIN_FEATURE_NOT_SUBSCRIBED → exit 5, JSON code distinct", async () => {
    const tierErr = makeTierError("LINKEDIN_FEATURE_NOT_SUBSCRIBED");
    (ns.salesNavigator.getProfile as Mock).mockRejectedValue(tierErr);

    const { CurviateError } = await import("@curviate/sdk");
    Object.setPrototypeOf(tierErr, CurviateError.prototype);

    const { runSalesNavProfile } = await import("../../src/commands/sales-nav.js");
    const out = makeOut();
    const exitSpy = mockExit();

    try {
      await runSalesNavProfile(client as never, { account: "acc_1", identifier: "jdoe", json: true }, out);
    } catch (e) {
      expect((e as Error).message).toContain("process.exit(5)");
    } finally {
      exitSpy.mockRestore();
    }

    const written = (out.stdout.write as Mock).mock.calls.map((c) => c[0] as string).join("");
    const parsed = JSON.parse(written);
    expect(parsed.error.code).toBe("LINKEDIN_FEATURE_NOT_SUBSCRIBED");
  });

  it("TS-004: per-command gate independence — salesNavigator.saveLead stubbed independently → exit 5, requiredTier:sn", async () => {
    const tierErr = makeTierError("TIER_NOT_ACTIVE", "sn");
    (ns.salesNavigator.saveLead as Mock).mockRejectedValue(tierErr);

    const { CurviateError } = await import("@curviate/sdk");
    Object.setPrototypeOf(tierErr, CurviateError.prototype);

    const { runSalesNavSaveLead } = await import("../../src/commands/sales-nav.js");
    const out = makeOut();
    const exitSpy = mockExit();

    try {
      await runSalesNavSaveLead(client as never, { account: "acc_1", userId: "ACw123", json: true }, out);
    } catch (e) {
      expect((e as Error).message).toContain("process.exit(5)");
    } finally {
      exitSpy.mockRestore();
    }

    const written = (out.stdout.write as Mock).mock.calls.map((c) => c[0] as string).join("");
    const parsed = JSON.parse(written);
    expect(parsed.error.code).toBe("TIER_NOT_ACTIVE");
    expect(parsed.error.requiredTier).toBe("sn");
  });
});

// ─── sales-nav sync ────────────────────────────────────────────────────────

describe("sales-nav sync", () => {
  let ns: ReturnType<typeof makeSalesNavNs>;
  let client: ReturnType<typeof makeClient>;

  beforeEach(() => {
    ns = makeSalesNavNs();
    client = makeClient(ns);
    (ns.salesNavigator.syncMessages as Mock).mockResolvedValue({ object: "sync_result" });
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("calls salesNavigator.syncMessages with account scoping", async () => {
    const { runSalesNavSync } = await import("../../src/commands/sales-nav.js");
    const out = makeOut();

    await runSalesNavSync(client as never, { account: "acc_1", json: true }, out);

    expect(client.account).toHaveBeenCalledWith("acc_1");
    expect(ns.salesNavigator.syncMessages).toHaveBeenCalled();
  });

  it("--preview on read: exits 2", async () => {
    const { runSalesNavSync } = await import("../../src/commands/sales-nav.js");
    const out = makeOut();
    const exitSpy = mockExit();

    try {
      await runSalesNavSync(client as never, { account: "acc_1", preview: true }, out);
      expect.fail("should have exited");
    } catch (e) {
      expect((e as Error).message).toContain("process.exit(2)");
    } finally {
      exitSpy.mockRestore();
    }
    expect(ns.salesNavigator.syncMessages).not.toHaveBeenCalled();
  });
});

// ─── sales-nav search people ──────────────────────────────────────────────

describe("sales-nav search people", () => {
  let ns: ReturnType<typeof makeSalesNavNs>;
  let client: ReturnType<typeof makeClient>;

  beforeEach(() => {
    ns = makeSalesNavNs();
    client = makeClient(ns);
    (ns.salesNavigator.searchPeople as Mock).mockResolvedValue({ items: [{ id: "p1" }], cursor: null });
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("calls salesNavigator.searchPeople and renders result", async () => {
    const { runSalesNavSearchPeople } = await import("../../src/commands/sales-nav.js");
    const out = makeOut();

    await runSalesNavSearchPeople(client as never, { account: "acc_1", keywords: "ai", json: true }, out);

    expect(client.account).toHaveBeenCalledWith("acc_1");
    expect(ns.salesNavigator.searchPeople).toHaveBeenCalled();
    const written = (out.stdout.write as Mock).mock.calls.map((c) => c[0] as string).join("");
    const parsed = JSON.parse(written);
    expect(parsed).toHaveProperty("items");
  });

  it("TS-005: salesNavigator.searchPeople call passes body (POST shape)", async () => {
    const { runSalesNavSearchPeople } = await import("../../src/commands/sales-nav.js");
    const out = makeOut();

    await runSalesNavSearchPeople(client as never, { account: "acc_1", keywords: "ai", json: true }, out);

    const callArgs = (ns.salesNavigator.searchPeople as Mock).mock.calls[0] as [Record<string, unknown>];
    // The method is called with a body object (POST) — first arg is the body
    expect(callArgs[0]).toBeDefined();
    expect(typeof callArgs[0]).toBe("object");
  });

  it("--preview exits 2 (search is a write shape via POST — but for reads it should exit 2)", async () => {
    // Search is invoked as POST body with optional filters; per spec it is a write-style operation
    // but --preview on a read-classified command exits 2. Since search returns data (read behavior),
    // --preview is rejected.
    const { runSalesNavSearchPeople } = await import("../../src/commands/sales-nav.js");
    const out = makeOut();
    const exitSpy = mockExit();

    try {
      await runSalesNavSearchPeople(client as never, { account: "acc_1", preview: true }, out);
      expect.fail("should have exited");
    } catch (e) {
      expect((e as Error).message).toContain("process.exit(2)");
    } finally {
      exitSpy.mockRestore();
    }
    expect(ns.salesNavigator.searchPeople).not.toHaveBeenCalled();
  });

  it("--all streams all pages", async () => {
    (ns.salesNavigator.searchPeople as Mock)
      .mockResolvedValueOnce({ items: [{ id: "p1" }], cursor: "cursor_1" })
      .mockResolvedValueOnce({ items: [{ id: "p2" }], cursor: null });

    const { runSalesNavSearchPeople } = await import("../../src/commands/sales-nav.js");
    const out = makeOut();

    await runSalesNavSearchPeople(client as never, { account: "acc_1", all: true, json: true }, out);

    const written = (out.stdout.write as Mock).mock.calls.map((c) => c[0] as string).join("\n");
    const lines = written.trim().split("\n").filter(Boolean);
    expect(lines.length).toBe(2);
    expect(JSON.parse(lines[0]!)).toEqual({ id: "p1" });
    expect(JSON.parse(lines[1]!)).toEqual({ id: "p2" });
  });
});

// ─── sales-nav search companies ───────────────────────────────────────────

describe("sales-nav search companies", () => {
  let ns: ReturnType<typeof makeSalesNavNs>;
  let client: ReturnType<typeof makeClient>;

  beforeEach(() => {
    ns = makeSalesNavNs();
    client = makeClient(ns);
    (ns.salesNavigator.searchCompanies as Mock).mockResolvedValue({ items: [{ id: "c1" }], cursor: null });
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("calls salesNavigator.searchCompanies", async () => {
    const { runSalesNavSearchCompanies } = await import("../../src/commands/sales-nav.js");
    const out = makeOut();

    await runSalesNavSearchCompanies(client as never, { account: "acc_1", keywords: "tech", json: true }, out);

    expect(ns.salesNavigator.searchCompanies).toHaveBeenCalled();
    const callArgs = (ns.salesNavigator.searchCompanies as Mock).mock.calls[0] as [Record<string, unknown>];
    expect(callArgs[0]).toBeDefined();
  });
});

// ─── sales-nav search parameters ──────────────────────────────────────────

describe("sales-nav search parameters", () => {
  let ns: ReturnType<typeof makeSalesNavNs>;
  let client: ReturnType<typeof makeClient>;

  beforeEach(() => {
    ns = makeSalesNavNs();
    client = makeClient(ns);
    (ns.salesNavigator.getParameters as Mock).mockResolvedValue({ items: [] });
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("calls salesNavigator.getParameters with type param", async () => {
    const { runSalesNavGetParameters } = await import("../../src/commands/sales-nav.js");
    const out = makeOut();

    await runSalesNavGetParameters(client as never, { account: "acc_1", type: "LOCATION", json: true }, out);

    expect(ns.salesNavigator.getParameters).toHaveBeenCalledWith(
      expect.objectContaining({ type: "LOCATION" }),
    );
  });

  it("--preview on read: exits 2", async () => {
    const { runSalesNavGetParameters } = await import("../../src/commands/sales-nav.js");
    const out = makeOut();
    const exitSpy = mockExit();

    try {
      await runSalesNavGetParameters(client as never, { account: "acc_1", type: "LOCATION", preview: true }, out);
      expect.fail("should have exited");
    } catch (e) {
      expect((e as Error).message).toContain("process.exit(2)");
    } finally {
      exitSpy.mockRestore();
    }
    expect(ns.salesNavigator.getParameters).not.toHaveBeenCalled();
  });
});

// ─── sales-nav message new ─────────────────────────────────────────────────

describe("sales-nav message new", () => {
  let ns: ReturnType<typeof makeSalesNavNs>;
  let client: ReturnType<typeof makeClient>;
  let tmpDir: string;

  beforeEach(async () => {
    ns = makeSalesNavNs();
    client = makeClient(ns);
    (ns.salesNavigator.startChat as Mock).mockResolvedValue({ chat_id: "sn_chat_1" });
    tmpDir = await mkdtemp(join(tmpdir(), "curviate-test-sn-"));
    vi.resetModules();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("calls salesNavigator.startChat with to and text", async () => {
    const { runSalesNavMessageNew } = await import("../../src/commands/sales-nav.js");
    const out = makeOut();

    await runSalesNavMessageNew(client as never, {
      account: "acc_1",
      to: "ACo456",
      text: "hello sn",
      json: true,
    }, out);

    expect(client.account).toHaveBeenCalledWith("acc_1");
    expect(ns.salesNavigator.startChat).toHaveBeenCalledWith(
      expect.objectContaining({ attendees_ids: ["ACo456"], text: "hello sn" }),
    );
  });

  it("--attach file passes Buffer in attachments", async () => {
    const filePath = join(tmpDir, "attach.txt");
    await writeFile(filePath, "content");

    const { runSalesNavMessageNew } = await import("../../src/commands/sales-nav.js");
    const out = makeOut();

    await runSalesNavMessageNew(client as never, {
      account: "acc_1",
      to: "ACo456",
      text: "hello",
      attach: filePath,
      json: true,
    }, out);

    const callArgs = (ns.salesNavigator.startChat as Mock).mock.calls[0]![0] as Record<string, unknown>;
    const attachments = callArgs["attachments"] as Buffer[];
    expect(Array.isArray(attachments)).toBe(true);
    expect(attachments[0]).toBeInstanceOf(Buffer);
  });

  it("--voice file passes Buffer as voice_message", async () => {
    const voicePath = join(tmpDir, "voice.ogg");
    await writeFile(voicePath, "voicedata");

    const { runSalesNavMessageNew } = await import("../../src/commands/sales-nav.js");
    const out = makeOut();

    await runSalesNavMessageNew(client as never, {
      account: "acc_1",
      to: "ACo456",
      text: "hello",
      voice: voicePath,
      json: true,
    }, out);

    const callArgs = (ns.salesNavigator.startChat as Mock).mock.calls[0]![0] as Record<string, unknown>;
    expect(callArgs["voice_message"]).toBeInstanceOf(Buffer);
  });

  it("--video file passes Buffer as video_message", async () => {
    const videoPath = join(tmpDir, "video.mp4");
    await writeFile(videoPath, "videodata");

    const { runSalesNavMessageNew } = await import("../../src/commands/sales-nav.js");
    const out = makeOut();

    await runSalesNavMessageNew(client as never, {
      account: "acc_1",
      to: "ACo456",
      text: "hello",
      video: videoPath,
      json: true,
    }, out);

    const callArgs = (ns.salesNavigator.startChat as Mock).mock.calls[0]![0] as Record<string, unknown>;
    expect(callArgs["video_message"]).toBeInstanceOf(Buffer);
  });

  it("--preview renders request, does not call startChat", async () => {
    const { runSalesNavMessageNew } = await import("../../src/commands/sales-nav.js");
    const out = makeOut();

    await runSalesNavMessageNew(client as never, {
      account: "acc_1",
      to: "ACo456",
      text: "hello",
      preview: true,
    }, out);

    expect(ns.salesNavigator.startChat).not.toHaveBeenCalled();
    const written = (out.stdout.write as Mock).mock.calls.map((c) => c[0] as string).join("");
    const parsed = JSON.parse(written);
    expect(parsed.method).toBe("salesNavigator.startChat");
  });

  it("--attach missing file exits 2 before startChat", async () => {
    const { runSalesNavMessageNew } = await import("../../src/commands/sales-nav.js");
    const out = makeOut();
    const exitSpy = mockExit();

    try {
      await runSalesNavMessageNew(client as never, {
        account: "acc_1",
        to: "ACo456",
        text: "hello",
        attach: join(tmpDir, "no-such-file.txt"),
      }, out);
      expect.fail("should have exited");
    } catch (e) {
      expect((e as Error).message).toContain("process.exit(2)");
    } finally {
      exitSpy.mockRestore();
    }
    expect(ns.salesNavigator.startChat).not.toHaveBeenCalled();
  });
});

// ─── sales-nav profile ─────────────────────────────────────────────────────

describe("sales-nav profile", () => {
  let ns: ReturnType<typeof makeSalesNavNs>;
  let client: ReturnType<typeof makeClient>;

  beforeEach(() => {
    ns = makeSalesNavNs();
    client = makeClient(ns);
    (ns.salesNavigator.getProfile as Mock).mockResolvedValue({ id: "p1", name: "John" });
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("calls salesNavigator.getProfile with identifier resolved via resolveIdentifier", async () => {
    const { runSalesNavProfile } = await import("../../src/commands/sales-nav.js");
    const out = makeOut();

    // Pass a full LinkedIn URL — should be resolved to just the slug
    await runSalesNavProfile(client as never, {
      account: "acc_1",
      identifier: "https://www.linkedin.com/in/john-doe",
      json: true,
    }, out);

    expect(ns.salesNavigator.getProfile).toHaveBeenCalledWith("john-doe", expect.anything());
  });

  it("bare slug is passed through unchanged", async () => {
    const { runSalesNavProfile } = await import("../../src/commands/sales-nav.js");
    const out = makeOut();

    await runSalesNavProfile(client as never, {
      account: "acc_1",
      identifier: "jdoe",
      json: true,
    }, out);

    expect(ns.salesNavigator.getProfile).toHaveBeenCalledWith("jdoe", expect.anything());
  });

  it("--preview on read: exits 2", async () => {
    const { runSalesNavProfile } = await import("../../src/commands/sales-nav.js");
    const out = makeOut();
    const exitSpy = mockExit();

    try {
      await runSalesNavProfile(client as never, { account: "acc_1", identifier: "jdoe", preview: true }, out);
      expect.fail("should have exited");
    } catch (e) {
      expect((e as Error).message).toContain("process.exit(2)");
    } finally {
      exitSpy.mockRestore();
    }
    expect(ns.salesNavigator.getProfile).not.toHaveBeenCalled();
  });
});

// ─── sales-nav save-lead ───────────────────────────────────────────────────

describe("sales-nav save-lead", () => {
  let ns: ReturnType<typeof makeSalesNavNs>;
  let client: ReturnType<typeof makeClient>;

  beforeEach(() => {
    ns = makeSalesNavNs();
    client = makeClient(ns);
    (ns.salesNavigator.saveLead as Mock).mockResolvedValue({ saved: true, user_id: "ACw123" });
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("calls salesNavigator.saveLead with userId verbatim (no resolveIdentifier)", async () => {
    const { runSalesNavSaveLead } = await import("../../src/commands/sales-nav.js");
    const out = makeOut();

    // user_id is a native platform id (ACw…), NOT a LinkedIn URL — must NOT be resolved
    await runSalesNavSaveLead(client as never, {
      account: "acc_1",
      userId: "ACw_full_url_if_given_should_pass_verbatim",
      json: true,
    }, out);

    expect(ns.salesNavigator.saveLead).toHaveBeenCalledWith(
      "ACw_full_url_if_given_should_pass_verbatim",
      expect.anything(),
    );
  });

  it("passes list-id in body when provided", async () => {
    const { runSalesNavSaveLead } = await import("../../src/commands/sales-nav.js");
    const out = makeOut();

    await runSalesNavSaveLead(client as never, {
      account: "acc_1",
      userId: "ACw123",
      "list-id": "list_456",
      json: true,
    }, out);

    expect(ns.salesNavigator.saveLead).toHaveBeenCalledWith(
      "ACw123",
      expect.objectContaining({ list_id: "list_456" }),
    );
  });

  it("--preview renders request, does not call saveLead", async () => {
    const { runSalesNavSaveLead } = await import("../../src/commands/sales-nav.js");
    const out = makeOut();

    await runSalesNavSaveLead(client as never, {
      account: "acc_1",
      userId: "ACw123",
      preview: true,
    }, out);

    expect(ns.salesNavigator.saveLead).not.toHaveBeenCalled();
    const written = (out.stdout.write as Mock).mock.calls.map((c) => c[0] as string).join("");
    const parsed = JSON.parse(written);
    expect(parsed.method).toBe("salesNavigator.saveLead");
  });
});

// ─── TS-005: no sales-nav inmail-balance in registry ─────────────────────

describe("TS-005: sales-nav registry has no inmail-balance", () => {
  it("salesNavCommand does not have an inmail-balance subcommand", async () => {
    vi.resetModules();
    const { salesNavCommand } = await import("../../src/commands/sales-nav.js");
    // salesNavCommand.subCommands should not include "inmail-balance"
    const subCommands = (salesNavCommand as { subCommands?: Record<string, unknown> }).subCommands ?? {};
    expect("inmail-balance" in subCommands).toBe(false);
  });
});
