# Team AI Collaboration Platform

## Tech Stack

- Runtime: Bun
- Language: TypeScript (strict)
- Lint/Format: Biome (pre-commit hook enforced)
- Testing: Vitest
- Dashboard: rspack + React + shadcn/ui + TailwindCSS
- Doc Site: Rspress

## Quick Start

```bash
bash scripts/start.sh              # 默认启动 server + dashboard
bash scripts/start.sh all          # 全量启动 server + dashboard + docs + jaeger + openviking
bash scripts/start.sh server       # 仅启动 server
bash scripts/start.sh dashboard    # 仅启动 dashboard
bash scripts/start.sh docs         # 仅启动 docs site
bash scripts/start.sh jaeger       # 仅启动 jaeger tracing
bash scripts/start.sh openviking   # 仅启动 OpenViking 记忆服务
```

## Services & Ports

| 服务        | 端口  | 说明                                |
| ----------- | ----- | ----------------------------------- |
| Server API  | 3001  | Bun HTTP + WebSocket，主进程        |
| Dashboard   | 5173  | Rspack dev server，代理 API 到 3001 |
| Docs        | 3008  | Rspress 文档站                      |
| OpenViking  | 1933  | 记忆服务 (Python FastAPI)           |
| Jaeger UI   | 16686 | Tracing 可视化 (Docker)             |
| Jaeger OTLP | 4318  | OpenTelemetry 采集端点              |

## Code Quality Rules

- Main-branch iteration is the project strategy; agents may commit directly to `main`.
- No `any` — use `unknown` + type narrowing instead
- No `!` non-null assertions — use early return or narrowing
- Max file length: 800 lines — split if approaching limit
- Max cognitive complexity per function: 15
- All imports of types must use `import type`
- No unused variables or imports
- Run `bun run lint` before committing — pre-commit hook will block violations

## Project Structure

- `apps/server` — main process entry point (port 3001)
- `apps/dashboard` — React frontend (dev port 5173)
- `apps/docs` — Rspress documentation site (port 3008)
- `packages/*` — shared libraries, each with its own package.json
- `config/` — JSON configuration files
- `scripts/` — 启动与运维脚本
- `data/` — SQLite 持久化数据（运行时生成）
- All packages are scoped under `@teamsland/`

## Documentation

- All exported functions, classes, and interfaces MUST have JSDoc comments written primarily in Chinese
- Every JSDoc MUST include at least one `@example` block with runnable code
- Internal helpers may omit JSDoc, but any function called across package boundaries requires it

## Error Handling

- Never dismiss errors as "pre-existing" — either fix systematically or escalate to the user for a decision
- If an error surfaces during your work, you own it: triage, fix, or ask — never route around it silently

## Test Coverage Discipline

- When tests pass and there are no compile/lint errors BUT the feature does not work at runtime: after fixing, reflect on whether unit test coverage is insufficient and whether integration tests or e2e tests should be added
- Passing tests with broken functionality is a test gap — close it before moving on

## Observability-First

- Structured logging (`@teamsland/observability`) is core infrastructure — it must be set up early and used everywhere
- Every package must log key operations (startup, errors, retries, external calls) via the shared logger — no bare `console.log`
- Observability is not an afterthought; treat it as a dependency on par with `@teamsland/types`

## Conventions

- Use `node:` protocol for Node.js built-ins (e.g., `import { randomUUID } from "node:crypto"`)
- Prefer `for...of` over `.forEach()`
- Prefer `Bun.file()` / `Bun.write()` over `node:fs`
- Prefer `Bun.spawn()` over `node:child_process`
- Tests use Vitest: `bun run test` to run, `bun run test:run` for CI

**CRITICAL**: The `write` tool is prone to formatting errors with large text blocks. Always chunk the content, append using `cat <<EOF` style heredocs, and confirm integrity with `read`.
