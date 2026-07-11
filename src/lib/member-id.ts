/**
 * Member id resolution for endpoints that accept ONLY a provider id.
 *
 * Most member-addressed commands (`profile <id>`, `connect <id>`, `message`)
 * forward a URL/slug and let the server resolve it. A few write endpoints —
 * `users.follow` / `users.unfollow` — accept only the raw provider id
 * (ACoAA… / ADoAA… / AEoAA…) and 404 a public slug. This helper gives those
 * commands the same auto-resolution their siblings enjoy: a provider-id-shaped
 * input passes straight through; a URL/slug is normalized then resolved to the
 * provider id via a single `users.get` READ (which notifies no one, so it is
 * contact-safe and runs even under `--preview`).
 *
 * `users.get`'s own CurviateError (e.g. 404 for an unknown member) propagates
 * to the caller unchanged, so the command surfaces it through its normal
 * error → exit-code path.
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
