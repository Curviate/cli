/**
 * Compile-coupling negative-control fixture — the "before" state.
 *
 * The pre-removal hand-rolled `MinimalClient` shim: because the shim declares
 * its own `profiles.getCompany`, the identical stale call type-checks GREEN —
 * which is exactly why a removed SDK method surfaced only at runtime. This file
 * is expected to PASS `tsc`.
 */
type MinimalNs = {
  profiles: {
    getCompany: (id: string) => Promise<unknown>;
  };
};

export async function staleCallSite(ns: MinimalNs): Promise<unknown> {
  return ns.profiles.getCompany("acme-inc");
}
