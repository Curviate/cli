# Changelog

All notable changes to `@curviate/cli` are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
Versioning follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html):
a new command or flag is a minor; a breaking command/flag/exit-code change is a major; a fix is a patch.

## [Unreleased]

## [0.10.0] - 2026-07-03

### Added

- `job get <url|id>` — a new top-level `job` command retrieving one public LinkedIn job posting's full detail. Accepts a job URL (`https://www.linkedin.com/jobs/view/<id>`) or a bare numeric id — a job URL is resolved to its numeric id client-side; anything else passes through and the API is the final validator. Slim-default output: `object`, `id`, `title`, `company`, `company_id`, `location`, `state`, `applicants_counter`, `published_at`, `description` — `description` stays in the default output since retrieving it is the point of the command. Pass `--verbose` for the full response (adds `cost`, `created_at`, `hiring_team`). An unknown job id exits with the not-found exit code. This is a read command — `--preview` is a usage error, matching every other single-object read.
- `recruiter job get <url|id>` — the Recruiter-lens sibling of `job get`, joining the existing `recruiter job` command group. Retrieves any public job posting (not only postings you manage) — unlike `recruiter jobs`, which lists your own. Same URL/id resolution and slim/verbose projection as the top-level command; requires the Recruiter add-on tier (exit `5` without it).
- README gained a new numbered example chaining `search jobs` into `job get`, and a "Get any public job posting through the Recruiter lens" example in the Recruiter section.

### Changed

- `@curviate/sdk` dependency bumped to `^0.10.0`.
- `recruiter job get --help` does not advertise `--limit`/`--cursor`/`--all`/`--max-pages` — a single-object read, consistent with the other Recruiter single-reads (`profile`, `project`, `applicant`). `--fields` and `--verbose` are unchanged and available.

## [0.9.0] - 2026-07-03

### Added

- `account list` and `account get` gain a compact **slim-default** output — pass `--verbose` for the full API response. Slim `account list` items: `account_id`, `status`, `auth_method`, `full_name`, `headline`, `seat_id`, `connected_at`. Slim `account get`: the same seven fields plus `last_checked_at` and `quotas`. Six cached account-detail fields (`username`, `premium_id`, `public_identifier`, `substrate_created_at`, `signatures`, `groups`) are verbose-only on both commands — they are `null`/`[]` on an account that hasn't been enriched yet, never a missing key. `--all` NDJSON streaming on `account list` applies the same slim projection per item unless `--verbose` is passed.
- `account get` gains `seat_id` in its slim output (previously only `account list` carried it) — the seat the account occupies, `null` for an admin seatless account.

### Changed

- `@curviate/sdk` dependency bumped to `^0.9.0`.
- `account get --help` no longer advertises `--limit`/`--cursor`/`--all`/`--max-pages` — a single-object read, those flags never applied. `--fields` is unchanged and still available. `account list` is unaffected (a genuine list read, keeps all pagination flags).

## [0.8.0] - 2026-07-02

### Added

- `recruiter reject-applicant` gained `--message` and `--notify-at` flags. The applicant is only notified of the rejection when `--message` is provided (the prior behavior — no notification — is unchanged when both are omitted). `--notify-at` schedules the notification (a UNIX-milliseconds timestamp) and requires `--message`; passing `--notify-at` alone, or a non-numeric value, is a usage error (exit `2`).
- README gained dedicated "Sales Navigator" and "Recruiter" sections with numbered, runnable examples covering every in-scope command: searching and getting profiles, saving a lead, starting a chat, listing/searching Recruiter people and hiring projects, the job create → publish → checkpoint lifecycle, listing/getting applicants, downloading a resume, and rejecting an applicant with and without a notification.

### Changed

- **Help output cleanup:** Recruiter and Sales Navigator write commands (`add-candidate`, `add-applicant`, `reject-applicant`, `job create`/`publish`/`checkpoint`, `save-lead`, `message new`) and single-object read commands (`profile`, `project`, `applicant`, `applicant resume`) no longer advertise `--limit`/`--cursor`/`--all`/`--max-pages` in `--help` — those flags only ever applied to list/search commands, which keep them unchanged. Single-object reads keep `--fields`.
- Corrected the `search parameters --type` flag description on both `recruiter` and `sales-nav` — it previously suggested example values (`LOCATION`, `INDUSTRY`, `TITLE`) that the API does not accept for either surface; it now lists the real accepted values.
- Polished the `message new --to` flag description on both surfaces with the expected provider-ID format and a note that it is not resolved from a URL or slug.
- Updated `@curviate/sdk` dependency to `^0.8.0`. No resource method signatures changed (per the SDK 0.8.0 changelog); Recruiter's job-lifecycle endpoints (applicant get/reject/resume, applicant list, job publish/checkpoint, Recruiter profile) are now fully implemented server-side instead of returning `501`.

## [0.7.2] - 2026-07-01

### Changed

- Updated `@curviate/sdk` dependency to `^0.7.0`. The `recruiter message new` command output now reflects the aligned start-chat response `{ object, chat_id, message_id }` (the SDK dropped the `attendee_ids` echo and now surfaces `message_id`). The command sends the request unchanged (`attendees_ids` plus recruiter-specific flags); it renders the server response verbatim, so no command flags change.

## [0.7.1] - 2026-07-01

### Fixed

- `recruiter message new` — the `--to` recipient ID is now sent as `attendees_ids` (plural) in the request body, matching the updated server contract. A prior version used the old `attendee_ids` (singular) field name which the API no longer accepts.

### Changed

- Updated `@curviate/sdk` dependency to `^0.6.0`.

## [0.7.0] - 2026-07-01

### Added

- `search` — named filter flags that previously required raw `--filters` JSON:
  - **companies**: `--has-job-offers`, `--headcount <buckets>` (comma-separated
    size buckets `1-10 … 5001-10000`; `10001+` reports a usage error).
  - **jobs**: `--title <ids>`, `--presence`, `--benefits`, `--commitments`,
    `--has-verifications`, `--under-10-applicants`, `--in-your-network`,
    `--fair-chance-employer`, `--location-within-area <miles>`.
  - **people**: `--connections-of`, `--followers-of` (comma-separated → array).
  - **posts**: `--posted-by-member`, `--posted-by-company`, `--posted-by-me`,
    `--mentioning-member`, `--mentioning-company`, `--author-industry`,
    `--author-company`, `--author-keywords`.

### Fixed

- `search jobs` slim `company_name` was always `null` — now derived from the
  nested `company.name` (handles postings with no linked company). `--verbose`
  still returns the raw response unchanged.
- `search parameters --type`, `search jobs --seniority`/`--job-type`, and
  `search posts --content-type` help text now lists the correct/complete
  enumerations (no behavior change).

### Changed

- Updated `@curviate/sdk` dependency to `^0.5.0`.

## [0.6.1] - 2026-07-01

### Added

- `search people --title` (→ `advanced_keywords.title` keyword, nested-merged),
  `--industry`, `--profile-language`; `--filters` deep-merge (named flags win).
- `search jobs --location` → `region` (single id) + `--region` alias +
  `--date-posted <days>` (number).
- `search posts --date-posted` hyphen→underscore normalize.
- `--all` truncation emits `{"object":"stream_truncated",…}` JSON.

### Changed

- Updated `@curviate/sdk` dependency to `^0.4.1`.

## [0.6.0] - 2026-06-30

### Added

- `inbox list --unread` — filter the inbox to chats with unread messages.
- `messages` now accepts `--before` and `--after` to page a conversation by
  timestamp window.
- `sync-chat --wait` — poll until a chat sync completes instead of returning
  immediately.
- `message new --to` and `message inmail --to` now resolve a **LinkedIn profile
  URL or vanity slug** (e.g. `linkedin.com/in/<slug>`) to the recipient, in
  addition to provider ids and member URNs.
- Thread-URL `chat_id` normalization — a pasted conversation URL is normalized to
  the underlying chat id wherever a `chat_id` is accepted.
- Write commands that take a TEXT positional accept `-` to read the value from
  stdin (pipe message bodies in).
- `connect`: slim default projection + write-flag suppression + help text
  (Invites-AX co-release).

### Changed

- Pagination flags are suppressed from the help output of non-list commands.
- Updated `@curviate/sdk` dependency to `^0.4.0` (regenerated types:
  `primary_locale` on profile, account-sync `status` field).

## [0.5.0] - 2026-06-29

### Added

- `message inmail --surface classic` — send an InMail from the account's own premium
  InMail credits (in addition to `sales_nav` and `recruiter`). Use this to reach an
  out-of-network member from a LinkedIn Premium/Core account.
- `message inmail --to` now accepts a member **provider id** (`ACoAAA…`) as well as a
  member URN (`urn:li:member:<id>`). The server resolves the recipient either way.

## [0.4.1] - 2026-06-29

### Changed

- Updated `@curviate/sdk` dependency to `^0.2.1`, which fixes `message delete` and
  `message react` failing with an unexpected `account_id` parameter rejection. The SDK
  now correctly omits `account_id` for those two operations.

## [0.4.0] - 2026-06-28

### Added

- `profile me` slim now includes `current_position` (synthesized from `work_experience[0]`
  when `--sections experience` is passed), achieving parity with `profile <id>` slim.

### Fixed

- `repository.url` in `package.json` normalized to the npm-canonical `git+https://` prefix.

## [0.3.0] - 2026-06-28

### Added

- `profile me` and `profile get` now return a slim 9-field projection by default (`id`, `first_name`, `last_name`, `headline`, `location`, `industry`, `profile_url`, `picture_url`, `current_position`); pass `--verbose` to get the full response.
- `profile get` synthesizes `current_position` from `work_experience[0]` when present.
- `profile get` and `profile me` accept `--sections` to request specific LinkedIn profile sections from the API.
- `profile get --posts --is-company` resolves a company slug to an account ID automatically (non-numeric IDs call `getCompany` first).
- `company get` now returns a slim 12-field projection by default (including `headquarters` and `messaging`); pass `--verbose` to get the full response.
- `login` persists `--base-url` to the named profile; re-login without `--base-url` preserves the existing base URL.

### Fixed

- `company` command now exits 2 with an error when `--sections` is passed (unsupported flag for that surface).
- `slimProfile` work_experience field mapping corrected (`position`→`title`, `company`→`company_name`); `is_current` now derived from `end == null`; `company_id` is always `null` (the experience-entry ID is not a company ID).

### Changed

- Updated `@curviate/sdk` dependency to `^0.2.0` (adds `getMe` `linkedin_sections`, normalized `OwnProfile`, `Chat.subject`).

## [0.2.0] - 2026-06-24

### Fixed

- `message inmail` now requires and forwards the `--surface` flag (was silently dropped).
- `connect respond` now requires and forwards `--shared-secret` (was silently dropped).
- `recruiter message new` uses the correct field name `attendee_ids` (was `attendees`).
- `recruiter job create` now forwards the full job body via JSON and scalar flags (was a no-op).

### Added

- `search` and `recruiter search` / `sales-navigator search` accept `--filters` for raw JSON filter objects and named filter flags (`--title`, `--company`, `--location`, `--school`, `--industry`) for common parameters.
- `search` and `recruiter search` / `sales-navigator search` accept `--url` (profile URL filter) and `--keywords`.

## [0.1.0] - 2026-06-22

### Added

- Initial public release — full SDK-surface parity CLI over the Curviate API.
- `curviate` root command with `--help` and `--version`.
- Global flags: `--account`, `--json`, `--fields`, `--limit`, `--cursor`, `--all`,
  `--max-pages`, `--preview`, `--base-url`, `--timeout`, `--api-key`, `--profile`.
- SDK-client factory: resolves config and constructs a `Curviate` instance.
- Lazy command loading for a fast cold start.
- White-label leak gate (`scripts/check-clean.mjs`) wired as `prepack`.
- Build-output smoke gate (`scripts/verify-dist.mjs`).
