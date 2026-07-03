/**
 * SDK-parity test — asserts the CLI provides exactly one command for each of
 * the SDK's 82 public resource methods.
 *
 * Mechanism:
 *   1. A declared manifest maps CLI command paths to "namespace.method" strings.
 *   2. A Curviate client instance is constructed and each resource namespace's
 *      prototype is inspected to enumerate the authoritative public method set.
 *   3. The test asserts:
 *      (a) every manifest entry resolves to an existing SDK method,
 *      (b) every SDK method is covered by exactly one manifest entry,
 *      (c) the total mapped-method count is 82.
 *
 * A negative fixture at the bottom demonstrates that removing an SDK method
 * causes the bijection assertion to fail.
 */

import { describe, it, expect } from "vitest";

// ---------------------------------------------------------------------------
// Manifest — CLI command path → "namespace.method"
// ---------------------------------------------------------------------------
//
// Format: "cli command path" → "sdkNamespace.methodName"
// The left side is documentation only; the right side is machine-checked.
// `webhook verify` is intentionally absent — it calls constructEvent offline,
// not an SDK resource method.

const PARITY_MANIFEST: Record<string, string> = {
  // accounts (10)
  "account list":              "accounts.list",
  "account get":               "accounts.get",
  "account link":              "accounts.link",
  "account connect-link":      "accounts.createConnectLink",
  "account reconnect":         "accounts.reconnect",
  "account refresh":           "accounts.refresh",
  "account update":            "accounts.update",
  "account disconnect":        "accounts.disconnect",
  "account checkpoint submit": "accounts.submitCheckpoint",
  "account checkpoint poll":   "accounts.pollCheckpoint",

  // messaging (14)
  "inbox list":             "messaging.listChats",
  "inbox get":              "messaging.getChat",
  "inbox messages":         "messaging.listMessages",
  "inbox sync":             "messaging.syncMessages",
  "inbox sync-chat":        "messaging.syncChat",
  "message new":            "messaging.startChat",
  "message send":           "messaging.sendMessage",
  "message get":            "messaging.getMessage",
  "message edit":           "messaging.editMessage",
  "message delete":         "messaging.deleteMessage",
  "message react":          "messaging.addReaction",
  "message attachment":     "messaging.getAttachment",
  "message inmail":         "messaging.sendInMail",
  "message inmail-balance": "messaging.getInMailBalance",

  // profiles (9)
  "profile me":          "profiles.getMe",
  "profile get":         "profiles.get",
  "profile connections": "profiles.listConnections",
  "profile followers":   "profiles.listFollowers",
  "profile posts":       "profiles.listPosts",
  "profile comments":    "profiles.listComments",
  "profile reactions":   "profiles.listReactions",
  "company get":         "profiles.getCompany",
  "profile endorse":     "profiles.endorse",

  // invites (5)
  "connect send":     "invites.send",
  "connect sent":     "invites.listSent",
  "connect received": "invites.listReceived",
  "connect respond":  "invites.respond",
  "connect cancel":   "invites.cancel",

  // search (5)
  "search parameters": "search.getParameters",
  "search people":     "search.people",
  "search companies":  "search.companies",
  "search posts":      "search.posts",
  "search jobs":       "search.jobs",

  // posts (7)
  "post list":      "posts.list",
  "post get":       "posts.get",
  "post create":    "posts.create",
  "post comments":  "posts.listComments",
  "post comment":   "posts.comment",
  "post reactions": "posts.listReactions",
  "post react":     "posts.react",

  // salesNavigator (7)
  "sales-nav search-people":    "salesNavigator.searchPeople",
  "sales-nav search-companies": "salesNavigator.searchCompanies",
  "sales-nav parameters":       "salesNavigator.getParameters",
  "sales-nav message":          "salesNavigator.startChat",
  "sales-nav profile":          "salesNavigator.getProfile",
  "sales-nav save-lead":        "salesNavigator.saveLead",
  "sales-nav sync":             "salesNavigator.syncMessages",

  // recruiter (17)
  "recruiter sync":               "recruiter.syncMessages",
  "recruiter message":            "recruiter.startChat",
  "recruiter profile":            "recruiter.getProfile",
  "recruiter search":             "recruiter.searchPeople",
  "recruiter parameters":         "recruiter.getParameters",
  "recruiter projects":           "recruiter.listProjects",
  "recruiter project":            "recruiter.getProject",
  "recruiter add-candidate":      "recruiter.addCandidate",
  "recruiter add-applicant":      "recruiter.addApplicant",
  "recruiter reject-applicant":   "recruiter.rejectApplicant",
  "recruiter jobs":               "recruiter.listJobs",
  "recruiter job create":         "recruiter.createJob",
  "recruiter job publish":        "recruiter.publishJob",
  "recruiter job checkpoint":     "recruiter.solveJobCheckpoint",
  "recruiter job applicants":     "recruiter.listApplicants",
  "recruiter applicant":          "recruiter.getApplicant",
  "recruiter applicant resume":   "recruiter.downloadResume",
  "recruiter job get":            "recruiter.getJob",

  // jobs (1)
  "job get": "jobs.get",

  // webhooks (6)
  "webhook create":     "webhooks.create",
  "webhook list":       "webhooks.list",
  "webhook events":     "webhooks.listEvents",
  "webhook update":     "webhooks.update",
  "webhook delete":     "webhooks.delete",
  "webhook state-diff": "webhooks.getStateDiff",
};

// ---------------------------------------------------------------------------
// SDK method enumeration via client instance prototype inspection
// ---------------------------------------------------------------------------

/**
 * Build the full set of SDK methods in "namespace.method" form by
 * constructing a Curviate client and inspecting each resource namespace's
 * prototype. The stub API key is never used for network calls.
 */
async function buildSdkMethodSet(): Promise<Set<string>> {
  const { Curviate } = await import("@curviate/sdk");
  const client = new Curviate({ apiKey: "rdc_live_parity_test_stub" });

  // Each entry: [namespace key on the client, namespace key on account scope]
  // The account-scoped namespaces are on client.account("x"), and the root
  // namespaces (accounts, webhooks) are on the client directly.
  const rootNamespaces: [string, object][] = [
    ["accounts", client.accounts],
    ["webhooks", client.webhooks],
  ];

  // account-scoped: pick them via client.account() — same classes, different context
  const scoped = client.account("stub_account_id");
  const scopedNamespaces: [string, object][] = [
    ["messaging", scoped.messaging],
    ["profiles", scoped.profiles],
    ["invites", scoped.invites],
    ["search", scoped.search],
    ["posts", scoped.posts],
    ["salesNavigator", scoped.salesNavigator],
    ["recruiter", scoped.recruiter],
    ["jobs", scoped.jobs],
  ];

  const methods = new Set<string>();
  for (const [ns, instance] of [...rootNamespaces, ...scopedNamespaces]) {
    const proto = Object.getPrototypeOf(instance) as Record<string, unknown>;
    for (const name of Object.getOwnPropertyNames(proto)) {
      if (name === "constructor") continue;
      methods.add(`${ns}.${name}`);
    }
  }
  return methods;
}

// ---------------------------------------------------------------------------
// Parity tests
// ---------------------------------------------------------------------------

describe("SDK parity — command manifest", () => {
  it("manifest has exactly 82 entries", () => {
    const count = Object.keys(PARITY_MANIFEST).length;
    expect(count, `manifest length should be 82, got ${count}`).toBe(82);
  });

  it("every manifest entry maps to a real SDK method (no phantom references)", async () => {
    const sdkMethods = await buildSdkMethodSet();
    const phantoms: string[] = [];

    for (const [cliPath, sdkMethod] of Object.entries(PARITY_MANIFEST)) {
      if (!sdkMethods.has(sdkMethod)) {
        phantoms.push(`"${cliPath}" → "${sdkMethod}" (not found in SDK)`);
      }
    }

    expect(
      phantoms,
      `Manifest references non-existent SDK methods:\n${phantoms.join("\n")}`,
    ).toHaveLength(0);
  });

  it("every SDK method is covered by exactly one manifest entry", async () => {
    const sdkMethods = await buildSdkMethodSet();

    // Build reverse map: sdkMethod → cliPath(s)
    const reverse = new Map<string, string[]>();
    for (const [cliPath, sdkMethod] of Object.entries(PARITY_MANIFEST)) {
      if (!reverse.has(sdkMethod)) reverse.set(sdkMethod, []);
      reverse.get(sdkMethod)!.push(cliPath);
    }

    // SDK methods missing from manifest
    const uncovered: string[] = [];
    for (const m of sdkMethods) {
      if (!reverse.has(m)) uncovered.push(m);
    }

    // SDK methods mapped more than once
    const duplicated: string[] = [];
    for (const [m, paths] of reverse) {
      if (paths.length > 1) duplicated.push(`${m} → [${paths.join(", ")}]`);
    }

    expect(
      uncovered,
      `SDK methods not covered by any manifest entry:\n${uncovered.join("\n")}`,
    ).toHaveLength(0);

    expect(
      duplicated,
      `SDK methods mapped by more than one manifest entry:\n${duplicated.join("\n")}`,
    ).toHaveLength(0);
  });

  it("SDK has exactly 82 public resource methods", async () => {
    const sdkMethods = await buildSdkMethodSet();
    expect(sdkMethods.size, `SDK has ${sdkMethods.size} public methods, expected 82`).toBe(82);
  });
});

// ---------------------------------------------------------------------------
// Negative guard — demonstrates the test fails when a method is removed
// ---------------------------------------------------------------------------

describe("SDK parity — negative guard (injected phantom)", () => {
  it("bijection check detects a phantom manifest entry (non-existent SDK method)", async () => {
    // Build a manifest that includes a method that does NOT exist on the SDK.
    // The bijection assertion must detect it.
    const sdkMethods = await buildSdkMethodSet();
    const phantomMethod = "accounts.nonExistentMethod";

    // Verify the phantom is not accidentally present in the SDK
    expect(sdkMethods.has(phantomMethod)).toBe(false);

    // Simulate the check: a manifest with a phantom entry would be flagged
    const testManifest = { ...PARITY_MANIFEST, "account phantom": phantomMethod };
    const phantoms = Object.values(testManifest).filter((m) => !sdkMethods.has(m));
    expect(phantoms).toContain(phantomMethod);
  });

  it("bijection check detects a missing SDK method (uncovered method)", async () => {
    // Simulate removing "accounts.list" from the manifest.
    // The coverage check must report it as uncovered.
    const sdkMethods = await buildSdkMethodSet();
    const removedMethod = "accounts.list";

    expect(sdkMethods.has(removedMethod), "removed method must exist in SDK").toBe(true);

    const reducedManifest = Object.fromEntries(
      Object.entries(PARITY_MANIFEST).filter(([, m]) => m !== removedMethod),
    );

    const coveredMethods = new Set(Object.values(reducedManifest));
    expect(coveredMethods.has(removedMethod)).toBe(false);

    const uncovered = [...sdkMethods].filter((m) => !coveredMethods.has(m));
    expect(uncovered).toContain(removedMethod);
  });
});
