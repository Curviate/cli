# @curviate/cli

Official command-line interface for the [Curviate API](https://docs.curviate.com).

Built for coding agents and power users: JSON output on pipes, structured exit codes,
and shell-native composition with `jq`, `xargs`, and `curl`.

## Install

**Global install** (recommended for interactive use):

```bash
npm install -g @curviate/cli
```

**One-off via npx** (no install required):

```bash
npx @curviate/cli --help
```

Requires Node.js 18 or later.

## Authentication

**Option 1 — interactive login** (stores a profile in `~/.config/curviate/`):

```bash
curviate login
```

**Option 2 — environment variable** (preferred in CI and agent loops):

```bash
export CURVIATE_API_KEY=<your-api-key>
curviate account list
```

**Option 3 — per-command flag**:

```bash
curviate --api-key <your-api-key> account list
```

> **Security note:** a key passed via `--api-key` is visible to other users on
> the machine through `ps`/process listings and is recorded in your shell
> history. Prefer `curviate login` or the `CURVIATE_API_KEY` environment
> variable; reserve `--api-key` for one-off, low-trust contexts.

Get your API key from the [Curviate dashboard](https://docs.curviate.com).

## Usage

```
curviate [command] [subcommand] [flags]

Global flags available on every command:
  --account      Target a specific account ID
  --api-key      Override the API key for this invocation
  --profile      Use a named profile from ~/.config/curviate/
  --json         Force JSON output even when stdout is a TTY
  --fields       Comma-separated list of fields to include in JSON output
  --limit        Maximum number of results to return per page
  --cursor       Pagination cursor from a previous response
  --all          Fetch all pages (streams results)
  --max-pages    Cap on the number of pages fetched with --all
  --preview      Show what would happen without sending any write request
  --base-url     Override the API base URL (for testing)
  --timeout      Request timeout in milliseconds (default: 30000)
```

For full command reference see [docs.curviate.com](https://docs.curviate.com).

## Examples

These examples show how coding agents compose the CLI in real workflows.

### 1. Find people and send connection requests

Search for matching profiles, preview the invitations, then send them once satisfied:

```bash
# Preview first — see who would be targeted
curviate search people \
  --keywords "AI engineer" \
  --location "Berlin" \
  --limit 10 \
  --preview

# Pipe IDs into connect — one request per person
curviate search people --keywords "AI engineer" --location "Berlin" --all \
  | jq -r '.id' \
  | head -5 \
  | xargs -I{} curviate connect {} --note "Hi, I'd love to connect."
```

### 2. Triage the inbox and extract unread threads

Pull the inbox as JSON, filter unread chats, and surface the most recent message from each:

```bash
curviate inbox list --json --all \
  | jq '[.[] | select(.unread == true) | {chat_id, sender: .last_message.sender, preview: .last_message.text[0:80]}]'
```

### 3. Warm up a prospect by reacting to their recent posts

Read recent posts from a profile, then react to each — useful for ambient warm-up before outreach:

```bash
PROFILE_URL="https://www.linkedin.com/in/example"

curviate profile "$PROFILE_URL" --posts --fields post_id --json \
  | jq -r '.[].post_id' \
  | xargs -I{} curviate post react {} --type LIKE
```

### 4. Check tier entitlement before a Sales Navigator sweep

Exit code `5` means the account lacks the required add-on. Branch on it in a script:

```bash
curviate sales-nav search people --keywords "VP Engineering" --json \
  || {
    code=$?
    if [ "$code" -eq 5 ]; then
      echo "Sales Navigator add-on required — upgrade at https://docs.curviate.com"
    else
      echo "Search failed with exit code $code"
      exit "$code"
    fi
  }
```

### 5. Verify an inbound webhook signature offline

Validate a webhook payload before processing it — works without a network call:

```bash
# Pipe the raw request body from stdin; pass the signature header and secret as flags
cat webhook-payload.json \
  | curviate webhook verify \
      --secret "$CURVIATE_WEBHOOK_SECRET" \
      --header "$CURVIATE_SIG_HEADER" \
      --body -
```

Exit `0` means the signature is valid and the parsed event is written to stdout as JSON.
Exit `2` means the signature is invalid or the replay window has expired.

### 6. Export all accounts to a CSV (agent-friendly pipeline)

List every connected account, select key fields, and format as CSV with `jq`:

```bash
curviate account list --all --json \
  | jq -r '["id","name","status"], (.[] | [.id, .name, .status]) | @csv' \
  > accounts.csv
```

## Exit codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | Unexpected error |
| 2 | Usage / argument error |
| 3 | Authentication or authorization failure |
| 4 | Resource not found |
| 5 | Feature requires an add-on or higher plan |

## License

MIT — see [LICENSE](LICENSE).
