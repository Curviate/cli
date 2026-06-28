/**
 * Slim-default projection functions for the CLI.
 *
 * These functions extract the fields agents and humans most commonly need
 * from the full SDK response, keeping default `--json` output compact.
 * Pass `--verbose` to bypass slim projection and receive the raw SDK response.
 *
 * Conventions:
 *   - Fields absent from the source are projected as `null` (never `undefined`),
 *     so the output shape is stable regardless of which sections were fetched.
 *   - Sub-object projections strip every key not explicitly listed here.
 *   - Array projections that synthesize a scalar (`current_position`,
 *     `headquarters`) set the value to `null` when the source is empty or absent.
 */

// ---------------------------------------------------------------------------
// profile me
// ---------------------------------------------------------------------------

/**
 * Slim-default projection for `profile me`.
 *
 * Exact fields returned:
 *   provider_id, first_name, last_name, public_identifier, location,
 *   email, occupation, is_premium,
 *   organizations (array of {id, mailbox_id, name})
 */
export function slimProfileMe(data: unknown): Record<string, unknown> {
  const d = (data !== null && data !== undefined && typeof data === "object"
    ? data
    : {}) as Record<string, unknown>;

  const rawOrgs = Array.isArray(d["organizations"])
    ? (d["organizations"] as Array<Record<string, unknown>>)
    : [];

  const organizations = rawOrgs.map((org) => ({
    id: org["id"] ?? null,
    mailbox_id: org["mailbox_id"] ?? null,
    name: org["name"] ?? null,
  }));

  return {
    provider_id: d["provider_id"] ?? null,
    first_name: d["first_name"] ?? null,
    last_name: d["last_name"] ?? null,
    public_identifier: d["public_identifier"] ?? null,
    location: d["location"] ?? null,
    email: d["email"] ?? null,
    occupation: d["occupation"] ?? null,
    is_premium: d["is_premium"] ?? null,
    organizations,
  };
}

// ---------------------------------------------------------------------------
// profile <id>
// ---------------------------------------------------------------------------

/**
 * Slim-default projection for `profile <id>`.
 *
 * Exact fields returned:
 *   provider_id, first_name, last_name, headline, location,
 *   occupation, network_distance, public_identifier, current_position
 *
 * `current_position` is synthesized from `work_experience[0]`:
 *   { title, company_name, company_id, is_current }
 * Returns `null` when `work_experience` is empty or absent.
 */
export function slimProfileGet(data: unknown): Record<string, unknown> {
  const d = (data !== null && data !== undefined && typeof data === "object"
    ? data
    : {}) as Record<string, unknown>;

  const rawWE = Array.isArray(d["work_experience"])
    ? (d["work_experience"] as Array<Record<string, unknown>>)
    : [];

  const firstJob = rawWE.length > 0 ? rawWE[0]! : null;
  const currentPosition = firstJob !== null
    ? {
        title: firstJob["title"] ?? null,
        company_name: firstJob["company_name"] ?? null,
        company_id: firstJob["company_id"] ?? null,
        is_current: firstJob["is_current"] ?? null,
      }
    : null;

  return {
    provider_id: d["provider_id"] ?? null,
    first_name: d["first_name"] ?? null,
    last_name: d["last_name"] ?? null,
    headline: d["headline"] ?? null,
    location: d["location"] ?? null,
    occupation: d["occupation"] ?? null,
    network_distance: d["network_distance"] ?? null,
    public_identifier: d["public_identifier"] ?? null,
    current_position: currentPosition,
  };
}

// ---------------------------------------------------------------------------
// company <id>
// ---------------------------------------------------------------------------

/**
 * Slim-default projection for `company <id>`.
 *
 * Exact fields returned:
 *   id, name, public_identifier, profile_url, industry,
 *   employee_count, employee_count_range, website, foundation_date,
 *   messaging ({is_enabled}), headquarters ({city,country,area}|null),
 *   followers_count
 *
 * `messaging` is projected to `{ is_enabled }` only.
 * `headquarters` is synthesized from `locations.find(l => l.is_headquarter)`.
 * Returns `null` when no headquarters location is present.
 */
export function slimCompany(data: unknown): Record<string, unknown> {
  const d = (data !== null && data !== undefined && typeof data === "object"
    ? data
    : {}) as Record<string, unknown>;

  // Project messaging to {is_enabled} only
  const rawMessaging = (d["messaging"] !== null && d["messaging"] !== undefined && typeof d["messaging"] === "object")
    ? (d["messaging"] as Record<string, unknown>)
    : null;
  const messaging = {
    is_enabled: (rawMessaging?.["is_enabled"] as boolean | null | undefined) ?? false,
  };

  // Synthesize headquarters from locations
  const rawLocations = Array.isArray(d["locations"])
    ? (d["locations"] as Array<Record<string, unknown>>)
    : [];
  const hqLocation = rawLocations.find((l) => l["is_headquarter"] === true) ?? null;
  const headquarters = hqLocation !== null
    ? {
        city: hqLocation["city"] ?? null,
        country: hqLocation["country"] ?? null,
        area: hqLocation["area"] ?? null,
      }
    : null;

  return {
    id: d["id"] ?? null,
    name: d["name"] ?? null,
    public_identifier: d["public_identifier"] ?? null,
    profile_url: d["profile_url"] ?? null,
    industry: d["industry"] ?? null,
    employee_count: d["employee_count"] ?? null,
    employee_count_range: d["employee_count_range"] ?? null,
    website: d["website"] ?? null,
    foundation_date: d["foundation_date"] ?? null,
    messaging,
    headquarters,
    followers_count: d["followers_count"] ?? null,
  };
}
