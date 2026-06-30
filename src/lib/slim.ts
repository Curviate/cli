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
 *
 * Real substrate work_experience item shape:
 *   { id, company, position, location, status, company_picture_url, skills, start, end }
 * Mapping into CurrentPosition:
 *   title        ← position
 *   company_name ← company
 *   company_id   ← null (ALWAYS — entry.id is the experience-entry id, not a company id)
 *   is_current   ← (end == null)
 */

// ---------------------------------------------------------------------------
// Exported synthesis helpers (used by slim projectors and testable standalone)
// ---------------------------------------------------------------------------

export type CurrentPosition = {
  title: string | null;
  company_name: string | null;
  company_id: null;
  is_current: boolean;
};

/**
 * Synthesize a `current_position` scalar from the `work_experience` array.
 *
 * Uses the first entry in the array (index 0).
 * Input item shape (real substrate): `{ id, company, position, end, ... }`
 *   - title        ← position
 *   - company_name ← company
 *   - company_id   ← null (ALWAYS — never read from the entry)
 *   - is_current   ← (end == null)
 *
 * Returns null when the array is empty or not provided.
 */
export function synthesizeCurrentPosition(
  workExperience: unknown[],
): CurrentPosition | null {
  if (!Array.isArray(workExperience) || workExperience.length === 0) {
    return null;
  }
  const entry = workExperience[0] as Record<string, unknown>;
  return {
    title: (entry["position"] as string | null | undefined) ?? null,
    company_name: (entry["company"] as string | null | undefined) ?? null,
    company_id: null,
    is_current: entry["end"] == null,
  };
}

/**
 * Synthesize a `headquarters` object from the `locations` array.
 *
 * Finds the entry with `is_headquarter: true` and extracts `{city, country, area}`.
 * Returns null when no headquarters entry is present.
 */
export function synthesizeHeadquarters(
  locations: unknown[],
): { city: string | null; country: string | null; area: string | null } | null {
  if (!Array.isArray(locations)) return null;
  const hq = locations.find(
    (l) => (l as Record<string, unknown>)["is_headquarter"] === true,
  ) as Record<string, unknown> | undefined;
  if (!hq) return null;
  return {
    city: (hq["city"] as string | null | undefined) ?? null,
    country: (hq["country"] as string | null | undefined) ?? null,
    area: (hq["area"] as string | null | undefined) ?? null,
  };
}

// ---------------------------------------------------------------------------
// profile me
// ---------------------------------------------------------------------------

/**
 * Slim-default projection for `profile me`.
 *
 * Exact fields returned (9):
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

  // current_position parity with `profile <id>` slim: synthesized from
  // work_experience[0], present only when --sections experience triggers the
  // server-side enrichment (null otherwise). Same helper, same contract.
  const rawWE = Array.isArray(d["work_experience"])
    ? (d["work_experience"] as unknown[])
    : [];
  const currentPosition = synthesizeCurrentPosition(rawWE);

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
    current_position: currentPosition,
  };
}

// ---------------------------------------------------------------------------
// profile <id>
// ---------------------------------------------------------------------------

/**
 * Slim-default projection for `profile <id>`.
 *
 * Exact fields returned (9):
 *   provider_id, first_name, last_name, headline, location,
 *   occupation, network_distance, public_identifier, current_position
 *
 * `current_position` is synthesized from `work_experience[0]` via
 * `synthesizeCurrentPosition`. See that function for field mapping details.
 * Returns `null` when `work_experience` is empty or absent.
 */
export function slimProfile(data: unknown): Record<string, unknown> {
  const d = (data !== null && data !== undefined && typeof data === "object"
    ? data
    : {}) as Record<string, unknown>;

  const rawWE = Array.isArray(d["work_experience"])
    ? (d["work_experience"] as unknown[])
    : [];

  const currentPosition = synthesizeCurrentPosition(rawWE);

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
// connect sent
// ---------------------------------------------------------------------------

/**
 * Project a single sent-invitation item to the slim field set.
 * Drops: inviter (self-referential on sent), specifics (constant null shared_secret).
 * Keeps: id, invited_user, invited_user_id, invited_user_public_id,
 *         invited_user_description, date, parsed_datetime, invitation_text.
 */
function slimInviteSentItem(item: Record<string, unknown>): Record<string, unknown> {
  return {
    id: item["id"] ?? null,
    invited_user: item["invited_user"] ?? null,
    invited_user_id: item["invited_user_id"] ?? null,
    invited_user_public_id: item["invited_user_public_id"] ?? null,
    invited_user_description: item["invited_user_description"] ?? null,
    date: item["date"] ?? null,
    parsed_datetime: item["parsed_datetime"] ?? null,
    invitation_text: item["invitation_text"] ?? null,
  };
}

/**
 * Slim-default projection for `connect sent` list response.
 * Accepts the full list envelope { object, items, cursor } and projects each item.
 * Applied before --fields; bypassed by --verbose.
 */
export function slimInviteSent(data: unknown): Record<string, unknown> {
  const d = (data !== null && data !== undefined && typeof data === "object"
    ? data
    : {}) as Record<string, unknown>;

  const items = Array.isArray(d["items"])
    ? (d["items"] as Array<Record<string, unknown>>).map(slimInviteSentItem)
    : [];

  return {
    object: d["object"] ?? null,
    items,
    cursor: d["cursor"] ?? null,
  };
}

// ---------------------------------------------------------------------------
// connect received
// ---------------------------------------------------------------------------

/**
 * Project a single received-invitation item to the slim field set.
 * Drops: invited_user* (self-referential — describes the authenticated user).
 * Projects specifics to { shared_secret } only (drops constant provider field).
 * Keeps: id, inviter (all sub-fields), date, parsed_datetime, invitation_text,
 *         specifics.shared_secret (required for connect respond).
 */
function slimInviteReceivedItem(item: Record<string, unknown>): Record<string, unknown> {
  const rawSpecifics =
    item["specifics"] !== null &&
    item["specifics"] !== undefined &&
    typeof item["specifics"] === "object"
      ? (item["specifics"] as Record<string, unknown>)
      : null;

  const specifics =
    rawSpecifics !== null
      ? { shared_secret: rawSpecifics["shared_secret"] ?? null }
      : null;

  return {
    id: item["id"] ?? null,
    inviter: item["inviter"] ?? null,
    date: item["date"] ?? null,
    parsed_datetime: item["parsed_datetime"] ?? null,
    invitation_text: item["invitation_text"] ?? null,
    specifics,
  };
}

/**
 * Slim-default projection for `connect received` list response.
 * Accepts the full list envelope { object, items, cursor } and projects each item.
 * Applied before --fields; bypassed by --verbose.
 */
export function slimInviteReceived(data: unknown): Record<string, unknown> {
  const d = (data !== null && data !== undefined && typeof data === "object"
    ? data
    : {}) as Record<string, unknown>;

  const items = Array.isArray(d["items"])
    ? (d["items"] as Array<Record<string, unknown>>).map(slimInviteReceivedItem)
    : [];

  return {
    object: d["object"] ?? null,
    items,
    cursor: d["cursor"] ?? null,
  };
}

// ---------------------------------------------------------------------------
// company <id>
// ---------------------------------------------------------------------------

/**
 * Slim-default projection for `company <id>`.
 *
 * Exact fields returned (12):
 *   id, name, public_identifier, profile_url, industry,
 *   employee_count, employee_count_range, website, foundation_date,
 *   messaging ({is_enabled}), headquarters ({city,country,area}|null),
 *   followers_count
 *
 * `messaging` is projected to `{ is_enabled }` only.
 * `headquarters` is synthesized from `locations` via `synthesizeHeadquarters`.
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
    ? (d["locations"] as unknown[])
    : [];
  const headquarters = synthesizeHeadquarters(rawLocations);

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
