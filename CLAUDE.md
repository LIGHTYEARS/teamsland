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
