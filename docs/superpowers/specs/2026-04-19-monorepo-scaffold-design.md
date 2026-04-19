# Monorepo Scaffold Design Spec

> Date: 2026-04-19
> Status: Approved

## Overview

Scaffold the teamsland monorepo from scratch. The repo currently contains only design docs (`docs/`) and a root `README.md`. This spec defines the complete directory structure, workspace configuration, toolchain setup, lint guardrails, pre-commit hooks, and package dependency graph.

**Scope**: Structure and configuration only. No business logic code — each package gets an empty `src/index.ts` barrel export.

## Tech Stack

| Concern | Choice |
|---------|--------|
| Runtime | Bun (latest stable) |
| Language | TypeScript (strict) |
| Lint & Format | Biome 2.x |
| Testing | Vitest 3.x |
| Pre-commit | Lefthook |
| Dashboard Frontend | rspack + swc + React + shadcn/ui + TailwindCSS |
| Doc Site | Rspress |
| Observability | OpenTelemetry + self-hosted Jaeger |
| DB | SQLite WAL + FTS5 + sqlite-vec (all via `bun:sqlite`) |
| Package scope | `@teamsland/*` |

## Directory Structure

```
teamsland/
├── apps/
│   ├── server/                    # main process entry point
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       └── main.ts
│   ├── dashboard/                 # React frontend
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── rspack.config.ts
│   │   ├── tailwind.config.ts
│   │   ├── postcss.config.js
│   │   └── src/
│   │       ├── index.tsx
│   │       ├── App.tsx
│   │       └── components/
│   └── docs/                      # Rspress doc site
│       ├── package.json
│       ├── rspress.config.ts
│       └── docs/                  # markdown source
│
├── packages/
│   ├── types/                     # shared TypeScript interfaces
│   ├── config/                    # YAML loaders + RepoMapping
│   ├── memory/                    # TeamMemoryStore, ExtractLoop, embedder, lifecycle
│   ├── session/                   # SessionDB (SQLite WAL + FTS5 + compaction)
│   ├── meego/                     # MeegoEventBus, MeegoConnector, ConfirmationWatcher
│   ├── ingestion/                 # IntentClassifier, DocumentParser
│   ├── context/                   # DynamicContextAssembler
│   ├── sidecar/                   # ProcessController, SubagentRegistry, SidecarDataPlane
│   ├── swarm/                     # TaskPlanner, Swarm runner
│   ├── git/                       # WorktreeManager
│   ├── lark/                      # lark-cli wrapper, LarkNotifier
│   └── observability/             # ObservableMessageBus, Alerter
│
├── config/                        # 11 YAML config stubs
│   ├── session.yaml
│   ├── lark.yaml
│   ├── sidecar.yaml
│   ├── confirmation.yaml
│   ├── storage.yaml
│   ├── repo_mapping.yaml
│   ├── meego.yaml
│   ├── memory.yaml
│   ├── skill_routing.yaml
│   ├── dashboard.yaml
│   └── test.yaml
│
├── test/
│   └── fixtures/
│       ├── corpus/                # test corpora
│       └── queries/               # test queries + expected results
│
├── docker-compose.yml             # Jaeger only
├── .env.example
├── .gitignore
├── CLAUDE.md
├── package.json                   # Bun workspace root
├── tsconfig.json                  # root tsconfig (paths + references)
├── biome.json                     # lint + format
└── lefthook.yml                   # pre-commit hooks
```

### Package Internal Structure

Every package under `packages/` follows this uniform layout:

```
packages/<name>/
├── package.json          # name: @teamsland/<name>
├── tsconfig.json         # extends root
└── src/
    └── index.ts          # barrel export (empty placeholder)
```

## Package Dependency Graph

```
@teamsland/types          ← zero dependencies; all other packages depend on it
    ▲
    ├── @teamsland/config     ← types
    ├── @teamsland/lark       ← types
    ├── @teamsland/git        ← types
    │
    ├── @teamsland/session       ← types
    ├── @teamsland/memory        ← types, session
    ├── @teamsland/observability ← types, lark
    │
    ├── @teamsland/ingestion  ← types
    ├── @teamsland/meego      ← types, lark, session
    ├── @teamsland/context    ← types, memory, config
    │
    ├── @teamsland/sidecar    ← types, memory, lark, session
    ├── @teamsland/swarm      ← types, sidecar, context
    │
    ├── @teamsland/server     ← all packages (assembly entry point)
    ├── @teamsland/dashboard  ← types only (data via WebSocket, no backend imports)
    └── @teamsland/docs       ← no package dependencies (standalone Rspress site)
```

Each package declares only its direct dependencies. No transitive leaking.

## Root Configuration Files

### package.json

```jsonc
{
  "name": "teamsland",
  "private": true,
  "workspaces": ["apps/*", "packages/*"],
  "scripts": {
    "dev": "bun run --filter @teamsland/server dev",
    "dev:dashboard": "bun run --filter @teamsland/dashboard dev",
    "dev:docs": "bun run --filter @teamsland/docs dev",
    "build": "bun run --filter '*' build",
    "lint": "biome check .",
    "lint:fix": "biome check --write .",
    "format": "biome format --write .",
    "test": "vitest",
    "test:run": "vitest run",
    "test:coverage": "vitest run --coverage",
    "typecheck": "tsc --build"
  },
  "devDependencies": {
    "@biomejs/biome": "^2.0",
    "lefthook": "^1.11",
    "typescript": "^5.8",
    "vitest": "^3.2"
  }
}
```

### tsconfig.json

```jsonc
{
  "compilerOptions": {
    "strict": true,
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "composite": true,
    "types": ["bun-types"]
  },
  "references": [
    { "path": "packages/types" },
    { "path": "packages/config" },
    { "path": "packages/memory" },
    { "path": "packages/session" },
    { "path": "packages/meego" },
    { "path": "packages/ingestion" },
    { "path": "packages/context" },
    { "path": "packages/sidecar" },
    { "path": "packages/swarm" },
    { "path": "packages/git" },
    { "path": "packages/lark" },
    { "path": "packages/observability" },
    { "path": "apps/server" },
    { "path": "apps/dashboard" }
  ]
}
```

Each sub-package tsconfig:

```jsonc
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "rootDir": "./src",
    "outDir": "./dist"
  },
  "include": ["src"],
  "references": [
    // only direct dependencies listed here
  ]
}
```

### biome.json

```jsonc
{
  "$schema": "https://biomejs.dev/schemas/2.0.x/schema.json",
  "vcs": {
    "enabled": true,
    "clientKind": "git",
    "useIgnoreFile": true
  },
  "formatter": {
    "enabled": true,
    "indentStyle": "space",
    "indentWidth": 2,
    "lineWidth": 120
  },
  "linter": {
    "enabled": true,
    "rules": {
      "recommended": true,
      "suspicious": {
        "noExplicitAny": "error",
        "noConfusingVoidType": "error"
      },
      "complexity": {
        "noExcessiveCognitiveComplexity": {
          "level": "error",
          "options": { "maxAllowedComplexity": 15 }
        },
        "noForEach": "warn",
        "useFlatMap": "error"
      },
      "style": {
        "noNonNullAssertion": "error",
        "useConst": "error",
        "useExportType": "error",
        "useImportType": "error",
        "noParameterAssign": "error",
        "useNodejsImportProtocol": "error"
      },
      "correctness": {
        "noUnusedVariables": "error",
        "noUnusedImports": "error",
        "useExhaustiveDependencies": "warn"
      },
      "security": {
        "noDangerouslySetInnerHtml": "error"
      }
    }
  },
  "overrides": [
    {
      "includes": ["*.test.ts", "*.spec.ts", "test/**"],
      "linter": {
        "rules": {
          "suspicious": {
            "noExplicitAny": "warn"
          }
        }
      }
    }
  ],
  "files": {
    "ignore": [
      "node_modules",
      "dist",
      "data",
      ".worktrees",
      "hermes-agent",
      "multica",
      "OpenViking",
      "qmd"
    ]
  }
}
```

Key rules rationale:

| Rule | Level | Why |
|------|-------|-----|
| `noExplicitAny` | error | any bypasses type system; AI agents abuse it as shortcut |
| `noNonNullAssertion` | error | `!` hides null risks; force narrowing or early return |
| `noExcessiveCognitiveComplexity` ≤ 15 | error | complex functions must be split |
| `noUnusedVariables/Imports` | error | prevent dead code accumulation |
| `useImportType / useExportType` | error | ensure type-only imports produce no runtime code |
| `noParameterAssign` | error | prevent mutation surprises |
| `useNodejsImportProtocol` | error | `node:fs` not `fs` — explicit, Bun-friendly |
| `lineWidth: 120` | formatter | reasonable limit; prevents infinite horizontal growth |

Test files (`*.test.ts`, `*.spec.ts`) relax `noExplicitAny` to `warn` — test helpers sometimes need flexible types.

### lefthook.yml

```yaml
pre-commit:
  commands:
    biome-check:
      glob: "*.{ts,tsx,js,jsx,json,jsonc}"
      run: bunx @biomejs/biome check --no-errors-on-unmatched --files-ignore-unknown=true {staged_files}
    file-length:
      glob: "*.{ts,tsx}"
      run: |
        for f in {staged_files}; do
          lines=$(wc -l < "$f")
          if [ "$lines" -gt 800 ]; then
            echo "ERROR: $f has $lines lines (max 800). Split it."
            exit 1
          fi
        done
```

Pre-commit workflow:
1. `bun install` triggers lefthook postinstall → git hook installed automatically
2. Every `git commit` → lefthook runs biome check on staged files + file length check
3. Any failure → non-zero exit → commit blocked
4. Developer runs `bun run lint:fix` to auto-fix, then re-commits

## CLAUDE.md

```markdown
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

## Conventions

- Use `node:` protocol for Node.js built-ins (e.g., `import { randomUUID } from "node:crypto"`)
- Prefer `for...of` over `.forEach()`
- Prefer `Bun.file()` / `Bun.write()` over `node:fs`
- Prefer `Bun.spawn()` over `node:child_process`
- Tests use Vitest: `bun run test` to run, `bun run test:run` for CI
```

## Infrastructure Files

### docker-compose.yml

```yaml
services:
  jaeger:
    image: jaegertracing/all-in-one:latest
    ports:
      - "16686:16686"
      - "4318:4318"
```

### .env.example

```bash
LARK_APP_ID=cli_xxx
LARK_APP_SECRET=xxx
MEEGO_PLUGIN_TOKEN=xxx
```

### .gitignore

```
node_modules/
dist/
data/
.worktrees/
.env
*.log

# reference repos (untracked, used for porting only)
hermes-agent/
multica/
OpenViking/
qmd/
```

## Config YAML Stubs

11 files under `config/`, content sourced from `docs/08-tech-stack-and-references.md`:

| File | Content source |
|------|---------------|
| `session.yaml` | docs/08 session config (minus removed `tmux_retention_days`) |
| `lark.yaml` | docs/08 lark config |
| `sidecar.yaml` | docs/08 sidecar config (minus removed `log_rotation`) |
| `confirmation.yaml` | docs/08 confirmation config |
| `storage.yaml` | docs/08 storage config (sqlite-vec + embedding + entity_merge + fts5) |
| `repo_mapping.yaml` | docs/08 repo_mapping config |
| `meego.yaml` | docs/04 meego config (minus removed `dedup_window_seconds`) |
| `memory.yaml` | minimal stub: `memory: { decay_half_life_days: 30 }` |
| `skill_routing.yaml` | docs/03 skill_routing config |
| `dashboard.yaml` | docs/07 dashboard config |
| `test.yaml` | docs/09 test config |

## Test Directory

```
test/
└── fixtures/
    ├── corpus/       # .gitkeep (populated during Phase 1)
    └── queries/      # .gitkeep (populated during Phase 1)
```

## Summary

| Category | Count | Contents |
|----------|-------|----------|
| Apps | 3 | server, dashboard, docs |
| Packages | 12 | types, config, memory, session, meego, ingestion, context, sidecar, swarm, git, lark, observability |
| Root configs | 6 | package.json, tsconfig.json, biome.json, lefthook.yml, CLAUDE.md, .gitignore |
| Infra | 2 | docker-compose.yml, .env.example |
| Config stubs | 11 | YAML files in config/ |
| Test dirs | 2 | corpus/, queries/ (with .gitkeep) |
| Pre-commit | 2 checks | biome lint + 800-line file length |
