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
  slimJob,
  slimInviteSentItem,
  slimInviteSent,
  slimInviteReceivedItem,
  slimInviteReceived,
  slimSearchPostsItem,
  slimSearchPosts,
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

// ---------------------------------------------------------------------------
// slimJob (job get / recruiter job get — shared projection)
// ---------------------------------------------------------------------------

describe("slimJob", () => {
  // Core `job_posting` shape (GET /v1/{account_id}/jobs/{job_id}): the real
  // timestamp field is `created_at` — there is no `published_at` at all on
  // this shape. `company` is a nested object; there is no top-level
  // `company_id`. The applicant-count field is `applications_count`.
  const coreJob = {
    object: "job_posting",
    id: "4428113858",
    title: "Founders Associate",
    company: { id: "67756343", name: "LEAGUES", public_identifier: "leagues" },
    state: "LISTED",
    location: "Stuttgart, Baden-Württemberg, Germany",
    is_repost: false,
    is_application_limit_reached: false,
    created_at: "2026-06-12T10:07:09.000Z",
    applications_count: 75,
    description: "Über deine Rolle: build the founding team.",
    workplace_type: "HYBRID",
    employment_status: "FULL_TIME",
    hiring_team: [],
  };

  // Recruiter `recruiter_job_posting` shape (GET .../recruiter/jobs/{job_id}
  // and .../recruiter/projects/{project_id}/jobs/{job_id}): the opposite —
  // `published_at` IS real here (optional) and there is no `created_at` at
  // all. Still a nested `company` (no top-level `company_id`), still
  // `applications_count`.
  const recruiterJob = {
    object: "recruiter_job_posting",
    id: "4428113858",
    project_id: "proj_1",
    title: "Founders Associate",
    company: { id: "67756343", name: "LEAGUES" },
    state: "LISTED",
    location: "Stuttgart, Baden-Württemberg, Germany",
    applications_count: 75,
    published_at: "2026-06-12T10:08:03.000Z",
    description: "Über deine Rolle: build the founding team.",
    hiring_team: [],
  };

  it("returns exactly the 10 documented slim fields", () => {
    const result = slimJob(coreJob);
    expect(Object.keys(result).sort()).toEqual(
      [
        "applications_count",
        "company",
        "company_id",
        "description",
        "id",
        "location",
        "object",
        "published_at",
        "state",
        "title",
      ].sort(),
    );
  });

  it("keeps description non-empty (the point of the fetch)", () => {
    const result = slimJob(coreJob);
    expect(result["description"]).toBe(coreJob.description);
  });

  it("excludes hiring_team (verbose-only)", () => {
    const result = slimJob(coreJob);
    expect(result).not.toHaveProperty("hiring_team");
  });

  it("v1 legacy field (applicants_counter) is absent — the real key on both shapes is applications_count", () => {
    const result = slimJob(coreJob);
    expect(result).not.toHaveProperty("applicants_counter");
  });

  it("Core shape: passes id, title, company (nested, verbatim), location, state, description through; applications_count maps directly", () => {
    const result = slimJob(coreJob);
    expect(result["id"]).toBe("4428113858");
    expect(result["title"]).toBe("Founders Associate");
    expect(result["company"]).toEqual({ id: "67756343", name: "LEAGUES", public_identifier: "leagues" });
    expect(result["location"]).toBe(coreJob.location);
    expect(result["state"]).toBe("LISTED");
    expect(result["applications_count"]).toBe(75);
    expect(result["description"]).toBe(coreJob.description);
  });

  it("Core shape: company_id is synthesized from company.id (no top-level company_id exists on the real wire)", () => {
    const result = slimJob(coreJob);
    expect(result["company_id"]).toBe("67756343");
  });

  it("company_id ignores a stray flat company_id key — company.id is always the source of truth", () => {
    const result = slimJob({ ...coreJob, company_id: "DECOY_SHOULD_BE_IGNORED" });
    expect(result["company_id"]).toBe("67756343");
  });

  it("Core shape: published_at falls back to created_at (the Core wire has no published_at field at all)", () => {
    const result = slimJob(coreJob);
    expect(result["published_at"]).toBe("2026-06-12T10:07:09.000Z");
  });

  it("Recruiter shape: published_at is real and used directly", () => {
    const result = slimJob(recruiterJob);
    expect(result["published_at"]).toBe("2026-06-12T10:08:03.000Z");
  });

  it("Recruiter shape: company_id and applications_count resolve the same way as Core", () => {
    const result = slimJob(recruiterJob);
    expect(result["company_id"]).toBe("67756343");
    expect(result["applications_count"]).toBe(75);
  });

  it("nullable fields project to null when absent", () => {
    const result = slimJob({ object: "job_posting", id: "1" });
    expect(result["location"]).toBeNull();
    expect(result["published_at"]).toBeNull();
    expect(result["applications_count"]).toBeNull();
    expect(result["company_id"]).toBeNull();
    expect(result["company"]).toBeNull();
  });

  it("non-object input projects to an all-null shape (never throws)", () => {
    const result = slimJob(null);
    expect(result["id"]).toBeNull();
    expect(result["object"]).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// slimInviteSentItem / slimInviteSent (v2 shape — GET /v1/{account_id}/invites/sent)
// ---------------------------------------------------------------------------

describe("slimInviteSentItem", () => {
  const fullSentItem = {
    object: "invitation_sent",
    id: "SENT_7419644944484753408",
    created_at: "2026-01-21T10:00:00.000Z",
    message: "Let's connect",
    user: {
      id: "ACoAAAfEwrwBqTunca",
      type: "individual",
      display_name: "Korhan Tunca",
      first_name: "Korhan",
      last_name: "Tunca",
      public_picture_url: "https://media.licdn.com/korhan.jpg",
    },
  };

  it("projects id, created_at, message, and a trimmed user sub-object", () => {
    const result = slimInviteSentItem(fullSentItem);
    expect(result).toEqual({
      id: "SENT_7419644944484753408",
      created_at: "2026-01-21T10:00:00.000Z",
      message: "Let's connect",
      user: {
        id: "ACoAAAfEwrwBqTunca",
        display_name: "Korhan Tunca",
        first_name: "Korhan",
        last_name: "Tunca",
      },
    });
  });

  it("drops user.type and user.public_picture_url (verbose-only) and the per-item object discriminator", () => {
    const result = slimInviteSentItem(fullSentItem);
    const user = result["user"] as Record<string, unknown>;
    expect(user).not.toHaveProperty("type");
    expect(user).not.toHaveProperty("public_picture_url");
    expect(result).not.toHaveProperty("object");
  });

  it("optional top-level fields (created_at, message) project to null when absent — never undefined", () => {
    const result = slimInviteSentItem({
      object: "invitation_sent",
      id: "SENT_x",
      user: { id: "ACoAA1" },
    });
    expect(result["created_at"]).toBeNull();
    expect(result["message"]).toBeNull();
  });

  it("user sub-object projects to null when the source has no user (never crashes)", () => {
    const result = slimInviteSentItem({ object: "invitation_sent", id: "SENT_x" });
    expect(result["user"]).toBeNull();
  });

  it("v1 legacy fields (invited_user_*, inviter, date, parsed_datetime, invitation_text, specifics) are absent — the v2 response never sends them", () => {
    const result = slimInviteSentItem(fullSentItem);
    expect(result).not.toHaveProperty("invited_user");
    expect(result).not.toHaveProperty("invited_user_id");
    expect(result).not.toHaveProperty("invited_user_public_id");
    expect(result).not.toHaveProperty("inviter");
    expect(result).not.toHaveProperty("date");
    expect(result).not.toHaveProperty("parsed_datetime");
    expect(result).not.toHaveProperty("invitation_text");
    expect(result).not.toHaveProperty("specifics");
  });
});

describe("slimInviteSent", () => {
  it("projects the envelope { object, items, cursor } with each item slimmed", () => {
    const result = slimInviteSent({
      object: "invitation_list",
      items: [
        {
          id: "SENT_1",
          created_at: "2026-01-01T00:00:00Z",
          user: { id: "ACoAA1", type: "individual", display_name: "A" },
        },
      ],
      cursor: "next-cursor",
    });
    expect(result["object"]).toBe("invitation_list");
    expect(result["cursor"]).toBe("next-cursor");
    const items = result["items"] as Record<string, unknown>[];
    expect(items).toHaveLength(1);
    expect(items[0]).not.toHaveProperty("type");
  });

  it("non-object / missing items input projects to an empty-list shape (never throws)", () => {
    expect(slimInviteSent(null)).toEqual({ object: null, items: [], cursor: null });
  });
});

// ---------------------------------------------------------------------------
// slimInviteReceivedItem / slimInviteReceived (v2 shape — GET /v1/{account_id}/invites/received)
// ---------------------------------------------------------------------------

describe("slimInviteReceivedItem", () => {
  const fullReceivedItem = {
    object: "invitation_received",
    id: "RECEIVED_9",
    created_at: "2026-07-10T00:00:00.000Z",
    user: {
      id: "ACoAADwav4UBConstantine",
      type: "individual",
      display_name: "Constantine Pinotsis",
      first_name: "Constantine",
      last_name: "Pinotsis",
      public_picture_url: "https://media.licdn.com/constantine.jpg",
      public_identifier: "constantine-pinotsis",
      profile_url: "https://www.linkedin.com/in/constantine-pinotsis",
      description: "Engineer",
    },
  };

  it("projects id, created_at, and a trimmed user sub-object including public_identifier", () => {
    const result = slimInviteReceivedItem(fullReceivedItem);
    expect(result).toEqual({
      id: "RECEIVED_9",
      created_at: "2026-07-10T00:00:00.000Z",
      user: {
        id: "ACoAADwav4UBConstantine",
        display_name: "Constantine Pinotsis",
        first_name: "Constantine",
        last_name: "Pinotsis",
        public_identifier: "constantine-pinotsis",
      },
    });
  });

  it("drops user.type/public_picture_url/profile_url/description (verbose-only) and the per-item object discriminator", () => {
    const result = slimInviteReceivedItem(fullReceivedItem);
    const user = result["user"] as Record<string, unknown>;
    expect(user).not.toHaveProperty("type");
    expect(user).not.toHaveProperty("public_picture_url");
    expect(user).not.toHaveProperty("profile_url");
    expect(user).not.toHaveProperty("description");
    expect(result).not.toHaveProperty("object");
  });

  it("public_identifier — the field that lets an agent safely pick which invite to accept — projects to null when the platform omits it, never undefined", () => {
    const result = slimInviteReceivedItem({
      object: "invitation_received",
      id: "RECEIVED_x",
      user: { id: "ACoAA1" },
    });
    const user = result["user"] as Record<string, unknown>;
    expect(user["public_identifier"]).toBeNull();
  });

  it("v1 legacy fields (invited_user_*, inviter, date, parsed_datetime, invitation_text, specifics.shared_secret) are absent — the v2 response never sends them", () => {
    const result = slimInviteReceivedItem(fullReceivedItem);
    expect(result).not.toHaveProperty("invited_user");
    expect(result).not.toHaveProperty("inviter");
    expect(result).not.toHaveProperty("date");
    expect(result).not.toHaveProperty("parsed_datetime");
    expect(result).not.toHaveProperty("invitation_text");
    expect(result).not.toHaveProperty("specifics");
  });
});

describe("slimInviteReceived", () => {
  it("projects the envelope { object, items, cursor } with each item slimmed", () => {
    const result = slimInviteReceived({
      object: "invitation_list",
      items: [
        {
          id: "RECEIVED_1",
          created_at: "2026-01-01T00:00:00Z",
          user: { id: "ACoAA1", type: "individual", public_identifier: "a" },
        },
      ],
      cursor: null,
    });
    expect(result["object"]).toBe("invitation_list");
    expect(result["cursor"]).toBeNull();
    const items = result["items"] as Record<string, unknown>[];
    expect(items).toHaveLength(1);
    expect(items[0]).not.toHaveProperty("type");
  });

  it("non-object / missing items input projects to an empty-list shape (never throws)", () => {
    expect(slimInviteReceived(undefined)).toEqual({ object: null, items: [], cursor: null });
  });
});

// ---------------------------------------------------------------------------
// slimSearchPostsItem / slimSearchPosts — shared by `search posts` and
// `company posts` (D13): both endpoints' v2 responses use the identical item
// schema (GET /v1/{account_id}/companies/{identifier}/posts and
// POST /v1/{account_id}/search/posts). Neither ever sends `post_urn` or
// `posted_at` — `id` is the only identifier field, and it's required.
// ---------------------------------------------------------------------------

describe("slimSearchPostsItem", () => {
  const fullPostItem = {
    id: "urn_activity_7419644944484753408",
    share_url: "https://linkedin.com/posts/acme_1",
    text: "We are hiring!",
    author: {
      id: "urn_company_112013061",
      name: "Acme",
      is_company: true,
      public_identifier: "acme",
    },
    permissions: { can_react: true, can_share: true, can_post_comments: true },
    is_repost: false,
    attachments: [{ type: "image" }],
    reactions: [{ type: "like", count: 10 }],
    reaction_count: 10,
    comment_count: 2,
    repost_count: 1,
  };

  it("projects id, author.name, text, reaction_count, comment_count", () => {
    const result = slimSearchPostsItem(fullPostItem);
    expect(result).toEqual({
      id: "urn_activity_7419644944484753408",
      author: { name: "Acme" },
      text: "We are hiring!",
      reaction_count: 10,
      comment_count: 2,
    });
  });

  it("drops share_url, repost_count, is_repost, attachments, reactions, permissions, and author sub-fields beyond name (verbose-only)", () => {
    const result = slimSearchPostsItem(fullPostItem);
    expect(result).not.toHaveProperty("share_url");
    expect(result).not.toHaveProperty("repost_count");
    expect(result).not.toHaveProperty("is_repost");
    expect(result).not.toHaveProperty("attachments");
    expect(result).not.toHaveProperty("reactions");
    expect(result).not.toHaveProperty("permissions");
    const author = result["author"] as Record<string, unknown>;
    expect(author).not.toHaveProperty("id");
    expect(author).not.toHaveProperty("is_company");
    expect(author).not.toHaveProperty("public_identifier");
  });

  it("v1 legacy fields (post_urn, posted_at) are absent — neither v2 endpoint's response ever sends them", () => {
    const result = slimSearchPostsItem(fullPostItem);
    expect(result).not.toHaveProperty("post_urn");
    expect(result).not.toHaveProperty("posted_at");
  });

  it("text >200 chars truncated to 200; <=200 chars passed through; null preserved", () => {
    const long = slimSearchPostsItem({ ...fullPostItem, text: "A".repeat(300) });
    expect((long["text"] as string).length).toBe(200);
    expect(long["text"]).toBe("A".repeat(200));

    const short = slimSearchPostsItem({ ...fullPostItem, text: "Short post" });
    expect(short["text"]).toBe("Short post");

    const nullText = slimSearchPostsItem({ ...fullPostItem, text: null });
    expect(nullText["text"]).toBeNull();
  });

  it("author projects to null when the source has no author (never crashes)", () => {
    const withoutAuthor = { ...fullPostItem };
    delete (withoutAuthor as { author?: unknown }).author;
    const result = slimSearchPostsItem(withoutAuthor);
    expect(result["author"]).toBeNull();
  });

  it("id projects to null when absent — defensive, even though the v2 schema marks it required (never undefined)", () => {
    const result = slimSearchPostsItem({ text: "no id here", reaction_count: 0, comment_count: 0 });
    expect(result["id"]).toBeNull();
  });
});

describe("slimSearchPosts", () => {
  it("projects the envelope's items array with each item slimmed; cursor passes through", () => {
    const result = slimSearchPosts({
      object: "company_post_list",
      items: [
        { id: "p1", author: { name: "Acme" }, text: "Hi", reaction_count: 1, comment_count: 0 },
      ],
      cursor: "cur_1",
      paging: { total_count: 1 },
    });
    const items = result["items"] as Record<string, unknown>[];
    expect(items).toHaveLength(1);
    expect(items[0]).toEqual({
      id: "p1",
      author: { name: "Acme" },
      text: "Hi",
      reaction_count: 1,
      comment_count: 0,
    });
    expect(result["cursor"]).toBe("cur_1");
  });

  it("non-object / missing items input projects to an empty-list-safe shape (never throws)", () => {
    expect(() => slimSearchPosts(undefined)).not.toThrow();
    const result = slimSearchPosts(undefined) as Record<string, unknown>;
    expect(result["items"]).toEqual([]);
  });
});
