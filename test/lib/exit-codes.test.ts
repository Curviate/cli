import { describe, it, expect } from "vitest";
import type { ErrorCode } from "@curviate/sdk";
import { EXIT_CODE_MAP, getExitCode } from "../../src/lib/exit-codes.js";

// The complete set of ErrorCode values — copied from the SDK's type definition.
// This list must exactly match the SDK's ErrorCode union. If the SDK adds a
// new code and this list is not updated, the exhaustiveness test below fails.
const ALL_ERROR_CODES: ErrorCode[] = [
  "UNAUTHORIZED",
  "INVALID_REQUEST",
  "UNSUPPORTED_MEDIA_TYPE",
  "PAYLOAD_TOO_LARGE",
  "ACCOUNT_NOT_FOUND",
  "ACCOUNT_RESTRICTED",
  "RESOURCE_NOT_FOUND",
  "TIER_NOT_ACTIVE",
  "LINKEDIN_FEATURE_NOT_SUBSCRIBED",
  "RATE_LIMIT_ACCOUNT",
  "RATE_LIMIT_TENANT",
  "PLATFORM_RATE_LIMIT",
  "PLATFORM_ERROR",
  "PLATFORM_NOT_IMPLEMENTED",
  "CHECKPOINT_NOT_FOUND",
  "CHECKPOINT_EXPIRED",
  "CHECKPOINT_INVALID_CODE",
  "CHECKPOINT_MAX_ATTEMPTS",
  "CHECKPOINT_ALREADY_RESOLVED",
  "CHECKPOINT_UNSUPPORTED",
  "CONNECTION_IN_PROGRESS",
  "LINKEDIN_AUTH_FAILED",
  "LINKEDIN_RATE_LIMITED",
  "LINKEDIN_COOKIE_INVALID",
  "LINKEDIN_SERVICE_UNAVAILABLE",
  "MESSAGE_WINDOW_EXPIRED",
  "RECIPIENT_UNREACHABLE",
  "PAYMENT_REQUIRED",
  "PAYMENT_FAILED",
  "SUBSCRIPTION_BUSY",
  "SUBSCRIPTION_NOT_FOUND",
  "SEAT_NOT_FOUND",
  "SEAT_CANCELLED",
  "INTERNAL",
];

describe("lib/exit-codes — exhaustiveness", () => {
  it("every ErrorCode maps to a number in EXIT_CODE_MAP", () => {
    for (const code of ALL_ERROR_CODES) {
      expect(
        typeof EXIT_CODE_MAP[code],
        `ErrorCode "${code}" is missing from EXIT_CODE_MAP`,
      ).toBe("number");
    }
  });

  it("negative guard: an unmapped code is detected", () => {
    // Simulate a future SDK code that was not added to the table.
    const fakeCode = "__UNMAPPED__" as ErrorCode;
    expect(EXIT_CODE_MAP[fakeCode]).toBeUndefined();
  });

  it("all mapped values are valid exit codes (integers 1–11)", () => {
    for (const code of ALL_ERROR_CODES) {
      const exitCode = EXIT_CODE_MAP[code];
      expect(exitCode).toBeGreaterThanOrEqual(1);
      expect(exitCode).toBeLessThanOrEqual(11);
      expect(Number.isInteger(exitCode)).toBe(true);
    }
  });
});

describe("lib/exit-codes — spot checks (per spec)", () => {
  it.each([
    ["UNAUTHORIZED", 3],
    ["RESOURCE_NOT_FOUND", 4],
    ["ACCOUNT_NOT_FOUND", 4],
    ["TIER_NOT_ACTIVE", 5],
    ["LINKEDIN_FEATURE_NOT_SUBSCRIBED", 5],
    ["RATE_LIMIT_ACCOUNT", 6],
    ["LINKEDIN_RATE_LIMITED", 6],
    ["PLATFORM_ERROR", 7],
    ["PLATFORM_NOT_IMPLEMENTED", 1],
    ["ACCOUNT_RESTRICTED", 8],
    ["CHECKPOINT_EXPIRED", 9],
    ["MESSAGE_WINDOW_EXPIRED", 10],
    ["RECIPIENT_UNREACHABLE", 10],
    ["PAYMENT_FAILED", 11],
    ["SUBSCRIPTION_BUSY", 11],
    ["INTERNAL", 1],
  ] as [ErrorCode, number][])(
    "ErrorCode %s → exit %i",
    (code, expectedExit) => {
      expect(EXIT_CODE_MAP[code]).toBe(expectedExit);
    },
  );
});

describe("lib/exit-codes — getExitCode", () => {
  it("returns mapped exit code for a CurviateError code", () => {
    expect(getExitCode("UNAUTHORIZED")).toBe(3);
    expect(getExitCode("TIER_NOT_ACTIVE")).toBe(5);
  });

  it("returns 1 for an unmapped/unknown code", () => {
    expect(getExitCode("__UNKNOWN__" as ErrorCode)).toBe(1);
  });
});
