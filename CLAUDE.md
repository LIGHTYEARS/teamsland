# Team AI Collaboration Platform

## Tech Stack

- Runtime: Bun
- Language: TypeScript (strict)
- Lint/Format: Biome (pre-commit hook enforced)
- Testing: Vitest
- Dashboard: rspack + React + shadcn/ui + TailwindCSS
- Doc Site: Rspress

## Code Quality Rules

- No `any` — use `unknown` + type narrowing instead
- No `!` non-null assertions — use early return or narrowing
- Max file length: 800 lines — split if approaching limit
- Max cognitive complexity per function: 15
- All imports of types must use `import type`
- No unused variables or imports
- Run `bun run lint` before committing — pre-commit hook will block violations

## Project Structure

- `apps/server` — main process entry point
- `apps/dashboard` — React frontend
- `apps/docs` — Rspress documentation site
- `packages/*` — shared libraries, each with its own package.json
- `config/` — YAML configuration files
- All packages are scoped under `@teamsland/`

## Superpowers Plugin

Install in Claude Code CLI from the teamsland directory:
```
/plugin marketplace add obra/superpowers-marketplace
/plugin install superpowers@superpowers-marketplace
```

## Conventions

- Use `node:` protocol for Node.js built-ins (e.g., `import { randomUUID } from "node:crypto"`)
- Prefer `for...of` over `.forEach()`
- Prefer `Bun.file()` / `Bun.write()` over `node:fs`
- Prefer `Bun.spawn()` over `node:child_process`
- Tests use Vitest: `bun run test` to run, `bun run test:run` for CI
