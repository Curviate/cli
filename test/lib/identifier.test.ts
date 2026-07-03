import { describe, it, expect } from "vitest";
import { resolveIdentifier, resolveJobIdentifier } from "../../src/lib/identifier.js";

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

  // Locale/country subdomain member URLs → slug
  it("locale subdomain member URL → slug", () => {
    expect(
      resolveIdentifier("https://de.linkedin.com/in/jane-doe-123"),
    ).toBe("jane-doe-123");
    expect(
      resolveIdentifier("https://fr.linkedin.com/in/jane-doe-123/"),
    ).toBe("jane-doe-123");
    expect(
      resolveIdentifier("https://uk.linkedin.com/in/jane-doe-123"),
    ).toBe("jane-doe-123");
  });

  // Locale/country subdomain company URLs → slug
  it("locale subdomain company URL → slug", () => {
    expect(
      resolveIdentifier("https://uk.linkedin.com/company/acme-co"),
    ).toBe("acme-co");
    expect(
      resolveIdentifier("https://de.linkedin.com/company/acme-co/"),
    ).toBe("acme-co");
  });

  // Non-linkedin host must NOT be treated as a LinkedIn URL
  it("non-linkedin host passes through unchanged", () => {
    expect(
      resolveIdentifier("https://de.notlinkedin.com/in/jane-doe-123"),
    ).toBe("https://de.notlinkedin.com/in/jane-doe-123");
    expect(
      resolveIdentifier("https://evillinkedin.com/in/jane-doe-123"),
    ).toBe("https://evillinkedin.com/in/jane-doe-123");
  });
});

describe("lib/identifier — resolveJobIdentifier", () => {
  it("LinkedIn job URL → numeric id", () => {
    expect(
      resolveJobIdentifier("https://www.linkedin.com/jobs/view/4428113858"),
    ).toBe("4428113858");
  });

  it("job URL with trailing slash → numeric id", () => {
    expect(
      resolveJobIdentifier("https://www.linkedin.com/jobs/view/4428113858/"),
    ).toBe("4428113858");
  });

  it("job URL with query string → numeric id", () => {
    expect(
      resolveJobIdentifier(
        "https://www.linkedin.com/jobs/view/4428113858?refId=abc&trk=flagship",
      ),
    ).toBe("4428113858");
  });

  it("bare numeric id passes through unchanged", () => {
    expect(resolveJobIdentifier("4428113858")).toBe("4428113858");
  });

  it("locale-subdomain job URL → numeric id", () => {
    expect(
      resolveJobIdentifier("https://de.linkedin.com/jobs/view/4428113858"),
    ).toBe("4428113858");
  });

  it("unresolvable value passes through unchanged (SDK is the fallback validator)", () => {
    expect(resolveJobIdentifier("not-a-job-identifier")).toBe(
      "not-a-job-identifier",
    );
  });

  it("empty string passes through unchanged", () => {
    expect(resolveJobIdentifier("")).toBe("");
  });
});
