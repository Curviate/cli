/**
 * Member id resolution for endpoints that reject a public slug/URL.
 *
 * Most member-addressed commands (`profile <id>`, `connect <id>`, `message`)
 * forward a URL/slug and let the server resolve it. A growing set of
 * endpoints does not: `users.follow` / `users.unfollow` (D6) and
 * `posts.listUserPosts` / `posts.listUserReactions` / `comments.listUserComments`
 * / `users.get`'s `linkedin_sections`-enriched form (D7) all 400/404 a public
 * slug and require the raw provider id (ACoAA… / ADoAA… / AEoAA…). This
 * module gives those commands the same auto-resolution their siblings enjoy:
 * a provider-id-shaped input passes straight through; a URL/slug is
 * normalized then resolved to the provider id via a single `users.get` READ
 * (which notifies no one, so it is contact-safe and runs even under
 * `--preview`).
 *
 * `users.get`'s own CurviateError (e.g. 404 for an unknown member) propagates
 * to the caller unchanged, so the command surfaces it through its normal
 * error → exit-code path.
 *
 * Two entry points, because the served ops differ on whether they accept the
 * "me" sentinel:
 *   - `resolveMemberProviderId` — `users.follow`/`users.unfollow` (D6). No
 *     "me" special-case: those write ops have no documented "me" meaning, so
 *     a literal `"me"` input is resolved like any other slug (one extra
 *     `users.get` call, same as before this D7 fix — unchanged behavior).
 *   - `resolveMemberOrMeProviderId` — the D7 read surface (`post user-posts`,
 *     `post user-reactions`, `comment user`, `profile <id> --sections`).
 *     These endpoints DO accept the "me" sentinel directly, so `"me"` passes
 *     straight through with zero extra network calls — only an actual
 *     slug/URL pays for the resolve.
 *
 * A third entry point resolves in the OPPOSITE direction — a provider id
 * FORWARD to a public identifier (vanity slug) — for the one endpoint that
 * rejects a provider id instead of requiring one:
 *   - `resolveMemberPublicIdentifier` — `groups list --member` (WP6 must-fix
 *     1). The endpoint's `profile` filter builds a `/in/<vanity>/…` URL
 *     server-side; fed a raw provider id it builds a bogus URL and silently
 *     returns an empty list (exit 0, `items: []`) — indistinguishable from a
 *     real empty result. A provider-id-shaped input is resolved to its
 *     `public_identifier` via a single `users.get` READ; a vanity slug or
 *     /in/ URL passes straight through (normalized) with no extra call.
 *     Throws `MemberResolutionError` when the `users.get` call itself fails
 *     OR when it succeeds but the profile carries no `public_identifier`
 *     (e.g. a fully custom/legacy URL) — either way, resolution failed and
 *     the caller surfaces one fixed usage-error message (exit 2).
 */

import type { Curviate } from "@curviate/sdk";
import { resolveIdentifier } from "./identifier.js";

type AccountNamespaces = ReturnType<Curviate["account"]>;

/**
 * A LinkedIn member provider id: `ACoAA…` / `ADoAA…` / `AEoAA…`. Endpoints that
 * accept only the provider id need the raw value, not a public slug.
 */
export const MEMBER_PROVIDER_ID_RE = /^A[CDE][A-Za-z0-9_-]{4,}$/;

/**
 * Resolve a raw member identifier (URL, slug, or provider id) to the member's
 * provider id — the form `users.follow` / `users.unfollow` require. A
 * provider-id-shaped input is returned with no extra call; anything else is
 * normalized (`resolveIdentifier`) then resolved via `users.get`.
 */
export async function resolveMemberProviderId(
  ns: AccountNamespaces,
  raw: string,
): Promise<string> {
  const normalized = resolveIdentifier(raw);
  if (MEMBER_PROVIDER_ID_RE.test(normalized)) return normalized;
  const profile = await ns.users.get(normalized, {});
  return profile.id;
}

/**
 * Resolve a raw member identifier for the D7 read surface (`post user-posts`,
 * `post user-reactions`, `comment user`, `profile <id> --sections`) — same
 * provider-id passthrough as `resolveMemberProviderId`, plus a "me"
 * passthrough (these endpoints accept the "me" sentinel directly, unlike
 * `users.follow`/`users.unfollow`). Only a genuine slug/URL pays for the
 * `users.get` resolve call.
 */
export async function resolveMemberOrMeProviderId(
  ns: AccountNamespaces,
  raw: string,
): Promise<string> {
  const normalized = resolveIdentifier(raw);
  if (normalized === "me" || MEMBER_PROVIDER_ID_RE.test(normalized)) return normalized;
  const profile = await ns.users.get(normalized, {});
  return profile.id;
}

/**
 * Thrown by `resolveMemberPublicIdentifier` when a provider id could not be
 * resolved to a public identifier — either the `users.get` lookup itself
 * failed, or it succeeded but the profile has no `public_identifier`. The
 * caller (`groups list --member`) catches this and exits 2 with one fixed
 * usage-error message; it never propagates as a raw SDK error.
 */
export class MemberResolutionError extends Error {
  constructor(raw: string) {
    super(`could not resolve member identifier "${raw}" to a public identifier`);
    this.name = "MemberResolutionError";
  }
}

/**
 * Resolve a raw member identifier to the form `groups list --member` (the
 * endpoint's `profile` filter) requires: a public identifier (vanity slug).
 * The opposite direction from `resolveMemberProviderId` — this endpoint
 * builds a `/in/<vanity>/…` URL server-side and 200s-with-empty on a raw
 * provider id, so a provider-id-shaped input is resolved FORWARD to its
 * `public_identifier` via a single `users.get` READ (contact-safe — this is
 * a read-only lookup, not the follow/unfollow write). A vanity slug or /in/
 * URL passes straight through (normalized only) with no extra call.
 *
 * Throws `MemberResolutionError` — never a raw `CurviateError` — when the
 * `users.get` call fails or returns no `public_identifier`, so the caller can
 * surface one fixed, honest usage-error message instead of a confusing 404.
 */
export async function resolveMemberPublicIdentifier(
  ns: AccountNamespaces,
  raw: string,
): Promise<string> {
  const normalized = resolveIdentifier(raw);
  if (!MEMBER_PROVIDER_ID_RE.test(normalized)) return normalized;
  let profile: { public_identifier?: string };
  try {
    profile = await ns.users.get(normalized, {});
  } catch {
    throw new MemberResolutionError(raw);
  }
  if (!profile.public_identifier) {
    throw new MemberResolutionError(raw);
  }
  return profile.public_identifier;
}
