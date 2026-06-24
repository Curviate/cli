# Changelog

All notable changes to `@curviate/cli` are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
Versioning follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html):
a new command or flag is a minor; a breaking command/flag/exit-code change is a major; a fix is a patch.

## [Unreleased]

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
