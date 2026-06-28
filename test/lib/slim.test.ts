/**
 * Tests for slim projection functions in src/lib/slim.ts.
 *
 * Each slim function extracts a stable subset of the full SDK response to
 * keep default CLI output compact without losing the fields agents need.
 */

import { describe, it, expect } from "vitest";
import { slimProfileMe, slimProfileGet, slimCompany } from "../../src/lib/slim.js";

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
    work_experience: [{ title: "Engineer", company_name: "Acme" }],
    education: [{ school: "MIT" }],
    viewer_permissions: { can_send_inmail: true },
    throttled_sections: ["experience"],
  };

  it("projects exactly the 9 slim fields", () => {
    const result = slimProfileMe(fullProfile);
    expect(Object.keys(result)).toHaveLength(9);
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
      ].sort(),
    );
  });

  it("excludes heavy fields (entity_urn, work_experience, education, etc.)", () => {
    const result = slimProfileMe(fullProfile);
    expect(result).not.toHaveProperty("entity_urn");
    expect(result).not.toHaveProperty("work_experience");
    expect(result).not.toHaveProperty("education");
    expect(result).not.toHaveProperty("viewer_permissions");
    expect(result).not.toHaveProperty("throttled_sections");
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
// slimProfileGet
// ---------------------------------------------------------------------------

describe("slimProfileGet", () => {
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
        title: "Senior Engineer",
        company_name: "TechCorp",
        company_id: "co_1",
        is_current: true,
        start_date: "2020-01",
        extra: "hidden",
      },
    ],
    education: [{ school: "Oxford" }],
    viewer_permissions: { can_send_inmail: false },
    throttled_sections: ["experience"],
  };

  it("projects exactly the 9 slim fields", () => {
    const result = slimProfileGet(fullProfile);
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

  it("current_position synthesized from work_experience[0] — all 4 sub-fields", () => {
    const result = slimProfileGet(fullProfile);
    expect(result["current_position"]).toEqual({
      title: "Senior Engineer",
      company_name: "TechCorp",
      company_id: "co_1",
      is_current: true,
    });
  });

  it("current_position is null when work_experience is empty", () => {
    const result = slimProfileGet({ ...fullProfile, work_experience: [] });
    expect(result["current_position"]).toBeNull();
  });

  it("current_position is null when work_experience is absent", () => {
    const withoutWE = Object.fromEntries(
      Object.entries(fullProfile).filter(([k]) => k !== "work_experience"),
    );
    const result = slimProfileGet(withoutWE);
    expect(result["current_position"]).toBeNull();
  });

  it("company_id is null when absent in work_experience entry", () => {
    const result = slimProfileGet({
      ...fullProfile,
      work_experience: [{ title: "Freelance", company_name: "Self", is_current: true }],
    });
    const pos = result["current_position"] as Record<string, unknown>;
    expect(pos["company_id"]).toBeNull();
  });

  it("excludes work_experience, education, viewer_permissions, throttled_sections", () => {
    const result = slimProfileGet(fullProfile);
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
