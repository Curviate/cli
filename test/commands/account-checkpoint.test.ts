/**
 * Guided checkpoint follow-through on `account link` / `account reconnect`.
 *
 * Covers the 202 checkpoint_required branch: interactive TTY resolution
 * (code prompt, 422 retry loop, chained-challenge follow-through, the
 * codeless mobile-app-approval poll sub-loop, the resend hint) and the
 * non-interactive branch (envelope-and-exit-12), hermetically — a mock
 * `MinimalClient` plus injected readline/sleep/clock, never a real TTY.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Mock } from "vitest";
import { CurviateError } from "@curviate/sdk";
import { AUTH_NEEDED } from "../../src/lib/exit-codes.js";

// ---------------------------------------------------------------------------
// Client mock factory (mirrors test/commands/account.test.ts)
// ---------------------------------------------------------------------------

function makeClient() {
  return {
    accounts: {
      list: vi.fn(),
      get: vi.fn(),
      link: vi.fn(),
      createConnectLink: vi.fn(),
      reconnect: vi.fn(),
      refresh: vi.fn(),
      update: vi.fn(),
      disconnect: vi.fn(),
      submitCheckpoint: vi.fn(),
      pollCheckpoint: vi.fn(),
    },
  };
}

type Client = ReturnType<typeof makeClient>;

type AccountFlags = {
  "seat-id"?: string;
  "account-id"?: string;
  "auth-method"?: string;
  email?: string;
  password?: string;
  "li-at"?: string;
  "no-interactive"?: boolean;
  json?: boolean;
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

function invalidCodeError(attemptsRemaining?: number) {
  const err = new CurviateError({
    code: "CHECKPOINT_INVALID_CODE",
    message: "The code you entered is incorrect.",
    httpStatus: 422,
    userFixable: true,
    retryLikelyToSucceed: true,
  });
  if (attemptsRemaining !== undefined) {
    return Object.assign(err, { attempts_remaining: attemptsRemaining });
  }
  return err;
}

function maxAttemptsError() {
  return new CurviateError({
    code: "CHECKPOINT_MAX_ATTEMPTS",
    message: "Too many failed attempts.",
    httpStatus: 429,
    userFixable: true,
    retryLikelyToSucceed: false,
  });
}

function expiredError() {
  return new CurviateError({
    code: "CHECKPOINT_EXPIRED",
    message: "The checkpoint has expired.",
    httpStatus: 409,
    userFixable: true,
    retryLikelyToSucceed: false,
  });
}

const OTP_CHECKPOINT = {
  object: "checkpoint",
  status: "checkpoint_required",
  account_id: "acc_pending_1",
  challenge_type: "otp",
  expires_at: "2099-01-01T00:00:00.000Z",
};

const noopSleep = () => Promise.resolve();
const constantNow = () => 0;

function makeLinkArgs() {
  // password is supplied directly (tier-1 flag) so credential resolution
  // never touches the injected readline mock — that mock is reserved for
  // the checkpoint-code prompt in these tests, not the password prompt.
  return {
    "seat-id": "seat_1",
    "auth-method": "credentials",
    email: "otp@example.com",
    password: "test-password",
    json: true,
  } as AccountFlags;
}

function makeReconnectArgs() {
  return {
    "account-id": "acc_1",
    "auth-method": "credentials",
    email: "otp@example.com",
    password: "test-password",
    json: true,
  } as AccountFlags;
}

// ---------------------------------------------------------------------------
// Non-interactive branch
// ---------------------------------------------------------------------------

describe("account link — checkpoint_required, non-interactive", () => {
  let client: Client;
  beforeEach(() => {
    client = makeClient();
    (client.accounts.link as Mock).mockResolvedValue(OTP_CHECKPOINT);
  });
  afterEach(() => vi.restoreAllMocks());

  it("stdin non-TTY: renders the 202 envelope to stdout and exits 12, never prompts", async () => {
    const { runAccountLink } = await import("../../src/commands/account.js");
    const out = makeOut();
    const readline = vi.fn();
    const exitSpy = makeExitSpy();
    try {
      await runAccountLink(client as never, makeLinkArgs(), out, {
        isTTY: false,
        isOutputTTY: true,
        readline,
      });
      expect.fail("should have exited");
    } catch (e) {
      expect((e as Error).message).toContain(`process.exit(${AUTH_NEEDED})`);
    } finally {
      exitSpy.mockRestore();
    }
    expect(readline).not.toHaveBeenCalled();
    expect(client.accounts.submitCheckpoint).not.toHaveBeenCalled();
    const written = (out.stdout.write as Mock).mock.calls.map((c) => c[0] as string).join("");
    const parsed = JSON.parse(written);
    expect(parsed).toMatchObject({ status: "checkpoint_required", challenge_type: "otp" });
  });

  it("stdout non-TTY (stdin IS a TTY): still exits 12 — either stream being non-TTY forces non-interactive", async () => {
    const { runAccountLink } = await import("../../src/commands/account.js");
    const out = makeOut();
    const readline = vi.fn();
    const exitSpy = makeExitSpy();
    try {
      await runAccountLink(client as never, makeLinkArgs(), out, {
        isTTY: true,
        isOutputTTY: false,
        readline,
      });
      expect.fail("should have exited");
    } catch (e) {
      expect((e as Error).message).toContain(`process.exit(${AUTH_NEEDED})`);
    } finally {
      exitSpy.mockRestore();
    }
    expect(readline).not.toHaveBeenCalled();
  });

  it("--no-interactive under a real TTY still exits 12, no prompt", async () => {
    const { runAccountLink } = await import("../../src/commands/account.js");
    const out = makeOut();
    const readline = vi.fn();
    const exitSpy = makeExitSpy();
    try {
      await runAccountLink(client as never, { ...makeLinkArgs(), "no-interactive": true }, out, {
        isTTY: true,
        isOutputTTY: true,
        readline,
      });
      expect.fail("should have exited");
    } catch (e) {
      expect((e as Error).message).toContain(`process.exit(${AUTH_NEEDED})`);
    } finally {
      exitSpy.mockRestore();
    }
    expect(readline).not.toHaveBeenCalled();
    expect(client.accounts.submitCheckpoint).not.toHaveBeenCalled();
  });

  it("a completed (non-checkpoint) link response is unaffected — no exit, renders as before", async () => {
    (client.accounts.link as Mock).mockResolvedValue({ object: "account", account_id: "acc_new", status: "active" });
    const { runAccountLink } = await import("../../src/commands/account.js");
    const out = makeOut();
    await runAccountLink(client as never, makeLinkArgs(), out, { isTTY: false, isOutputTTY: false });
    const written = (out.stdout.write as Mock).mock.calls.map((c) => c[0] as string).join("");
    expect(JSON.parse(written)).toMatchObject({ account_id: "acc_new" });
  });
});

// ---------------------------------------------------------------------------
// Interactive branch — code-based challenge (prompt, 422 retry, chained follow-through, resend hint)
// ---------------------------------------------------------------------------

describe("account link — checkpoint_required, interactive OTP", () => {
  let client: Client;
  beforeEach(() => {
    client = makeClient();
    (client.accounts.link as Mock).mockResolvedValue(OTP_CHECKPOINT);
  });
  afterEach(() => vi.restoreAllMocks());

  it("prints the challenge copy, reads the code, submits, and prints success on the first try", async () => {
    const { runAccountLink } = await import("../../src/commands/account.js");
    const out = makeOut();
    const readline = vi.fn().mockResolvedValue("999999");
    (client.accounts.submitCheckpoint as Mock).mockResolvedValue({ object: "account", account_id: "acc_final", status: "active" });

    await runAccountLink(client as never, makeLinkArgs(), out, {
      isTTY: true,
      isOutputTTY: true,
      readline,
      sleep: noopSleep,
      now: constantNow,
    });

    const stderrText = (out.stderr.write as Mock).mock.calls.map((c) => c[0] as string).join("");
    expect(stderrText).toContain("Check your email");
    expect(stderrText).toContain("Account linked: acc_final");
    // Resend hint is present for otp
    expect(stderrText).toContain("checkpoint resend --checkpoint acc_pending_1");

    expect(client.accounts.submitCheckpoint).toHaveBeenCalledTimes(1);
    expect(client.accounts.submitCheckpoint).toHaveBeenCalledWith({ account_id: "acc_pending_1", code: "999999" });
  });

  it("422 loop: re-prompts with retry copy (no re-printed challenge copy) and resolves on the second entry", async () => {
    const { runAccountLink } = await import("../../src/commands/account.js");
    const out = makeOut();
    const readline = vi.fn().mockResolvedValueOnce("000000").mockResolvedValueOnce("999999");
    (client.accounts.submitCheckpoint as Mock)
      .mockRejectedValueOnce(invalidCodeError(4))
      .mockResolvedValueOnce({ object: "account", account_id: "acc_final", status: "active" });

    await runAccountLink(client as never, makeLinkArgs(), out, {
      isTTY: true,
      isOutputTTY: true,
      readline,
      sleep: noopSleep,
      now: constantNow,
    });

    expect(client.accounts.submitCheckpoint).toHaveBeenCalledTimes(2);
    // Both attempts submit against the SAME provisional account_id (only the code differs) —
    // a 422 retries the same stage, it does not re-address a new checkpoint.
    expect(client.accounts.submitCheckpoint).toHaveBeenNthCalledWith(1, { account_id: "acc_pending_1", code: "000000" });
    expect(client.accounts.submitCheckpoint).toHaveBeenNthCalledWith(2, { account_id: "acc_pending_1", code: "999999" });
    const stderrText = (out.stderr.write as Mock).mock.calls.map((c) => c[0] as string).join("");
    expect(stderrText).toContain("4 attempt(s) remaining");
    // Challenge copy ("Check your email") is printed exactly once — not re-printed on retry
    expect(stderrText.split("Check your email").length - 1).toBe(1);
  });

  it("6th invalid attempt (CHECKPOINT_MAX_ATTEMPTS) exits 9", async () => {
    const { runAccountLink } = await import("../../src/commands/account.js");
    const out = makeOut();
    const readline = vi.fn().mockResolvedValue("000000");
    (client.accounts.submitCheckpoint as Mock)
      .mockRejectedValueOnce(invalidCodeError(4))
      .mockRejectedValueOnce(invalidCodeError(3))
      .mockRejectedValueOnce(invalidCodeError(2))
      .mockRejectedValueOnce(invalidCodeError(1))
      .mockRejectedValueOnce(invalidCodeError(0))
      .mockRejectedValueOnce(maxAttemptsError());

    const exitSpy = makeExitSpy();
    try {
      await runAccountLink(client as never, makeLinkArgs(), out, {
        isTTY: true,
        isOutputTTY: true,
        readline,
        sleep: noopSleep,
        now: constantNow,
      });
      expect.fail("should have exited");
    } catch (e) {
      expect((e as Error).message).toContain("process.exit(9)");
    } finally {
      exitSpy.mockRestore();
    }
    expect(client.accounts.submitCheckpoint).toHaveBeenCalledTimes(6);
  });

  it("CHECKPOINT_EXPIRED (409) exits 9", async () => {
    const { runAccountLink } = await import("../../src/commands/account.js");
    const out = makeOut();
    const readline = vi.fn().mockResolvedValue("999999");
    (client.accounts.submitCheckpoint as Mock).mockRejectedValue(expiredError());

    const exitSpy = makeExitSpy();
    try {
      await runAccountLink(client as never, makeLinkArgs(), out, {
        isTTY: true,
        isOutputTTY: true,
        readline,
        sleep: noopSleep,
        now: constantNow,
      });
      expect.fail("should have exited");
    } catch (e) {
      expect((e as Error).message).toContain("process.exit(9)");
    } finally {
      exitSpy.mockRestore();
    }
  });

  it("chained challenge: OTP resolves into a fresh two_factor_app challenge, then that resolves", async () => {
    const { runAccountLink } = await import("../../src/commands/account.js");
    const out = makeOut();
    const readline = vi.fn().mockResolvedValueOnce("999999").mockResolvedValueOnce("999999");
    (client.accounts.submitCheckpoint as Mock)
      .mockResolvedValueOnce({
        object: "checkpoint",
        status: "checkpoint_required",
        account_id: "acc_pending_2",
        challenge_type: "two_factor_app",
        expires_at: "2099-01-01T00:00:00.000Z",
      })
      .mockResolvedValueOnce({ object: "account", account_id: "acc_final", status: "active" });

    await runAccountLink(client as never, makeLinkArgs(), out, {
      isTTY: true,
      isOutputTTY: true,
      readline,
      sleep: noopSleep,
      now: constantNow,
    });

    expect(client.accounts.submitCheckpoint).toHaveBeenCalledTimes(2);
    expect(client.accounts.submitCheckpoint).toHaveBeenNthCalledWith(1, { account_id: "acc_pending_1", code: "999999" });
    expect(client.accounts.submitCheckpoint).toHaveBeenNthCalledWith(2, { account_id: "acc_pending_2", code: "999999" });

    const stderrText = (out.stderr.write as Mock).mock.calls.map((c) => c[0] as string).join("");
    expect(stderrText).toContain("Check your email");
    expect(stderrText).toContain("Enter authenticator code");
    // two_factor_app has no resend hint
    const afterChain = stderrText.slice(stderrText.indexOf("Enter authenticator code"));
    expect(afterChain).not.toContain("checkpoint resend");
  });
});

// ---------------------------------------------------------------------------
// Interactive branch — codeless mobile_app_approval (poll sub-loop + wall-clock timeout)
// ---------------------------------------------------------------------------

describe("account link — checkpoint_required, interactive mobile_app_approval", () => {
  let client: Client;
  const MOBILE_CHECKPOINT = {
    object: "checkpoint",
    status: "checkpoint_required",
    account_id: "acc_pending_mobile",
    challenge_type: "mobile_app_approval",
    expires_at: "2099-01-01T00:00:00.000Z",
  };

  beforeEach(() => {
    client = makeClient();
    (client.accounts.link as Mock).mockResolvedValue(MOBILE_CHECKPOINT);
  });
  afterEach(() => vi.restoreAllMocks());

  it("polls pollCheckpoint until active, prints approve copy + resend hint, no code prompt", async () => {
    const { runAccountLink } = await import("../../src/commands/account.js");
    const out = makeOut();
    const readline = vi.fn();
    (client.accounts.pollCheckpoint as Mock)
      .mockResolvedValueOnce({ object: "checkpoint", status: "pending" })
      .mockResolvedValueOnce({ object: "account", status: "active", account_id: "acc_final" });

    await runAccountLink(client as never, makeLinkArgs(), out, {
      isTTY: true,
      isOutputTTY: true,
      readline,
      sleep: noopSleep,
      now: constantNow,
    });

    expect(readline).not.toHaveBeenCalled();
    expect(client.accounts.pollCheckpoint).toHaveBeenCalledTimes(2);
    expect(client.accounts.pollCheckpoint).toHaveBeenCalledWith({ account_id: "acc_pending_mobile" });
    const stderrText = (out.stderr.write as Mock).mock.calls.map((c) => c[0] as string).join("");
    expect(stderrText).toContain("Approve in LinkedIn app");
    expect(stderrText).toContain("checkpoint resend --checkpoint acc_pending_mobile");
    expect(stderrText).toContain("Account linked: acc_final");
  });

  it.each(["expired", "failed"])("terminal status %s while waiting → exit 9", async (status) => {
    const { runAccountLink } = await import("../../src/commands/account.js");
    const out = makeOut();
    (client.accounts.pollCheckpoint as Mock).mockResolvedValue({ object: "checkpoint", status });

    const exitSpy = makeExitSpy();
    try {
      await runAccountLink(client as never, makeLinkArgs(), out, {
        isTTY: true,
        isOutputTTY: true,
        readline: vi.fn(),
        sleep: noopSleep,
        now: constantNow,
      });
      expect.fail("should have exited");
    } catch (e) {
      expect((e as Error).message).toContain("process.exit(9)");
    } finally {
      exitSpy.mockRestore();
    }
  });

  it("wall-clock timeout while still pending → exit 12 (distinct from exit 9)", async () => {
    const { runAccountLink } = await import("../../src/commands/account.js");
    const out = makeOut();
    (client.accounts.pollCheckpoint as Mock).mockResolvedValue({ object: "checkpoint", status: "pending" });

    // now() always reports a time PAST the checkpoint's expires_at (year 2000, i.e.
    // before the fixture's 2099 expiry) so the very first pending-status check times out
    // — deterministic, no reliance on real wall-clock delay.
    const exitSpy = makeExitSpy();
    try {
      await runAccountLink(client as never, makeLinkArgs(), out, {
        isTTY: true,
        isOutputTTY: true,
        readline: vi.fn(),
        sleep: noopSleep,
        now: () => new Date("2100-01-01T00:00:00.000Z").getTime(),
      });
      expect.fail("should have exited");
    } catch (e) {
      expect((e as Error).message).toContain(`process.exit(${AUTH_NEEDED})`);
    } finally {
      exitSpy.mockRestore();
    }
    expect(client.accounts.pollCheckpoint).toHaveBeenCalledTimes(1);
    const stderrText = (out.stderr.write as Mock).mock.calls.map((c) => c[0] as string).join("");
    expect(stderrText).toContain("checkpoint poll --checkpoint acc_pending_mobile");
  });
});

// ---------------------------------------------------------------------------
// account reconnect — same mechanics, "reconnected" wording — spot check
// ---------------------------------------------------------------------------

describe("account reconnect — checkpoint_required, interactive OTP", () => {
  let client: Client;
  beforeEach(() => {
    client = makeClient();
    (client.accounts.reconnect as Mock).mockResolvedValue(OTP_CHECKPOINT);
  });
  afterEach(() => vi.restoreAllMocks());

  it("prints 'Account reconnected' (not 'linked') on completion", async () => {
    const { runAccountReconnect } = await import("../../src/commands/account.js");
    const out = makeOut();
    const readline = vi.fn().mockResolvedValue("999999");
    (client.accounts.submitCheckpoint as Mock).mockResolvedValue({ object: "account", account_id: "acc_final", status: "active" });

    await runAccountReconnect(
      client as never,
      makeReconnectArgs(),
      out,
      { isTTY: true, isOutputTTY: true, readline, sleep: noopSleep, now: constantNow },
    );

    const stderrText = (out.stderr.write as Mock).mock.calls.map((c) => c[0] as string).join("");
    expect(stderrText).toContain("Account reconnected: acc_final");
  });

  it("non-interactive reconnect renders the envelope and exits 12", async () => {
    const { runAccountReconnect } = await import("../../src/commands/account.js");
    const out = makeOut();
    const exitSpy = makeExitSpy();
    try {
      await runAccountReconnect(
        client as never,
        makeReconnectArgs(),
        out,
        { isTTY: false, isOutputTTY: false },
      );
      expect.fail("should have exited");
    } catch (e) {
      expect((e as Error).message).toContain(`process.exit(${AUTH_NEEDED})`);
    } finally {
      exitSpy.mockRestore();
    }
  });
});

// ---------------------------------------------------------------------------
// AUTH_NEEDED exit-code constant
// ---------------------------------------------------------------------------

describe("lib/exit-codes — AUTH_NEEDED", () => {
  it("AUTH_NEEDED === 12", () => {
    expect(AUTH_NEEDED).toBe(12);
  });

  it("no ErrorCode maps to 12 in EXIT_CODE_MAP", async () => {
    const { EXIT_CODE_MAP } = await import("../../src/lib/exit-codes.js");
    const mappedValues = Object.values(EXIT_CODE_MAP);
    expect(mappedValues).not.toContain(12);
  });
});
