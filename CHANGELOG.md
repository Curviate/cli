# Changelog

All notable changes to `@curviate/cli` are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
Versioning follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html):
a new command or flag is a minor; a breaking command/flag/exit-code change is a major; a fix is a patch.

## [Unreleased]

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
