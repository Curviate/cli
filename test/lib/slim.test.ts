/**
 * Tests for slim projection functions in src/lib/slim.ts.
 *
 * Each slim function extracts a stable subset of the full SDK response to
 * keep default CLI output compact without losing the fields agents need.
 */

import { describe, it, expect } from "vitest";
import {
  synthesizeCurrentPosition,
  synthesizeHeadquarters,
  slimProfileMe,
  slimProfile,
  slimCompany,
} from "../../src/lib/slim.js";

// ---------------------------------------------------------------------------
// synthesizeCurrentPosition
// ---------------------------------------------------------------------------

describe("synthesizeCurrentPosition", () => {
  it("maps position→title, company→company_name, company_id always null, end null → is_current true", () => {
    const result = synthesizeCurrentPosition([
      { id: "exp1", position: "Founder", company: "RedHire", end: null, start: { month: 3, year: 2023 } },
    ]);
    expect(result).toEqual({
      title: "Founder",
      company_name: "RedHire",
      company_id: null,
      is_current: true,
    });
  });

  it("end non-null → is_current false", () => {
    const result = synthesizeCurrentPosition([
      { id: "exp2", position: "Engineer", company: "Acme", end: { year: 2024, month: 6 } },
    ]);
    expect(result).not.toBeNull();
    expect(result!.is_current).toBe(false);
  });

  it("company_id is ALWAYS null — even when entry has an id field", () => {
    const result = synthesizeCurrentPosition([
      { id: "exp3", position: "CTO", company: "TechCo", end: null },
    ]);
    expect(result).not.toBeNull();
    // id from entry must NOT leak into company_id
    expect(result!.company_id).toBeNull();
  });

  it("empty array → null", () => {
    expect(synthesizeCurrentPosition([])).toBeNull();
  });

  it("non-array input → null", () => {
    expect(synthesizeCurrentPosition(null as unknown as unknown[])).toBeNull();
  });

  it("absent position field → title null", () => {
    const result = synthesizeCurrentPosition([{ company: "Acme", end: null }]);
    expect(result!.title).toBeNull();
  });

  it("absent company field → company_name null", () => {
    const result = synthesizeCurrentPosition([{ position: "Dev", end: null }]);
    expect(result!.company_name).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// synthesizeHeadquarters
// ---------------------------------------------------------------------------

describe("synthesizeHeadquarters", () => {
  it("finds is_headquarter:true entry and extracts city/country/area", () => {
    const result = synthesizeHeadquarters([
      { city: "Berlin", country: "DE", area: "Berlin", is_headquarter: false },
      { city: "Munich", country: "DE", area: "Bavaria", is_headquarter: true, zip: "80333" },
    ]);
    expect(result).toEqual({ city: "Munich", country: "DE", area: "Bavaria" });
  });

  it("no is_headquarter:true entry → null", () => {
    const result = synthesizeHeadquarters([
      { city: "Paris", country: "FR", area: "IDF", is_headquarter: false },
    ]);
    expect(result).toBeNull();
  });

  it("empty array → null", () => {
    expect(synthesizeHeadquarters([])).toBeNull();
  });

  it("area absent in hq → area null", () => {
    const result = synthesizeHeadquarters([
      { city: "Austin", country: "US", is_headquarter: true },
    ]);
    expect(result!.area).toBeNull();
  });

  it("does not leak extra keys (zip, etc.) into output", () => {
    const result = synthesizeHeadquarters([
      { city: "Austin", country: "US", area: "TX", is_headquarter: true, zip: "78701" },
    ]);
    expect(result).not.toHaveProperty("zip");
    expect(result).not.toHaveProperty("is_headquarter");
  });
});

// ---------------------------------------------------------------------------
// slimProfileMe
// ---------------------------------------------------------------------------

describe("slimProfileMe", () => {
  const fullProfile = {
    provider_id: "prov_123",
    first_name: "John",
    last_name: "Doe",
    public_identifier: "johndoe",
    location: "Berlin, Germany",
    email: "john@example.com",
    occupation: "Engineer",
    is_premium: true,
    organizations: [
      {
        id: "org_1",
        mailbox_id: "mb_1",
        name: "Acme Corp",
        logo_url: "https://logo.example.com",
        extra_field: "hidden",
      },
    ],
    entity_urn: "urn:li:member:123",
    object_urn: "urn:li:fs_profile:ACoAAA",
    work_experience: [{ position: "Engineer", company: "Acme", end: null }],
    education: [{ school: "MIT" }],
    viewer_permissions: { can_send_inmail: true },
    throttled_sections: ["experience"],
    profile_picture_url: "https://example.com/photo.jpg",
    is_open_profile: false,
  };

  it("projects exactly the 10 slim fields", () => {
    const result = slimProfileMe(fullProfile);
    expect(Object.keys(result)).toHaveLength(10);
    expect(Object.keys(result).sort()).toEqual(
      [
        "email",
        "first_name",
        "is_premium",
        "last_name",
        "location",
        "occupation",
        "organizations",
        "provider_id",
        "public_identifier",
        "current_position",
      ].sort(),
    );
  });

  it("current_position synthesized from work_experience[0] (parity with profile <id>)", () => {
    const result = slimProfileMe(fullProfile);
    expect(result["current_position"]).toEqual({
      title: "Engineer",
      company_name: "Acme",
      company_id: null,
      is_current: true,
    });
  });

  it("current_position is null when work_experience absent (no --sections enrichment)", () => {
    const noWE = Object.fromEntries(
      Object.entries(fullProfile).filter(([k]) => k !== "work_experience"),
    );
    expect(slimProfileMe(noWE)["current_position"]).toBeNull();
  });

  it("excludes heavy fields (entity_urn, object_urn, work_experience, education, is_open_profile, etc.)", () => {
    const result = slimProfileMe(fullProfile);
    expect(result).not.toHaveProperty("entity_urn");
    expect(result).not.toHaveProperty("object_urn");
    expect(result).not.toHaveProperty("work_experience");
    expect(result).not.toHaveProperty("education");
    expect(result).not.toHaveProperty("viewer_permissions");
    expect(result).not.toHaveProperty("throttled_sections");
    expect(result).not.toHaveProperty("profile_picture_url");
    expect(result).not.toHaveProperty("is_open_profile");
  });

  it("organizations maps only id/mailbox_id/name sub-fields", () => {
    const result = slimProfileMe(fullProfile);
    const orgs = result["organizations"] as Array<Record<string, unknown>>;
    expect(orgs).toHaveLength(1);
    const org = orgs[0]!;
    expect(Object.keys(org).sort()).toEqual(["id", "mailbox_id", "name"].sort());
    expect(org["id"]).toBe("org_1");
    expect(org["mailbox_id"]).toBe("mb_1");
    expect(org["name"]).toBe("Acme Corp");
    expect(org["logo_url"]).toBeUndefined();
    expect(org["extra_field"]).toBeUndefined();
  });

  it("returns empty organizations array when missing", () => {
    const profileWithoutOrgs = Object.fromEntries(
      Object.entries(fullProfile).filter(([k]) => k !== "organizations"),
    );
    const result = slimProfileMe(profileWithoutOrgs);
    expect(result["organizations"]).toEqual([]);
  });

  it("location/email/occupation null when absent", () => {
    const sparse = Object.fromEntries(
      Object.entries(fullProfile).filter(([k]) => !["location", "email", "occupation"].includes(k)),
    );
    const result = slimProfileMe(sparse);
    expect(result["location"]).toBeNull();
    expect(result["email"]).toBeNull();
    expect(result["occupation"]).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// slimProfile (profile <id>)
// ---------------------------------------------------------------------------

describe("slimProfile", () => {
  // Real substrate work_experience shape: {id, company, position, location, status,
  // company_picture_url, skills, start, end}
  const fullProfile = {
    provider_id: "prov_456",
    first_name: "Jane",
    last_name: "Smith",
    headline: "Senior Engineer",
    location: "London, UK",
    occupation: "Engineer",
    network_distance: "DISTANCE_1",
    public_identifier: "janesmith",
    work_experience: [
      {
        id: "exp_1",
        position: "Senior Engineer",
        company: "TechCorp",
        location: "London",
        status: null,
        company_picture_url: null,
        skills: [],
        start: { month: 1, year: 2020 },
        end: null,
      },
    ],
    education: [{ school: "Oxford" }],
    viewer_permissions: { can_send_inmail: false },
    throttled_sections: ["experience"],
  };

  it("projects exactly the 9 slim fields", () => {
    const result = slimProfile(fullProfile);
    expect(Object.keys(result)).toHaveLength(9);
    expect(Object.keys(result).sort()).toEqual(
      [
        "current_position",
        "first_name",
        "headline",
        "last_name",
        "location",
        "network_distance",
        "occupation",
        "provider_id",
        "public_identifier",
      ].sort(),
    );
  });

  it("current_position synthesized from work_experience[0] with correct field mapping", () => {
    const result = slimProfile(fullProfile);
    expect(result["current_position"]).toEqual({
      title: "Senior Engineer",     // ← from position
      company_name: "TechCorp",     // ← from company
      company_id: null,             // ALWAYS null
      is_current: true,             // ← end == null
    });
  });

  it("company_id is ALWAYS null even when entry has an id field", () => {
    const result = slimProfile(fullProfile);
    const pos = result["current_position"] as Record<string, unknown>;
    // entry.id is "exp_1" — must NOT appear as company_id
    expect(pos["company_id"]).toBeNull();
  });

  it("is_current false when end is non-null", () => {
    const result = slimProfile({
      ...fullProfile,
      work_experience: [
        { id: "exp_2", position: "Intern", company: "OldCo", end: { year: 2019, month: 6 } },
      ],
    });
    const pos = result["current_position"] as Record<string, unknown>;
    expect(pos["is_current"]).toBe(false);
  });

  it("current_position is null when work_experience is empty", () => {
    const result = slimProfile({ ...fullProfile, work_experience: [] });
    expect(result["current_position"]).toBeNull();
  });

  it("current_position is null when work_experience is absent", () => {
    const withoutWE = Object.fromEntries(
      Object.entries(fullProfile).filter(([k]) => k !== "work_experience"),
    );
    const result = slimProfile(withoutWE);
    expect(result["current_position"]).toBeNull();
  });

  it("excludes work_experience, education, viewer_permissions, throttled_sections", () => {
    const result = slimProfile(fullProfile);
    expect(result).not.toHaveProperty("work_experience");
    expect(result).not.toHaveProperty("education");
    expect(result).not.toHaveProperty("viewer_permissions");
    expect(result).not.toHaveProperty("throttled_sections");
  });
});

// ---------------------------------------------------------------------------
// slimCompany
// ---------------------------------------------------------------------------

describe("slimCompany", () => {
  const fullCompany = {
    id: "co_123",
    name: "Acme Corp",
    public_identifier: "acme-corp",
    profile_url: "https://linkedin.com/company/acme-corp",
    industry: "Technology",
    employee_count: 500,
    employee_count_range: { min: 201, max: 500, to: null },
    website: "https://acme.com",
    foundation_date: "2000-01-01",
    messaging: { is_enabled: true, thread_id: "thread_1", extra: "hidden" },
    locations: [
      { city: "Austin", country: "US", area: "TX", is_headquarter: true, zip: "78701" },
      { city: "New York", country: "US", area: "NY", is_headquarter: false },
    ],
    followers_count: 12000,
    viewer_permissions: { can_send_message: false },
    description: "A company description",
    activities: [{ id: "act_1" }],
  };

  it("projects exactly the 12 slim fields", () => {
    const result = slimCompany(fullCompany);
    expect(Object.keys(result)).toHaveLength(12);
    expect(Object.keys(result).sort()).toEqual(
      [
        "employee_count",
        "employee_count_range",
        "followers_count",
        "foundation_date",
        "headquarters",
        "id",
        "industry",
        "messaging",
        "name",
        "profile_url",
        "public_identifier",
        "website",
      ].sort(),
    );
  });

  it("messaging projected to {is_enabled} only (not full object)", () => {
    const result = slimCompany(fullCompany);
    expect(result["messaging"]).toEqual({ is_enabled: true });
    const msg = result["messaging"] as Record<string, unknown>;
    expect(msg["thread_id"]).toBeUndefined();
    expect(msg["extra"]).toBeUndefined();
  });

  it("headquarters synthesized from is_headquarter location", () => {
    const result = slimCompany(fullCompany);
    expect(result["headquarters"]).toEqual({ city: "Austin", country: "US", area: "TX" });
  });

  it("headquarters is null when no is_headquarter location", () => {
    const result = slimCompany({
      ...fullCompany,
      locations: [
        { city: "Paris", country: "FR", area: "IDF", is_headquarter: false },
      ],
    });
    expect(result["headquarters"]).toBeNull();
  });

  it("area is null when absent in hq location", () => {
    const result = slimCompany({
      ...fullCompany,
      locations: [{ city: "Berlin", country: "DE", is_headquarter: true }],
    });
    const hq = result["headquarters"] as Record<string, unknown>;
    expect(hq["area"]).toBeNull();
  });

  it("employee_count_range preserves nullable to", () => {
    const result = slimCompany(fullCompany);
    const ecr = result["employee_count_range"] as Record<string, unknown>;
    expect(ecr["to"]).toBeNull();
    expect(ecr["min"]).toBe(201);
    expect(ecr["max"]).toBe(500);
  });

  it("excludes viewer_permissions, description, activities, locations raw array", () => {
    const result = slimCompany(fullCompany);
    expect(result).not.toHaveProperty("viewer_permissions");
    expect(result).not.toHaveProperty("description");
    expect(result).not.toHaveProperty("activities");
    expect(result).not.toHaveProperty("locations");
  });
});
