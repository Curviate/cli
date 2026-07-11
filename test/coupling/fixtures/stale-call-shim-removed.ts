/**
 * Compile-coupling negative-control fixture — the "after" state.
 *
 * The shim removal has landed: the namespace is typed against the real
 * `AccountScopedNamespaces` exported by @curviate/sdk. The pre-v2 call site
 * (`profiles.getCompany`) is a COMPILE error now — v2 removed `profiles` (the
 * retrieve lives on `companies.get`). This file is expected to FAIL `tsc`; it
 * is excluded from the package's own typecheck and compiled in isolation by
 * test/coupling/compile-coupling.test.ts.
 */
import type { AccountScopedNamespaces } from "@curviate/sdk";

export async function staleCallSite(ns: AccountScopedNamespaces): Promise<unknown> {
  return ns.profiles.getCompany("acme-inc");
}
