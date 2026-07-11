/**
 * Tests for src/lib/member-id.ts — the slug→provider-id resolution helpers
 * shared by commands whose SDK method 400s/404s on a raw public slug and
 * needs the member's native provider id (or, for resolveMemberOrMeProviderId,
 * also accepts the "me" sentinel directly).
 */

import { describe, it, expect, vi } from "vitest";
import { resolveMemberProviderId, resolveMemberOrMeProviderId, MEMBER_PROVIDER_ID_RE } from "../../src/lib/member-id.js";

function makeNs(getResult?: Record<string, unknown>) {
  return {
    users: {
      get: vi.fn().mockResolvedValue(getResult ?? { object: "user_profile", id: "ACoAA_resolved" }),
    },
  } as unknown as Parameters<typeof resolveMemberProviderId>[0];
}

describe("MEMBER_PROVIDER_ID_RE", () => {
  it("matches ACoAA/ADoAA/AEoAA-shaped provider ids", () => {
    expect(MEMBER_PROVIDER_ID_RE.test("ACoAAAfEwrwBqTunca")).toBe(true);
    expect(MEMBER_PROVIDER_ID_RE.test("ADoAA1234567")).toBe(true);
    expect(MEMBER_PROVIDER_ID_RE.test("AEoAA1234567")).toBe(true);
  });

  it("does not match a public slug or the me sentinel", () => {
    expect(MEMBER_PROVIDER_ID_RE.test("raphael-redmer")).toBe(false);
    expect(MEMBER_PROVIDER_ID_RE.test("me")).toBe(false);
  });
});

describe("resolveMemberProviderId — follow/unfollow (no me passthrough)", () => {
  it("a provider-id-shaped input passes through with zero SDK calls", async () => {
    const ns = makeNs();
    const result = await resolveMemberProviderId(ns, "ACoAAA_x");
    expect(result).toBe("ACoAAA_x");
    expect(ns.users.get).not.toHaveBeenCalled();
  });

  it("a slug resolves via a single users.get READ", async () => {
    const ns = makeNs({ object: "user_profile", id: "ACoAA_resolved" });
    const result = await resolveMemberProviderId(ns, "raphael-redmer");
    expect(result).toBe("ACoAA_resolved");
    expect(ns.users.get).toHaveBeenCalledWith("raphael-redmer", {});
  });

  it("a full member URL is normalized to its slug before resolving", async () => {
    const ns = makeNs({ object: "user_profile", id: "ACoAA_resolved" });
    await resolveMemberProviderId(ns, "https://www.linkedin.com/in/raphael-redmer/");
    expect(ns.users.get).toHaveBeenCalledWith("raphael-redmer", {});
  });

  it("the 'me' sentinel is NOT special-cased — it is resolved via users.get like any other slug", async () => {
    const ns = makeNs({ object: "user_profile", id: "ACoAA_self" });
    const result = await resolveMemberProviderId(ns, "me");
    expect(result).toBe("ACoAA_self");
    expect(ns.users.get).toHaveBeenCalledWith("me", {});
  });

  it("propagates users.get's CurviateError unchanged (e.g. 404 for an unresolvable slug)", async () => {
    const ns = makeNs();
    const err = new Error("not found");
    (ns.users.get as ReturnType<typeof vi.fn>).mockRejectedValue(err);
    await expect(resolveMemberProviderId(ns, "no-such-member")).rejects.toBe(err);
  });
});

describe("resolveMemberOrMeProviderId — post user-posts / post user-reactions / comment user / profile --sections (D7)", () => {
  it("a provider-id-shaped input passes through with zero SDK calls", async () => {
    const ns = makeNs();
    const result = await resolveMemberOrMeProviderId(ns, "ACoAAA_x");
    expect(result).toBe("ACoAAA_x");
    expect(ns.users.get).not.toHaveBeenCalled();
  });

  it("the 'me' sentinel passes through with zero SDK calls — these endpoints accept it directly", async () => {
    const ns = makeNs();
    const result = await resolveMemberOrMeProviderId(ns, "me");
    expect(result).toBe("me");
    expect(ns.users.get).not.toHaveBeenCalled();
  });

  it("a slug resolves via a single users.get READ (D7 — the endpoint 400s on a raw slug)", async () => {
    const ns = makeNs({ object: "user_profile", id: "ACoAA_resolved" });
    const result = await resolveMemberOrMeProviderId(ns, "raphael-redmer");
    expect(result).toBe("ACoAA_resolved");
    expect(ns.users.get).toHaveBeenCalledWith("raphael-redmer", {});
  });

  it("a full member URL is normalized to its slug, then resolved via users.get", async () => {
    const ns = makeNs({ object: "user_profile", id: "ACoAA_resolved" });
    const result = await resolveMemberOrMeProviderId(ns, "https://www.linkedin.com/in/raphael-redmer/");
    expect(result).toBe("ACoAA_resolved");
    expect(ns.users.get).toHaveBeenCalledWith("raphael-redmer", {});
  });

  it("propagates users.get's CurviateError unchanged (e.g. 404 for an unresolvable slug)", async () => {
    const ns = makeNs();
    const err = new Error("not found");
    (ns.users.get as ReturnType<typeof vi.fn>).mockRejectedValue(err);
    await expect(resolveMemberOrMeProviderId(ns, "no-such-member")).rejects.toBe(err);
  });
});
