/**
 * SDK-parity test — asserts the CLI provides exactly one primary command for
 * each of the SDK's 141 public resource methods (the full v2 surface).
 *
 * Mechanism:
 *   1. A declared manifest maps CLI command paths to "namespace.method" strings.
 *   2. A Curviate client instance is constructed and each resource namespace's
 *      prototype is inspected to enumerate the authoritative public method set.
 *   3. The test asserts:
 *      (a) every manifest entry resolves to an existing SDK method,
 *      (b) every SDK method is covered by exactly one manifest entry,
 *      (c) the total mapped-method count is 115.
 *
 * The manifest holds exactly ONE counted entry per SDK method. Five convenience
 * routes are intentionally NOT counted (they reuse coverage a canonical command
 * already provides, so a separate entry would double-cover its method and break
 * the bijection):
 *   - `profile me`            → users.get('me')          (alias of `profile get`)
 *   - `profile … --posts`     → posts.listUserPosts      (alias of `post user-posts`)
 *   - `profile … --comments`  → comments.listUserComments(alias of `comment user`)
 *   - `profile … --reactions` → posts.listUserReactions  (alias of `post user-reactions`)
 *   - `profile … --followers` → users.listFollowers      (alias of `profile followers`)
 *
 * A negative-guard block at the bottom demonstrates that the bijection fails
 * when a manifest entry references a missing method, or when a real method is
 * left uncovered.
 */

import { describe, it, expect } from "vitest";

// ---------------------------------------------------------------------------
// Manifest — CLI command path → "namespace.method"
// ---------------------------------------------------------------------------
//
// Format: "cli command path" → "sdkNamespace.methodName"
// The left side is documentation only; the right side is machine-checked.
// `webhook verify`, `login`, and `config *` are intentionally absent — they
// call no SDK resource method (offline HMAC / local config management).

const PARITY_MANIFEST: Record<string, string> = {
  // accounts (4)
  "account list":       "accounts.list",
  "account get":        "accounts.get",
  "account update":     "accounts.update",
  "account disconnect": "accounts.disconnect",

  // webhooks (6)
  "webhook create": "webhooks.create",
  "webhook list":   "webhooks.list",
  "webhook events": "webhooks.listEvents",
  "webhook get":    "webhooks.get",
  "webhook update": "webhooks.update",
  "webhook delete": "webhooks.delete",

  // auth (5) — mounted under the `account` noun (intent-shaped tree)
  "account link":                 "auth.intent",
  "account checkpoint solve":     "auth.solveCheckpoint",
  "account checkpoint request":   "auth.requestCheckpoint",
  "account checkpoint poll":      "auth.pollCheckpoint",
  "account connect-session poll": "auth.getSession",

  // messaging (12) — split across the `inbox` and `message` nouns
  "inbox list":             "messaging.listChats",
  "inbox get":              "messaging.getChat",
  "inbox messages":         "messaging.listMessages",
  "inbox mark-read":        "messaging.markChatRead",
  "message new":            "messaging.startChat",
  "message send":           "messaging.sendMessage",
  "message get":            "messaging.getMessage",
  "message edit":           "messaging.editMessage",
  "message delete":         "messaging.deleteMessage",
  "message react":          "messaging.addReaction",
  "message attachment":     "messaging.getAttachment",
  "message inmail":         "messaging.sendInMail",

  // users (9) — mounted under the `profile` noun (+ inmail-balance under message)
  "profile get":            "users.get",
  "profile relations":      "users.listRelations",
  "profile followers":      "users.listFollowers",
  "profile following":      "users.listFollowing",
  "profile follow":         "users.follow",
  "profile unfollow":       "users.unfollow",
  "profile update":         "users.update",
  "profile endorse":        "users.endorseSkill",
  "message inmail-balance": "users.getInMailCredits",

  // invites (6) — mounted under the `connect` noun
  "connect send":     "invites.send",
  "connect sent":     "invites.listSent",
  "connect received": "invites.listReceived",
  "connect accept":   "invites.accept",
  "connect decline":  "invites.decline",
  "connect cancel":   "invites.cancel",

  // search (6)
  "search":            "search.fromUrl",
  "search people":     "search.people",
  "search companies":  "search.companies",
  "search posts":      "search.posts",
  "search jobs":       "search.jobs",
  "search parameters": "search.getParameters",

  // posts (9) — `comment list` wraps posts.listComments (the comment group)
  "post get":            "posts.get",
  "post create":         "posts.create",
  "post react":          "posts.react",
  "post reactions":      "posts.listReactions",
  "post delete":         "posts.delete",
  "post unreact":        "posts.unreact",
  "post user-posts":     "posts.listUserPosts",
  "post user-reactions": "posts.listUserReactions",
  "comment list":        "posts.listComments",

  // salesNavigator (12)
  "sales-nav search people":       "salesNavigator.searchPeople",
  "sales-nav search companies":    "salesNavigator.searchCompanies",
  "sales-nav search parameters":   "salesNavigator.getParameters",
  "sales-nav search":              "salesNavigator.searchFromUrl",
  "sales-nav message new":         "salesNavigator.startChat",
  "sales-nav profile":             "salesNavigator.getProfile",
  "sales-nav save-lead":           "salesNavigator.saveLead",
  "sales-nav account-lists":       "salesNavigator.accountLists",
  "sales-nav lead-lists":          "salesNavigator.leadLists",
  "sales-nav browse-account-list": "salesNavigator.browseAccountList",
  "sales-nav browse-lead-list":    "salesNavigator.browseLeadList",
  "sales-nav save-account":        "salesNavigator.saveAccount",

  // recruiter (23)
  "recruiter profile":             "recruiter.getProfile",
  "recruiter message new":         "recruiter.startChat",
  "recruiter search people":       "recruiter.searchPeople",
  "recruiter search parameters":   "recruiter.searchParameters",
  "recruiter search":              "recruiter.searchFromUrl",
  "recruiter talent-search":       "recruiter.searchTalentPool",
  "recruiter projects":            "recruiter.listProjects",
  "recruiter project":             "recruiter.getProject",
  "recruiter project update":      "recruiter.updateProject",
  "recruiter pipeline":            "recruiter.listPipeline",
  "recruiter project-job get":     "recruiter.getProjectJob",
  "recruiter project-job create":  "recruiter.createProjectJob",
  "recruiter project-job budget":  "recruiter.getProjectJobBudget",
  "recruiter project-job update":  "recruiter.updateProjectJob",
  "recruiter save-candidate":      "recruiter.saveCandidate",
  "recruiter applicants":          "recruiter.listApplicants",
  "recruiter jobs":                "recruiter.listJobs",
  "recruiter job create":          "recruiter.createJob",
  "recruiter job publish":         "recruiter.publishJob",
  "recruiter job close":           "recruiter.closeJob",
  "recruiter job get":             "recruiter.getJob",
  "recruiter applicant":           "recruiter.getApplicant",
  "recruiter applicant resume":    "recruiter.downloadResume",

  // jobs (10)
  "job get":              "jobs.get",
  "job list":             "jobs.list",
  "job create":           "jobs.create",
  "job update":           "jobs.update",
  "job budget":           "jobs.getBudget",
  "job publish":          "jobs.publish",
  "job close":            "jobs.close",
  "job applicants":       "jobs.listApplicants",
  "job applicant get":    "jobs.getApplicant",
  "job applicant resume": "jobs.downloadResume",

  // companies (4)
  "company get":       "companies.get",
  "company employees": "companies.employees",
  "company posts":     "companies.posts",
  "company jobs":      "companies.jobs",

  // comments (9)
  "comment add":       "comments.create",
  "comment reply":     "comments.reply",
  "comment edit":      "comments.edit",
  "comment delete":    "comments.delete",
  "comment replies":   "comments.listReplies",
  "comment react":     "comments.addReaction",
  "comment reactions": "comments.listReactions",
  "comment unreact":   "comments.removeReaction",
  "comment user":      "comments.listUserComments",

  // profile insights (4) — the SDK `profile` namespace (the acting account's own
  // insight surface), mounted as subcommands of the `profile` noun. Distinct from
  // the `users`-backed member reads above (`profile get`/`relations`/…).
  "profile subscription": "profile.subscription",
  "profile analytics":    "profile.analytics",
  "profile visitors":     "profile.visitors",
  "profile ssi":          "profile.ssi",

  // groups (3)
  "groups list":    "groups.list",
  "groups get":     "groups.get",
  "groups members": "groups.members",

  // feed (1)
  "feed home": "feed.home",

  // notifications (3)
  "notifications list":      "notifications.list",
  "notifications delete":    "notifications.delete",
  "notifications show-less": "notifications.showLess",

  // companies extensions (8) — managed pages, followers/invitable-followers, and
  // the company-page admin inbox (Beta).
  "company managed":             "companies.managed",
  "company followers":           "companies.followers",
  "company invitable-followers": "companies.invitableFollowers",
  "company chats":               "companies.chats",
  "company chat":                "companies.chat",
  "company messages":            "companies.messages",
  "company message":             "companies.message",
  "company search-chats":        "companies.searchChats",

  // search extensions (3)
  "search groups":             "search.groups",
  "search services":           "search.services",
  "search service-parameters": "search.getServiceParameters",

  // messaging extension (1) — inbox free-text search, under the `message` noun.
  "message search": "messaging.searchChats",

  // posts extensions (3) — the connected account's own saved-posts bookmark list.
  "post saved":  "posts.listSaved",
  "post save":   "posts.save",
  "post unsave": "posts.unsave",
};

const EXPECTED_METHOD_COUNT = 141;

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

  // Root namespaces live on the client directly.
  const rootNamespaces: [string, object][] = [
    ["accounts", client.accounts],
    ["webhooks", client.webhooks],
    ["auth", client.auth],
  ];

  // Account-scoped namespaces live on client.account(id).
  const scoped = client.account("stub_account_id");
  const scopedNamespaces: [string, object][] = [
    ["messaging", scoped.messaging],
    ["users", scoped.users],
    ["invites", scoped.invites],
    ["search", scoped.search],
    ["posts", scoped.posts],
    ["salesNavigator", scoped.salesNavigator],
    ["recruiter", scoped.recruiter],
    ["jobs", scoped.jobs],
    ["companies", scoped.companies],
    ["comments", scoped.comments],
    ["profile", scoped.profile],
    ["groups", scoped.groups],
    ["feed", scoped.feed],
    ["notifications", scoped.notifications],
  ];

  const methods = new Set<string>();
  for (const [ns, instance] of [...rootNamespaces, ...scopedNamespaces]) {
    const proto = Object.getPrototypeOf(instance) as Record<string, unknown>;
    for (const name of Object.getOwnPropertyNames(proto)) {
      if (name === "constructor") continue;
      if (typeof (instance as Record<string, unknown>)[name] !== "function") continue;
      methods.add(`${ns}.${name}`);
    }
  }
  return methods;
}

// ---------------------------------------------------------------------------
// Parity tests
// ---------------------------------------------------------------------------

describe("SDK parity — command manifest", () => {
  it(`manifest has exactly ${EXPECTED_METHOD_COUNT} entries`, () => {
    const count = Object.keys(PARITY_MANIFEST).length;
    expect(count, `manifest length should be ${EXPECTED_METHOD_COUNT}, got ${count}`).toBe(EXPECTED_METHOD_COUNT);
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

  it(`SDK has exactly ${EXPECTED_METHOD_COUNT} public resource methods`, async () => {
    const sdkMethods = await buildSdkMethodSet();
    expect(
      sdkMethods.size,
      `SDK has ${sdkMethods.size} public methods, expected ${EXPECTED_METHOD_COUNT}`,
    ).toBe(EXPECTED_METHOD_COUNT);
  });
});

// ---------------------------------------------------------------------------
// Negative guards — demonstrate the bijection fails on drift
// ---------------------------------------------------------------------------

describe("SDK parity — negative guard (injected phantom)", () => {
  it("bijection check detects a phantom manifest entry (non-existent SDK method)", async () => {
    const sdkMethods = await buildSdkMethodSet();
    const phantomMethod = "accounts.nonExistentMethod";

    expect(sdkMethods.has(phantomMethod)).toBe(false);

    const testManifest = { ...PARITY_MANIFEST, "account phantom": phantomMethod };
    const phantoms = Object.values(testManifest).filter((m) => !sdkMethods.has(m));
    expect(phantoms).toContain(phantomMethod);
  });

  it("bijection check detects a missing SDK method (uncovered method)", async () => {
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
