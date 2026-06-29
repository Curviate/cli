# Changelog

All notable changes to `@curviate/cli` are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
Versioning follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html):
a new command or flag is a minor; a breaking command/flag/exit-code change is a major; a fix is a patch.

## [Unreleased]

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
