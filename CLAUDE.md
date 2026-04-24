# Teamsland

Bun monorepo (apps + packages) — an AI-powered team collaboration platform integrating Lark, Meego, and long-term memory.

## Quick Start

```bash
# Install dependencies
bun install

# Start all services (requires overmind + tmux)
bun run dev
```

This runs `overmind start -f Procfile.dev`, which launches three services:

| Service     | What it does                         | Port  |
|-------------|--------------------------------------|-------|
| `viking`    | OpenViking vector DB for memory      | 1933  |
| `server`    | Backend API (Bun + Hono)             | 3001  |
| `dashboard` | Frontend dev server (Rspack)         | 5173  |

### Prerequisites

- **Bun** — JS runtime and package manager
- **overmind** — Procfile-based process manager (`brew install overmind`)
- **tmux** — required by overmind (`brew install tmux`)
- **openviking-server** — vector DB binary (`pip install openviking-cli`)
- **.env** file at project root with all required environment variables (see below)

### Environment Variables (.env)

| Variable                    | Purpose                                      |
|-----------------------------|----------------------------------------------|
| `LARK_APP_ID`              | Lark app credentials                          |
| `LARK_APP_SECRET`          | Lark app credentials                          |
| `LARK_TEAM_CHANNEL_ID`    | Default team notification channel              |
| `MEEGO_WEBHOOK_SECRET`    | Webhook signature verification                 |
| `MEEGO_PLUGIN_ACCESS_TOKEN`| Meego plugin auth (`X-PLUGIN-TOKEN` header)   |
| `MEEGO_USER_KEY`          | Meego user identity (`X-USER-KEY` header)      |
| `ANTHROPIC_AUTH_TOKEN`    | LLM API key                                    |
| `ANTHROPIC_MODEL`         | LLM model ID                                   |
| `ANTHROPIC_BASE_URL`      | LLM API base URL                               |

### Running Individual Services

```bash
bun run dev:server      # backend only
bun run dev:dashboard   # frontend only
```

### Overmind Commands

```bash
overmind connect server     # attach to a specific service's tmux pane
overmind restart server     # restart a single service
overmind stop dashboard     # stop a single service
overmind quit               # stop everything
```

## Project Structure

```
apps/
  server/       — Backend API (@teamsland/server), port 3001
  dashboard/    — Frontend UI (@teamsland/dashboard), port 5173
  docs/         — Documentation site (@teamsland/docs)
packages/
  config/       — Shared config loader (reads config/config.json + .env)
  meego/        — Meego integration (event bus, connector, client)
  lark/         — Lark bot and messaging
  memory/       — Long-term memory extraction and storage
  session/      — Conversation session management
  swarm/        — Multi-agent orchestration
  sidecar/      — Sidecar worker processes
  context/      — Context building for LLM
  hooks/        — Hook system for coordinator
  queue/        — SQLite-backed task queue
  ingestion/    — Data ingestion pipeline
  git/          — Git operations
  observability/— Logging and metrics
  types/        — Shared TypeScript types
  cli/          — CLI tools
  ui/           — Shared UI components
config/
  config.json     — Main app config (env var placeholders resolved at runtime)
  openviking.conf — OpenViking server config
```

## Common Commands

```bash
bun run build          # build all packages
bun run test           # run tests (vitest, watch mode)
bun run test:run       # run tests once
bun run typecheck      # type-check all packages
bun run lint           # lint with Biome
bun run lint:fix       # auto-fix lint issues
```

## UI Verification

When completing UI/frontend changes, use `/screenshot-to-feishu` to capture the affected pages at 1920x1080 and send screenshots to Feishu for remote verification. This enables async review without requiring the reviewer to operate a browser.

## Troubleshooting

**Port already in use** — Kill stale processes before restarting:
```bash
lsof -ti:5173 | xargs kill -9   # dashboard
lsof -ti:3001 | xargs kill -9   # server
lsof -ti:1933 | xargs kill -9   # viking
```

**Viking health check fails** — Server starts fine without Viking (falls back to `NullVikingMemoryClient`), but memory features won't work. Ensure `openviking-server` is installed and `config/openviking.conf` is correct.

**`环境变量未定义: XXX`** — A required env var is missing from `.env`. Check the table above and ensure all variables are set.
