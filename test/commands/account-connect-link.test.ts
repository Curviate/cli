/**
 * `account connect-link` browser-handoff open+wait UX and the standalone
 * `account connect-session poll` command.
 *
 * Covers:
 *   - TTY + interactive: auto-open via an injected `open` seam, then the
 *     adaptive-cadence wait loop (1000ms, then 1500ms for 30s, then 3000ms)
 *     against a mock `getConnectSession`, all terminal exits (resolved/
 *     expired/failed/timeout), the stderr status ticker vs. --json silence.
 *   - Non-TTY / --no-interactive (the agent path): NEVER opens a browser,
 *     NEVER polls, exits 0 immediately with the mint response.
 *   - --open/--no-open and --wait/--no-wait explicit overrides on a TTY.
 *   - `account connect-session poll` standalone: one-shot (default) and
 *     --wait (same loop, same terminal semantics).
 *   - Flag suppression (the single-object write convention: pagination flags
 *     absent, --fields kept) and command registration.
 *
 * Hermetic throughout: a mock MinimalClient, injected sleep/now/open/TTY
 * seams — never a real timer, never a real browser.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Mock } from "vitest";
import { AUTH_NEEDED } from "../../src/lib/exit-codes.js";
import { CHECKPOINT_POLL_FAST_WINDOW_MS } from "../../src/lib/checkpoint-cadence.js";

// ---------------------------------------------------------------------------
// Client mock factory
// ---------------------------------------------------------------------------

function makeClient() {
  return {
    accounts: {
      createConnectLink: vi.fn(),
      getConnectSession: vi.fn(),
    },
  };
}

type Client = ReturnType<typeof makeClient>;

type AccountFlags = {
  "seat-id"?: string;
  "account-id"?: string;
  purpose?: string;
  "expires-in-seconds"?: string;
  "redirect-url"?: string;
  session?: string;
  wait?: boolean;
  open?: boolean;
  "no-interactive"?: boolean;
  timeout?: string;
  json?: boolean;
  preview?: boolean;
};

function makeOut() {
  return {
    stdout: { write: vi.fn() },
    stderr: { write: vi.fn() },
  };
}

function makeExitSpy() {
  return vi.spyOn(process, "exit").mockImplementation((code?: number | string | null) => {
    throw new Error(`process.exit(${code})`);
  });
}

/**
 * An injectable clock pair where `sleep` advances `now()` by exactly the
 * requested delay instead of waiting in real time (same technique as the
 * checkpoint poll --wait tests) — deterministic cadence assertions, zero
 * real wall-clock cost.
 */
function makeAdvancingClock(startMs = 0) {
  let current = startMs;
  const now = () => current;
  const sleep = vi.fn((ms: number) => {
    current += ms;
    return Promise.resolve();
  });
  return { now, sleep };
}

const MINT_RESULT = {
  object: "hosted_auth_url",
  url: "https://curviate.com/api/connect/deadbeef",
  session_id: "cs_1",
  expires_at: "2099-01-01T00:00:00.000Z",
  seat_id: "seat_1",
};

function resolvedSession(accountId = "acc_final") {
  return {
    object: "connect_session",
    session_id: "cs_1",
    status: "resolved",
    account_id: accountId,
    expires_at: "2099-01-01T00:00:00.000Z",
  };
}

const PENDING_SESSION = {
  object: "connect_session",
  session_id: "cs_1",
  status: "pending",
  account_id: null,
  expires_at: "2099-01-01T00:00:00.000Z",
};

// ---------------------------------------------------------------------------
// account connect-link — TTY + interactive (open + wait)
// ---------------------------------------------------------------------------

describe("account connect-link — TTY + interactive open+wait", () => {
  let client: Client;
  beforeEach(() => {
    client = makeClient();
    (client.accounts.createConnectLink as Mock).mockResolvedValue(MINT_RESULT);
  });
  afterEach(() => vi.restoreAllMocks());

  it("opens the URL once, polls on the 1000/1500(x30s)/3000ms cadence, resolves -> 'Account connected', exit 0", async () => {
    const { runAccountConnectLink } = await import("../../src/commands/account.js");
    const out = makeOut();
    const clock = makeAdvancingClock();
    const open = vi.fn().mockResolvedValue(undefined);
    (client.accounts.getConnectSession as Mock).mockResolvedValue(resolvedSession());

    await runAccountConnectLink(
      client as never,
      { "seat-id": "seat_1", purpose: "create", json: true } as AccountFlags,
      out,
      { isTTY: true, isOutputTTY: true, sleep: clock.sleep, now: clock.now, open },
    );

    expect(open).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith(MINT_RESULT.url);
    expect(client.accounts.getConnectSession).toHaveBeenCalledWith(
      expect.objectContaining({ session_id: "cs_1" }),
    );
    expect(clock.sleep).toHaveBeenNthCalledWith(1, 1000);

    const stderrText = (out.stderr.write as Mock).mock.calls.map((c) => c[0] as string).join("");
    expect(stderrText).toContain("Account connected: acc_final");

    const written = (out.stdout.write as Mock).mock.calls.map((c) => c[0] as string).join("");
    expect(JSON.parse(written)).toMatchObject({ status: "resolved", account_id: "acc_final" });
  });

  it.each(["expired", "failed"])("terminal status %s while waiting -> exit 9", async (status) => {
    const { runAccountConnectLink } = await import("../../src/commands/account.js");
    const out = makeOut();
    const clock = makeAdvancingClock();
    const open = vi.fn().mockResolvedValue(undefined);
    (client.accounts.getConnectSession as Mock).mockResolvedValue({
      object: "connect_session",
      session_id: "cs_1",
      status,
      account_id: null,
      expires_at: "2099-01-01T00:00:00.000Z",
    });

    const exitSpy = makeExitSpy();
    try {
      await runAccountConnectLink(
        client as never,
        { "seat-id": "seat_1", json: true } as AccountFlags,
        out,
        { isTTY: true, isOutputTTY: true, sleep: clock.sleep, now: clock.now, open },
      );
      expect.fail("should have exited");
    } catch (e) {
      expect((e as Error).message).toContain("process.exit(9)");
    } finally {
      exitSpy.mockRestore();
    }
    expect(open).toHaveBeenCalledTimes(1);
  });

  it("--timeout elapses while still pending -> exit 12 (AUTH_NEEDED), distinct from exit 9", async () => {
    const { runAccountConnectLink } = await import("../../src/commands/account.js");
    const out = makeOut();
    const clock = makeAdvancingClock();
    const open = vi.fn().mockResolvedValue(undefined);
    (client.accounts.getConnectSession as Mock).mockResolvedValue(PENDING_SESSION);

    const exitSpy = makeExitSpy();
    try {
      await runAccountConnectLink(
        client as never,
        { "seat-id": "seat_1", json: true, timeout: "500" } as AccountFlags,
        out,
        { isTTY: true, isOutputTTY: true, sleep: clock.sleep, now: clock.now, open },
      );
      expect.fail("should have exited");
    } catch (e) {
      expect((e as Error).message).toContain(`process.exit(${AUTH_NEEDED})`);
    } finally {
      exitSpy.mockRestore();
    }
    // The --timeout override (500ms) elapses before the first poll response
    // (which arrives at t=1000, after the fixed initial delay) — one call only.
    expect(client.accounts.getConnectSession).toHaveBeenCalledTimes(1);
  });

  it("with no --timeout, the wait bound defaults to the session's own expires_at", async () => {
    const { runAccountConnectLink } = await import("../../src/commands/account.js");
    const out = makeOut();
    const clock = makeAdvancingClock();
    const open = vi.fn().mockResolvedValue(undefined);
    // expires_at (t=1500ms) falls between the first poll (t=1000, not yet
    // expired) and the second (t=2500, past expiry) — proves the default
    // bound is read from the response, not a hardcoded fallback.
    (client.accounts.getConnectSession as Mock).mockResolvedValue({
      ...PENDING_SESSION,
      expires_at: new Date(1500).toISOString(),
    });

    const exitSpy = makeExitSpy();
    try {
      await runAccountConnectLink(
        client as never,
        { "seat-id": "seat_1", json: true } as AccountFlags,
        out,
        { isTTY: true, isOutputTTY: true, sleep: clock.sleep, now: clock.now, open },
      );
      expect.fail("should have exited");
    } catch (e) {
      expect((e as Error).message).toContain(`process.exit(${AUTH_NEEDED})`);
    } finally {
      exitSpy.mockRestore();
    }
    expect(client.accounts.getConnectSession).toHaveBeenCalledTimes(2);
  });

  it("the sleep-arg cadence crosses the 30s fast/slow boundary at the right elapsed threshold", async () => {
    const { runAccountConnectLink } = await import("../../src/commands/account.js");
    const out = makeOut();
    const clock = makeAdvancingClock();
    const open = vi.fn().mockResolvedValue(undefined);
    (client.accounts.getConnectSession as Mock).mockImplementation(async () => {
      if (clock.now() >= CHECKPOINT_POLL_FAST_WINDOW_MS + 5000) {
        return resolvedSession();
      }
      return PENDING_SESSION;
    });

    await runAccountConnectLink(
      client as never,
      { "seat-id": "seat_1", json: true } as AccountFlags,
      out,
      { isTTY: true, isOutputTTY: true, sleep: clock.sleep, now: clock.now, open },
    );

    const delays = clock.sleep.mock.calls.map((c) => c[0] as number);
    expect(delays[0]).toBe(1000);
    expect(delays).toContain(1500);
    expect(delays).toContain(3000);

    let elapsed = 0;
    for (const d of delays) {
      if (d === 3000) {
        expect(elapsed).toBeGreaterThanOrEqual(CHECKPOINT_POLL_FAST_WINDOW_MS);
        break;
      }
      expect(d).toBe(elapsed === 0 ? 1000 : 1500);
      elapsed += d;
    }
  });

  it("TTY + not --json prints a refreshing 'Waiting for the account to connect' status line to stderr while pending", async () => {
    const { runAccountConnectLink } = await import("../../src/commands/account.js");
    const out = makeOut();
    const clock = makeAdvancingClock();
    const open = vi.fn().mockResolvedValue(undefined);
    (client.accounts.getConnectSession as Mock)
      .mockResolvedValueOnce(PENDING_SESSION)
      .mockResolvedValueOnce(resolvedSession());

    await runAccountConnectLink(
      client as never,
      { "seat-id": "seat_1" } as AccountFlags, // no json:true — human/TTY path
      out,
      { isTTY: true, isOutputTTY: true, sleep: clock.sleep, now: clock.now, open },
    );

    const stderrText = (out.stderr.write as Mock).mock.calls.map((c) => c[0] as string).join("");
    expect(stderrText).toContain("Waiting for the account to connect");
    expect(stderrText).toContain("remaining");
  });

  it("non-TTY-output / --json stays silent on the status ticker until the terminal state", async () => {
    const { runAccountConnectLink } = await import("../../src/commands/account.js");
    const out = makeOut();
    const clock = makeAdvancingClock();
    const open = vi.fn().mockResolvedValue(undefined);
    (client.accounts.getConnectSession as Mock)
      .mockResolvedValueOnce(PENDING_SESSION)
      .mockResolvedValueOnce(resolvedSession());

    await runAccountConnectLink(
      client as never,
      { "seat-id": "seat_1", json: true } as AccountFlags,
      out,
      { isTTY: true, isOutputTTY: true, sleep: clock.sleep, now: clock.now, open }, // TTY true, but --json forces silence
    );

    const stderrText = (out.stderr.write as Mock).mock.calls.map((c) => c[0] as string).join("");
    expect(stderrText).not.toContain("Waiting for the account to connect");
  });

  it("--no-open skips opening the browser but still runs the wait loop", async () => {
    const { runAccountConnectLink } = await import("../../src/commands/account.js");
    const out = makeOut();
    const clock = makeAdvancingClock();
    const open = vi.fn().mockResolvedValue(undefined);
    (client.accounts.getConnectSession as Mock).mockResolvedValue(resolvedSession());

    await runAccountConnectLink(
      client as never,
      { "seat-id": "seat_1", json: true, open: false } as AccountFlags,
      out,
      { isTTY: true, isOutputTTY: true, sleep: clock.sleep, now: clock.now, open },
    );

    expect(open).not.toHaveBeenCalled();
    expect(client.accounts.getConnectSession).toHaveBeenCalledTimes(1);
  });

  it("--no-wait opens the browser but skips the wait loop, exits 0 immediately", async () => {
    const { runAccountConnectLink } = await import("../../src/commands/account.js");
    const out = makeOut();
    const clock = makeAdvancingClock();
    const open = vi.fn().mockResolvedValue(undefined);

    await runAccountConnectLink(
      client as never,
      { "seat-id": "seat_1", json: true, wait: false } as AccountFlags,
      out,
      { isTTY: true, isOutputTTY: true, sleep: clock.sleep, now: clock.now, open },
    );

    expect(open).toHaveBeenCalledTimes(1);
    expect(client.accounts.getConnectSession).not.toHaveBeenCalled();
    expect(clock.sleep).not.toHaveBeenCalled();
    const written = (out.stdout.write as Mock).mock.calls.map((c) => c[0] as string).join("");
    expect(JSON.parse(written)).toMatchObject({ object: "hosted_auth_url", session_id: "cs_1" });
  });
});

// ---------------------------------------------------------------------------
// account connect-link — non-TTY / --no-interactive (the agent path)
// ---------------------------------------------------------------------------

describe("account connect-link — non-TTY / --no-interactive (agent path)", () => {
  let client: Client;
  beforeEach(() => {
    client = makeClient();
    (client.accounts.createConnectLink as Mock).mockResolvedValue(MINT_RESULT);
  });
  afterEach(() => vi.restoreAllMocks());

  it("stdout non-TTY: never calls open, never schedules a timer, prints url + relay instruction + session_id, exits 0 immediately", async () => {
    const { runAccountConnectLink } = await import("../../src/commands/account.js");
    const out = makeOut();
    const open = vi.fn();
    const sleep = vi.fn();

    await runAccountConnectLink(
      client as never,
      { "seat-id": "seat_1", purpose: "create", json: true } as AccountFlags,
      out,
      { isTTY: false, isOutputTTY: true, open, sleep },
    );

    expect(open).not.toHaveBeenCalled();
    expect(sleep).not.toHaveBeenCalled();
    expect(client.accounts.getConnectSession).not.toHaveBeenCalled();

    const stderrText = (out.stderr.write as Mock).mock.calls.map((c) => c[0] as string).join("");
    expect(stderrText).toContain(MINT_RESULT.url);
    expect(stderrText).toContain(MINT_RESULT.session_id);

    const written = (out.stdout.write as Mock).mock.calls.map((c) => c[0] as string).join("");
    expect(JSON.parse(written)).toMatchObject({
      object: "hosted_auth_url",
      url: MINT_RESULT.url,
      session_id: MINT_RESULT.session_id,
    });
  });

  it("stdin non-TTY (stdout IS a TTY): still short-circuits — either stream being non-TTY forces non-interactive", async () => {
    const { runAccountConnectLink } = await import("../../src/commands/account.js");
    const out = makeOut();
    const open = vi.fn();
    const sleep = vi.fn();

    await runAccountConnectLink(
      client as never,
      { "seat-id": "seat_1", json: true } as AccountFlags,
      out,
      { isTTY: true, isOutputTTY: false, open, sleep },
    );

    expect(open).not.toHaveBeenCalled();
    expect(sleep).not.toHaveBeenCalled();
  });

  it("--no-interactive under a real TTY also never opens and exits immediately", async () => {
    const { runAccountConnectLink } = await import("../../src/commands/account.js");
    const out = makeOut();
    const open = vi.fn();
    const sleep = vi.fn();

    await runAccountConnectLink(
      client as never,
      { "seat-id": "seat_1", json: true, "no-interactive": true } as AccountFlags,
      out,
      { isTTY: true, isOutputTTY: true, open, sleep },
    );

    expect(open).not.toHaveBeenCalled();
    expect(sleep).not.toHaveBeenCalled();
  });

  it("--open is ignored under non-TTY — never calls open even when explicitly passed", async () => {
    const { runAccountConnectLink } = await import("../../src/commands/account.js");
    const out = makeOut();
    const open = vi.fn();
    const sleep = vi.fn();

    await runAccountConnectLink(
      client as never,
      { "seat-id": "seat_1", json: true, open: true } as AccountFlags,
      out,
      { isTTY: false, isOutputTTY: true, open, sleep },
    );

    expect(open).not.toHaveBeenCalled();
    expect(sleep).not.toHaveBeenCalled();
  });

  it("a createConnectLink error still routes through the standard exit-code table (no open/wait attempted)", async () => {
    const { CurviateError } = await import("@curviate/sdk");
    (client.accounts.createConnectLink as Mock).mockRejectedValue(
      new CurviateError({
        code: "RESOURCE_NOT_FOUND",
        message: "Seat not found.",
        httpStatus: 404,
        userFixable: true,
        retryLikelyToSucceed: false,
      }),
    );
    const { runAccountConnectLink } = await import("../../src/commands/account.js");
    const out = makeOut();
    const open = vi.fn();

    const exitSpy = makeExitSpy();
    try {
      await runAccountConnectLink(
        client as never,
        { "seat-id": "seat_bad", json: true } as AccountFlags,
        out,
        { isTTY: true, isOutputTTY: true, open },
      );
      expect.fail("should have exited");
    } catch (e) {
      expect((e as Error).message).toContain("process.exit(4)");
    } finally {
      exitSpy.mockRestore();
    }
    expect(open).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// account connect-session poll
// ---------------------------------------------------------------------------

describe("account connect-session poll — one-shot (no --wait)", () => {
  let client: Client;
  beforeEach(() => {
    client = makeClient();
  });
  afterEach(() => vi.restoreAllMocks());

  it("calls getConnectSession once with the session_id, prints the body, exit 0 regardless of status", async () => {
    const { runAccountConnectSessionPoll } = await import("../../src/commands/account.js");
    const out = makeOut();
    (client.accounts.getConnectSession as Mock).mockResolvedValue(PENDING_SESSION);

    await runAccountConnectSessionPoll(
      client as never,
      { session: "cs_1", json: true } as AccountFlags,
      out,
    );

    expect(client.accounts.getConnectSession).toHaveBeenCalledTimes(1);
    expect(client.accounts.getConnectSession).toHaveBeenCalledWith({ session_id: "cs_1" });
    const written = (out.stdout.write as Mock).mock.calls.map((c) => c[0] as string).join("");
    expect(JSON.parse(written)).toMatchObject({ status: "pending" });
  });

  it("--session is required: missing it exits 2 before any getConnectSession call", async () => {
    const { runAccountConnectSessionPoll } = await import("../../src/commands/account.js");
    const out = makeOut();
    const exitSpy = makeExitSpy();
    try {
      await runAccountConnectSessionPoll(client as never, { json: true } as AccountFlags, out);
      expect.fail("should have exited");
    } catch (e) {
      expect((e as Error).message).toContain("process.exit(2)");
    } finally {
      exitSpy.mockRestore();
    }
    expect(client.accounts.getConnectSession).not.toHaveBeenCalled();
  });

  it("--preview renders the request without calling getConnectSession", async () => {
    const { runAccountConnectSessionPoll } = await import("../../src/commands/account.js");
    const out = makeOut();

    await runAccountConnectSessionPoll(
      client as never,
      { session: "cs_1", json: true, preview: true } as AccountFlags,
      out,
    );

    expect(client.accounts.getConnectSession).not.toHaveBeenCalled();
    const written = (out.stdout.write as Mock).mock.calls.map((c) => c[0] as string).join("");
    const parsed = JSON.parse(written);
    expect(parsed.method).toBe("accounts.getConnectSession");
    expect(parsed.body).toMatchObject({ session_id: "cs_1" });
  });
});

describe("account connect-session poll --wait — adaptive-cadence loop", () => {
  let client: Client;
  beforeEach(() => {
    client = makeClient();
  });
  afterEach(() => vi.restoreAllMocks());

  it("--wait resolves on the first poll (after the initial 1000ms delay), prints 'Account connected', exits 0", async () => {
    const { runAccountConnectSessionPoll } = await import("../../src/commands/account.js");
    const out = makeOut();
    const clock = makeAdvancingClock();
    (client.accounts.getConnectSession as Mock).mockResolvedValue(resolvedSession());

    await runAccountConnectSessionPoll(
      client as never,
      { session: "cs_1", json: true, wait: true } as AccountFlags,
      out,
      { isOutputTTY: false, sleep: clock.sleep, now: clock.now },
    );

    expect(client.accounts.getConnectSession).toHaveBeenCalledTimes(1);
    expect(clock.sleep).toHaveBeenNthCalledWith(1, 1000);
    const stderrText = (out.stderr.write as Mock).mock.calls.map((c) => c[0] as string).join("");
    expect(stderrText).toContain("Account connected: acc_final");
    const written = (out.stdout.write as Mock).mock.calls.map((c) => c[0] as string).join("");
    expect(JSON.parse(written)).toMatchObject({ status: "resolved" });
  });

  it.each(["expired", "failed"])("--wait exits 9 when the session reaches status %s", async (status) => {
    const { runAccountConnectSessionPoll } = await import("../../src/commands/account.js");
    const out = makeOut();
    const clock = makeAdvancingClock();
    (client.accounts.getConnectSession as Mock).mockResolvedValue({ ...PENDING_SESSION, status });

    const exitSpy = makeExitSpy();
    try {
      await runAccountConnectSessionPoll(
        client as never,
        { session: "cs_1", json: true, wait: true } as AccountFlags,
        out,
        { isOutputTTY: false, sleep: clock.sleep, now: clock.now },
      );
      expect.fail("should have exited");
    } catch (e) {
      expect((e as Error).message).toContain("process.exit(9)");
    } finally {
      exitSpy.mockRestore();
    }
  });

  it("--wait --timeout elapses while still pending -> exit 12 (AUTH_NEEDED)", async () => {
    const { runAccountConnectSessionPoll } = await import("../../src/commands/account.js");
    const out = makeOut();
    const clock = makeAdvancingClock();
    (client.accounts.getConnectSession as Mock).mockResolvedValue(PENDING_SESSION);

    const exitSpy = makeExitSpy();
    try {
      await runAccountConnectSessionPoll(
        client as never,
        { session: "cs_1", json: true, wait: true, timeout: "500" } as AccountFlags,
        out,
        { isOutputTTY: false, sleep: clock.sleep, now: clock.now },
      );
      expect.fail("should have exited");
    } catch (e) {
      expect((e as Error).message).toContain(`process.exit(${AUTH_NEEDED})`);
    } finally {
      exitSpy.mockRestore();
    }
    expect(client.accounts.getConnectSession).toHaveBeenCalledTimes(1);
  });

  it("--timeout must be numeric — a non-numeric value exits 2 before any getConnectSession call", async () => {
    const { runAccountConnectSessionPoll } = await import("../../src/commands/account.js");
    const out = makeOut();

    const exitSpy = makeExitSpy();
    try {
      await runAccountConnectSessionPoll(
        client as never,
        { session: "cs_1", json: true, wait: true, timeout: "not-a-number" } as AccountFlags,
        out,
      );
      expect.fail("should have exited");
    } catch (e) {
      expect((e as Error).message).toContain("process.exit(2)");
    } finally {
      exitSpy.mockRestore();
    }
    expect(client.accounts.getConnectSession).not.toHaveBeenCalled();
  });

  it("without --wait, a single poll call is unaffected (back-compat, --wait defaults off)", async () => {
    const { runAccountConnectSessionPoll } = await import("../../src/commands/account.js");
    const out = makeOut();
    (client.accounts.getConnectSession as Mock).mockResolvedValue(PENDING_SESSION);

    await runAccountConnectSessionPoll(
      client as never,
      { session: "cs_1", json: true } as AccountFlags,
      out,
    );

    expect(client.accounts.getConnectSession).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Command registration
// ---------------------------------------------------------------------------

describe("account connect-session — subcommand registration", () => {
  it("registers 'poll' under 'connect-session'", async () => {
    const { accountCommand } = await import("../../src/commands/account.js");
    const connectSession = (
      accountCommand as unknown as {
        subCommands: { "connect-session": { subCommands: Record<string, unknown> } };
      }
    ).subCommands["connect-session"];
    expect(Object.keys(connectSession.subCommands)).toEqual(["poll"]);
  });

  it("account command registers 'connect-session' alongside 'connect-link'", async () => {
    const { accountCommand } = await import("../../src/commands/account.js");
    const subCmds = (accountCommand as unknown as { subCommands: Record<string, unknown> }).subCommands;
    expect(subCmds).toHaveProperty("connect-link");
    expect(subCmds).toHaveProperty("connect-session");
  });
});

// ---------------------------------------------------------------------------
// Flag suppression (the single-object write convention) — pagination absent, --fields kept
// ---------------------------------------------------------------------------

const PAGINATION_ONLY_FLAGS = ["limit", "cursor", "all", "max-pages"] as const;

describe("account connect-link / connect-session poll — single-object write flag set", () => {
  it("account connect-link args has no pagination-only flags, keeps --fields, has --open/--wait/--timeout", async () => {
    const { accountCommand } = await import("../../src/commands/account.js");
    const subCmds = (accountCommand as unknown as { subCommands: Record<string, { args?: Record<string, unknown> }> })
      .subCommands;
    const args = subCmds["connect-link"]?.args ?? {};

    for (const flag of PAGINATION_ONLY_FLAGS) {
      expect(args, `connect-link args must NOT include --${flag}`).not.toHaveProperty(flag);
    }
    expect(args).not.toHaveProperty("idempotency-key");
    expect(args).not.toHaveProperty("dry-run");
    expect(args).toHaveProperty("fields");
    expect(args).toHaveProperty("open");
    expect(args).toHaveProperty("wait");
    expect(args).toHaveProperty("timeout");
  });

  it("account connect-session poll args has --session (required), --wait, --timeout, --fields, no pagination", async () => {
    const { accountCommand } = await import("../../src/commands/account.js");
    const subCmds = (
      accountCommand as unknown as {
        subCommands: { "connect-session": { subCommands: Record<string, { args?: Record<string, unknown> }> } };
      }
    ).subCommands;
    const args = (subCmds["connect-session"]?.subCommands?.["poll"]?.args ?? {}) as Record<
      string,
      { required?: boolean }
    >;

    for (const flag of PAGINATION_ONLY_FLAGS) {
      expect(args, `connect-session poll args must NOT include --${flag}`).not.toHaveProperty(flag);
    }
    expect(args).not.toHaveProperty("idempotency-key");
    expect(args).not.toHaveProperty("dry-run");
    expect(args).toHaveProperty("fields");
    expect(args).toHaveProperty("session");
    expect(args["session"]?.required).toBe(true);
    expect(args).toHaveProperty("wait");
    expect(args).toHaveProperty("timeout");
  });
});
