/**
 * Unit tests for challenge-type display copy and the checkpoint-resend hint
 * gating (resendable types vs. two_factor_app, which has nothing to resend).
 */
import { describe, it, expect, vi } from "vitest";
import {
  challengeTitle,
  challengeDescription,
  printChallengeCopy,
  printResendHintIfApplicable,
  type ChallengeType,
} from "../../src/lib/checkpoint-copy.js";

function makeOut() {
  return { stderr: { write: vi.fn() } };
}

describe("challengeTitle", () => {
  it.each([
    ["otp", "Check your email"],
    ["two_factor_sms", "Enter SMS code"],
    ["two_factor_app", "Enter authenticator code"],
    ["mobile_app_approval", "Approve in LinkedIn app"],
  ] as [ChallengeType, string][])("%s → %s", (type, expected) => {
    expect(challengeTitle(type)).toBe(expected);
  });
});

describe("challengeDescription", () => {
  it("otp and two_factor_sms drop the dashboard's UI-deictic 'Enter it below.' clause", () => {
    expect(challengeDescription("otp")).not.toContain("Enter it below");
    expect(challengeDescription("two_factor_sms")).not.toContain("Enter it below");
    expect(challengeDescription("otp")).toContain("one-time code");
    expect(challengeDescription("two_factor_sms")).toContain("verification code");
  });

  it("two_factor_app describes the authenticator app", () => {
    expect(challengeDescription("two_factor_app")).toContain("authenticator app");
  });

  it("mobile_app_approval supplies a CLI-local body (the dashboard has no case for it)", () => {
    expect(challengeDescription("mobile_app_approval")).toContain("approve this sign-in");
  });
});

describe("printChallengeCopy", () => {
  it("writes the title then the description to stderr, never stdout", () => {
    const out = makeOut();
    printChallengeCopy("otp", out);
    const written = out.stderr.write.mock.calls.map((c) => c[0] as string).join("");
    expect(written).toContain("Check your email");
    expect(written).toContain("one-time code");
  });
});

describe("printResendHintIfApplicable", () => {
  it.each(["otp", "two_factor_sms", "mobile_app_approval"] as ChallengeType[])(
    "prints a hint referencing the account id for resendable type %s",
    (type) => {
      const out = makeOut();
      printResendHintIfApplicable(type, "acc_pending_9", out);
      const written = out.stderr.write.mock.calls.map((c) => c[0] as string).join("");
      expect(written).toContain("checkpoint resend --checkpoint acc_pending_9");
    },
  );

  it("prints nothing for two_factor_app (a TOTP code has nothing to resend)", () => {
    const out = makeOut();
    printResendHintIfApplicable("two_factor_app", "acc_pending_9", out);
    expect(out.stderr.write).not.toHaveBeenCalled();
  });
});
