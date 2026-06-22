import { describe, it, expect } from "vitest";
import { resolveIdentifier } from "../../src/lib/identifier.js";

describe("lib/identifier — resolveIdentifier", () => {
  // Member URLs → slug
  it("LinkedIn member URL → slug", () => {
    expect(resolveIdentifier("https://www.linkedin.com/in/john-doe/")).toBe(
      "john-doe",
    );
    expect(resolveIdentifier("https://www.linkedin.com/in/jane-smith")).toBe(
      "jane-smith",
    );
    expect(
      resolveIdentifier("https://www.linkedin.com/in/john-doe?extra=1#top"),
    ).toBe("john-doe");
  });

  // Company URLs → slug
  it("LinkedIn company URL → slug", () => {
    expect(
      resolveIdentifier("https://www.linkedin.com/company/acme-corp/"),
    ).toBe("acme-corp");
    expect(
      resolveIdentifier("https://www.linkedin.com/company/acme-corp"),
    ).toBe("acme-corp");
    expect(
      resolveIdentifier(
        "https://www.linkedin.com/company/acme-corp?trk=sometrk",
      ),
    ).toBe("acme-corp");
  });

  // Bare path forms → slug
  it("bare /in/<slug> path → slug", () => {
    expect(resolveIdentifier("/in/john-doe")).toBe("john-doe");
    expect(resolveIdentifier("/in/jane-smith/")).toBe("jane-smith");
  });

  it("bare /company/<slug> path → slug", () => {
    expect(resolveIdentifier("/company/acme-corp")).toBe("acme-corp");
    expect(resolveIdentifier("/company/acme-corp/")).toBe("acme-corp");
  });

  // Bare slug → unchanged
  it("bare slug passthrough", () => {
    expect(resolveIdentifier("john-doe")).toBe("john-doe");
    expect(resolveIdentifier("acme-corp")).toBe("acme-corp");
    expect(resolveIdentifier("someuser123")).toBe("someuser123");
  });

  // Native ids / URNs → unchanged (never fabricate)
  it("numeric/native id passthrough unchanged", () => {
    expect(resolveIdentifier("123456789")).toBe("123456789");
    expect(resolveIdentifier("ACoAABcDeFg")).toBe("ACoAABcDeFg");
  });

  it("URN passthrough unchanged", () => {
    const urn = "urn:li:person:ABC123";
    expect(resolveIdentifier(urn)).toBe(urn);
    const memberUrn = "urn:li:member:987654321";
    expect(resolveIdentifier(memberUrn)).toBe(memberUrn);
  });

  // Ambiguous → passthrough
  it("ambiguous input passthrough", () => {
    // Something that looks like a random string — not a URL, not a path, not a slug
    expect(resolveIdentifier("not-a-real-url/but/has/slashes")).toBe(
      "not-a-real-url/but/has/slashes",
    );
  });

  // Edge cases
  it("strips trailing slash from member URL", () => {
    expect(
      resolveIdentifier("https://www.linkedin.com/in/slug-here/"),
    ).toBe("slug-here");
  });

  it("handles linkedin.com without www", () => {
    expect(resolveIdentifier("https://linkedin.com/in/no-www")).toBe("no-www");
  });
});
