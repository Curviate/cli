/**
 * Tests for src/lib/sections.ts — `--sections` value normalization.
 *
 * D9: the server's linkedin_sections vocabulary requires the `linkedin_`
 * prefix (`linkedin_skills`, not `skills`); the pre-fix CLI forwarded bare
 * values verbatim and 400'd. parseSectionsFlag auto-prefixes a bare value
 * and validates the result against the served vocabulary — an unknown
 * section is a usage error, not a raw 400 from the server.
 */

import { describe, it, expect } from "vitest";
import { parseSectionsFlag, VALID_LINKEDIN_SECTIONS, CANONICAL_SECTION_VALUES } from "../../src/lib/sections.js";

describe("parseSectionsFlag — auto-prefixing", () => {
  it("prefixes a single bare value with linkedin_", () => {
    const result = parseSectionsFlag("skills");
    expect(result).toEqual({ ok: true, sections: ["linkedin_skills"] });
  });

  it("prefixes every value in a comma list", () => {
    const result = parseSectionsFlag("experience,education");
    expect(result).toEqual({ ok: true, sections: ["linkedin_experience", "linkedin_education"] });
  });

  it("trims whitespace around each value before prefixing", () => {
    const result = parseSectionsFlag(" skills , experience ");
    expect(result).toEqual({ ok: true, sections: ["linkedin_skills", "linkedin_experience"] });
  });

  it("drops empty entries from a trailing/double comma", () => {
    const result = parseSectionsFlag("skills,,experience,");
    expect(result).toEqual({ ok: true, sections: ["linkedin_skills", "linkedin_experience"] });
  });

  it("the bare wildcard '*' prefixes to linkedin_*", () => {
    const result = parseSectionsFlag("*");
    expect(result).toEqual({ ok: true, sections: ["linkedin_*"] });
  });

  it("an already-prefixed value passes through unchanged (no double-prefix)", () => {
    const result = parseSectionsFlag("linkedin_skills");
    expect(result).toEqual({ ok: true, sections: ["linkedin_skills"] });
  });

  it("an already-prefixed wildcard passes through unchanged", () => {
    const result = parseSectionsFlag("linkedin_*");
    expect(result).toEqual({ ok: true, sections: ["linkedin_*"] });
  });

  it("a mix of bare and already-prefixed values normalizes both", () => {
    const result = parseSectionsFlag("skills,linkedin_education");
    expect(result).toEqual({ ok: true, sections: ["linkedin_skills", "linkedin_education"] });
  });

  it("accepts every documented base section name", () => {
    const bases = [
      "experience",
      "education",
      "languages",
      "skills",
      "certifications",
      "volunteer_experience",
      "projects",
      "recommendations",
      "interests",
    ];
    for (const base of bases) {
      const result = parseSectionsFlag(base);
      expect(result, base).toEqual({ ok: true, sections: [`linkedin_${base}`] });
    }
  });

  it("accepts the _preview variant of a bare value", () => {
    const result = parseSectionsFlag("skills_preview");
    expect(result).toEqual({ ok: true, sections: ["linkedin_skills_preview"] });
  });

  it("accepts the _preview variant of an already-prefixed value", () => {
    const result = parseSectionsFlag("linkedin_experience_preview");
    expect(result).toEqual({ ok: true, sections: ["linkedin_experience_preview"] });
  });
});

describe("parseSectionsFlag — misuse (unknown section)", () => {
  it("an unknown bare value fails with an actionable error naming the bad value", () => {
    const result = parseSectionsFlag("bogus-section");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("bogus-section");
      expect(result.error).toContain("--sections");
    }
  });

  it("an unknown already-prefixed value (typo) fails, not silently forwarded", () => {
    const result = parseSectionsFlag("linkedin_experiance");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("linkedin_experiance");
  });

  it("the error message lists at least one valid canonical value as a hint", () => {
    const result = parseSectionsFlag("nonsense");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("linkedin_skills");
  });

  it("one bad value among several valid ones still fails (all-or-nothing)", () => {
    const result = parseSectionsFlag("skills,bogus,education");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("bogus");
  });
});

describe("VALID_LINKEDIN_SECTIONS / CANONICAL_SECTION_VALUES", () => {
  it("VALID_LINKEDIN_SECTIONS contains the wildcard and every base + _preview pair", () => {
    expect(VALID_LINKEDIN_SECTIONS.has("linkedin_*")).toBe(true);
    expect(VALID_LINKEDIN_SECTIONS.has("linkedin_skills")).toBe(true);
    expect(VALID_LINKEDIN_SECTIONS.has("linkedin_skills_preview")).toBe(true);
    expect(VALID_LINKEDIN_SECTIONS.has("linkedin_bogus")).toBe(false);
  });

  it("CANONICAL_SECTION_VALUES is a non-empty list of linkedin_-prefixed names for help/error text", () => {
    expect(CANONICAL_SECTION_VALUES.length).toBeGreaterThan(0);
    for (const v of CANONICAL_SECTION_VALUES) {
      expect(v === "linkedin_*" || v.startsWith("linkedin_")).toBe(true);
    }
    expect(CANONICAL_SECTION_VALUES).toContain("linkedin_skills");
  });
});
