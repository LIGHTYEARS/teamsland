# Monorepo Scaffold Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Scaffold the teamsland Bun monorepo with 3 apps, 12 library packages, strict Biome lint, Lefthook pre-commit hooks, YAML config stubs, and CLAUDE.md guardrails.

**Architecture:** Bun workspace monorepo with `apps/` (server, dashboard, docs) and `packages/` (types, config, memory, session, meego, ingestion, context, sidecar, swarm, git, lark, observability). Each package has its own `package.json` and `tsconfig.json`. Root-level Biome enforces strict lint rules. Lefthook pre-commit hook blocks commits that violate lint or exceed 800 lines per file.

**Tech Stack:** Bun, TypeScript (strict), Biome 2.x, Vitest 3.x, Lefthook, rspack + React + shadcn/ui + TailwindCSS (dashboard), Rspress (docs)

---

## File Map

### Root configs (created in Tasks 1-2)
- `package.json` — Bun workspace root, scripts, devDependencies
- `tsconfig.json` — root TypeScript config with project references
- `biome.json` — strict lint + format rules
- `lefthook.yml` — pre-commit: biome check + 800-line file length check
- `CLAUDE.md` — AI agent coding guardrails
- `.gitignore` — node_modules, dist, data, .env, reference repos
- `.env.example` — LARK_APP_ID, LARK_APP_SECRET, MEEGO_PLUGIN_TOKEN
- `docker-compose.yml` — Jaeger only

### 12 library packages (created in Tasks 3-5)

Each follows `packages/<name>/package.json` + `packages/<name>/tsconfig.json` + `packages/<name>/src/index.ts`:

| Package | Dependencies |
|---------|-------------|
| `@teamsland/types` | (none) |
| `@teamsland/config` | types |
| `@teamsland/lark` | types |
| `@teamsland/git` | types |
| `@teamsland/session` | types |
| `@teamsland/memory` | types, session |
| `@teamsland/observability` | types, lark |
| `@teamsland/ingestion` | types |
| `@teamsland/meego` | types, lark, session |
| `@teamsland/context` | types, memory, config |
| `@teamsland/sidecar` | types, memory, lark, session |
| `@teamsland/swarm` | types, sidecar, context |

### 3 apps (created in Tasks 6-8)
- `apps/server/package.json` + `tsconfig.json` + `src/main.ts`
- `apps/dashboard/package.json` + `tsconfig.json` + `rspack.config.ts` + `tailwind.config.ts` + `postcss.config.js` + `src/index.tsx` + `src/App.tsx`
- `apps/docs/package.json` + `rspress.config.ts` + `docs/index.md`

### Config stubs (created in Task 9)
- 11 YAML files under `config/`

### Test fixtures (created in Task 9)
- `test/fixtures/corpus/.gitkeep`
- `test/fixtures/queries/.gitkeep`

---

### Task 1: Root configuration files

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `biome.json`
- Create: `lefthook.yml`
- Create: `CLAUDE.md`
- Create: `.gitignore`
- Create: `.env.example`
- Create: `docker-compose.yml`

- [ ] **Step 1: Create root `package.json`**

```json
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

- [ ] **Step 2: Create root `tsconfig.json`**

```json
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

- [ ] **Step 3: Create `biome.json`**

```json
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

- [ ] **Step 4: Create `lefthook.yml`**

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

- [ ] **Step 5: Create `CLAUDE.md`**

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

- [ ] **Step 6: Create `.gitignore`**

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

- [ ] **Step 7: Create `.env.example`**

```bash
LARK_APP_ID=cli_xxx
LARK_APP_SECRET=xxx
MEEGO_PLUGIN_TOKEN=xxx
```

- [ ] **Step 8: Create `docker-compose.yml`**

```yaml
services:
  jaeger:
    image: jaegertracing/all-in-one:latest
    ports:
      - "16686:16686"
      - "4318:4318"
```

- [ ] **Step 9: Run `bun install` to bootstrap workspace**

Run: `bun install`
Expected: `bun.lockb` created, lefthook installed automatically via postinstall.

- [ ] **Step 10: Verify lefthook is installed**

Run: `git hook list pre-commit` or `cat .git/hooks/pre-commit`
Expected: the hook file exists and references lefthook.

- [ ] **Step 11: Commit**

```bash
git add package.json tsconfig.json biome.json lefthook.yml CLAUDE.md .gitignore .env.example docker-compose.yml bun.lockb
git commit -m "chore: add root configs — workspace, tsconfig, biome, lefthook, CLAUDE.md"
```

---

### Task 2: packages/types — shared TypeScript interfaces

**Files:**
- Create: `packages/types/package.json`
- Create: `packages/types/tsconfig.json`
- Create: `packages/types/src/index.ts`

- [ ] **Step 1: Create `packages/types/package.json`**

```json
{
  "name": "@teamsland/types",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "typecheck": "tsc --noEmit"
  }
}
```

- [ ] **Step 2: Create `packages/types/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "rootDir": "./src",
    "outDir": "./dist"
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Create `packages/types/src/index.ts`**

```typescript
// @teamsland/types — shared TypeScript interfaces
// Placeholder barrel export. Interfaces will be added during Phase 1 implementation.
export {};
```

- [ ] **Step 4: Run typecheck to verify**

Run: `cd packages/types && bunx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add packages/types/
git commit -m "chore: add @teamsland/types package scaffold"
```

---

### Task 3: Leaf packages — config, lark, git, session, ingestion

These 5 packages depend only on `@teamsland/types`. Create them all in one batch.

**Files:**
- Create: `packages/config/{package.json,tsconfig.json,src/index.ts}`
- Create: `packages/lark/{package.json,tsconfig.json,src/index.ts}`
- Create: `packages/git/{package.json,tsconfig.json,src/index.ts}`
- Create: `packages/session/{package.json,tsconfig.json,src/index.ts}`
- Create: `packages/ingestion/{package.json,tsconfig.json,src/index.ts}`

- [ ] **Step 1: Create `packages/config/package.json`**

```json
{
  "name": "@teamsland/config",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts"
  },
  "dependencies": {
    "@teamsland/types": "workspace:*"
  },
  "scripts": {
    "typecheck": "tsc --noEmit"
  }
}
```

- [ ] **Step 2: Create `packages/config/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "rootDir": "./src",
    "outDir": "./dist"
  },
  "include": ["src"],
  "references": [
    { "path": "../types" }
  ]
}
```

- [ ] **Step 3: Create `packages/config/src/index.ts`**

```typescript
// @teamsland/config — YAML config loaders + RepoMapping
export {};
```

- [ ] **Step 4: Create `packages/lark/package.json`**

```json
{
  "name": "@teamsland/lark",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts"
  },
  "dependencies": {
    "@teamsland/types": "workspace:*"
  },
  "scripts": {
    "typecheck": "tsc --noEmit"
  }
}
```

- [ ] **Step 5: Create `packages/lark/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "rootDir": "./src",
    "outDir": "./dist"
  },
  "include": ["src"],
  "references": [
    { "path": "../types" }
  ]
}
```

- [ ] **Step 6: Create `packages/lark/src/index.ts`**

```typescript
// @teamsland/lark — lark-cli wrapper, LarkNotifier
export {};
```

- [ ] **Step 7: Create `packages/git/package.json`**

```json
{
  "name": "@teamsland/git",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts"
  },
  "dependencies": {
    "@teamsland/types": "workspace:*"
  },
  "scripts": {
    "typecheck": "tsc --noEmit"
  }
}
```

- [ ] **Step 8: Create `packages/git/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "rootDir": "./src",
    "outDir": "./dist"
  },
  "include": ["src"],
  "references": [
    { "path": "../types" }
  ]
}
```

- [ ] **Step 9: Create `packages/git/src/index.ts`**

```typescript
// @teamsland/git — WorktreeManager
export {};
```

- [ ] **Step 10: Create `packages/session/package.json`**

```json
{
  "name": "@teamsland/session",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts"
  },
  "dependencies": {
    "@teamsland/types": "workspace:*"
  },
  "scripts": {
    "typecheck": "tsc --noEmit"
  }
}
```

- [ ] **Step 11: Create `packages/session/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "rootDir": "./src",
    "outDir": "./dist"
  },
  "include": ["src"],
  "references": [
    { "path": "../types" }
  ]
}
```

- [ ] **Step 12: Create `packages/session/src/index.ts`**

```typescript
// @teamsland/session — SessionDB (SQLite WAL + FTS5 + compaction)
export {};
```

- [ ] **Step 13: Create `packages/ingestion/package.json`**

```json
{
  "name": "@teamsland/ingestion",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts"
  },
  "dependencies": {
    "@teamsland/types": "workspace:*"
  },
  "scripts": {
    "typecheck": "tsc --noEmit"
  }
}
```

- [ ] **Step 14: Create `packages/ingestion/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "rootDir": "./src",
    "outDir": "./dist"
  },
  "include": ["src"],
  "references": [
    { "path": "../types" }
  ]
}
```

- [ ] **Step 15: Create `packages/ingestion/src/index.ts`**

```typescript
// @teamsland/ingestion — IntentClassifier, DocumentParser
export {};
```

- [ ] **Step 16: Run typecheck across all 5 packages**

Run: `bunx tsc --build packages/config packages/lark packages/git packages/session packages/ingestion`
Expected: no errors.

- [ ] **Step 17: Commit**

```bash
git add packages/config/ packages/lark/ packages/git/ packages/session/ packages/ingestion/
git commit -m "chore: add leaf packages — config, lark, git, session, ingestion"
```

---

### Task 4: Mid-layer packages — memory, observability, meego, context

These depend on packages from Task 3.

**Files:**
- Create: `packages/memory/{package.json,tsconfig.json,src/index.ts}`
- Create: `packages/observability/{package.json,tsconfig.json,src/index.ts}`
- Create: `packages/meego/{package.json,tsconfig.json,src/index.ts}`
- Create: `packages/context/{package.json,tsconfig.json,src/index.ts}`

- [ ] **Step 1: Create `packages/memory/package.json`**

```json
{
  "name": "@teamsland/memory",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts"
  },
  "dependencies": {
    "@teamsland/types": "workspace:*",
    "@teamsland/session": "workspace:*"
  },
  "scripts": {
    "typecheck": "tsc --noEmit"
  }
}
```

- [ ] **Step 2: Create `packages/memory/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "rootDir": "./src",
    "outDir": "./dist"
  },
  "include": ["src"],
  "references": [
    { "path": "../types" },
    { "path": "../session" }
  ]
}
```

- [ ] **Step 3: Create `packages/memory/src/index.ts`**

```typescript
// @teamsland/memory — TeamMemoryStore, ExtractLoop, embedder, lifecycle
export {};
```

- [ ] **Step 4: Create `packages/observability/package.json`**

```json
{
  "name": "@teamsland/observability",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts"
  },
  "dependencies": {
    "@teamsland/types": "workspace:*",
    "@teamsland/lark": "workspace:*"
  },
  "scripts": {
    "typecheck": "tsc --noEmit"
  }
}
```

- [ ] **Step 5: Create `packages/observability/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "rootDir": "./src",
    "outDir": "./dist"
  },
  "include": ["src"],
  "references": [
    { "path": "../types" },
    { "path": "../lark" }
  ]
}
```

- [ ] **Step 6: Create `packages/observability/src/index.ts`**

```typescript
// @teamsland/observability — ObservableMessageBus, Alerter
export {};
```

- [ ] **Step 7: Create `packages/meego/package.json`**

```json
{
  "name": "@teamsland/meego",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts"
  },
  "dependencies": {
    "@teamsland/types": "workspace:*",
    "@teamsland/lark": "workspace:*",
    "@teamsland/session": "workspace:*"
  },
  "scripts": {
    "typecheck": "tsc --noEmit"
  }
}
```

- [ ] **Step 8: Create `packages/meego/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "rootDir": "./src",
    "outDir": "./dist"
  },
  "include": ["src"],
  "references": [
    { "path": "../types" },
    { "path": "../lark" },
    { "path": "../session" }
  ]
}
```

- [ ] **Step 9: Create `packages/meego/src/index.ts`**

```typescript
// @teamsland/meego — MeegoEventBus, MeegoConnector, ConfirmationWatcher
export {};
```

- [ ] **Step 10: Create `packages/context/package.json`**

```json
{
  "name": "@teamsland/context",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts"
  },
  "dependencies": {
    "@teamsland/types": "workspace:*",
    "@teamsland/memory": "workspace:*",
    "@teamsland/config": "workspace:*"
  },
  "scripts": {
    "typecheck": "tsc --noEmit"
  }
}
```

- [ ] **Step 11: Create `packages/context/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "rootDir": "./src",
    "outDir": "./dist"
  },
  "include": ["src"],
  "references": [
    { "path": "../types" },
    { "path": "../memory" },
    { "path": "../config" }
  ]
}
```

- [ ] **Step 12: Create `packages/context/src/index.ts`**

```typescript
// @teamsland/context — DynamicContextAssembler
export {};
```

- [ ] **Step 13: Run typecheck across all 4 packages**

Run: `bunx tsc --build packages/memory packages/observability packages/meego packages/context`
Expected: no errors.

- [ ] **Step 14: Commit**

```bash
git add packages/memory/ packages/observability/ packages/meego/ packages/context/
git commit -m "chore: add mid-layer packages — memory, observability, meego, context"
```

---

### Task 5: Top-layer packages — sidecar, swarm

These depend on packages from Tasks 3-4.

**Files:**
- Create: `packages/sidecar/{package.json,tsconfig.json,src/index.ts}`
- Create: `packages/swarm/{package.json,tsconfig.json,src/index.ts}`

- [ ] **Step 1: Create `packages/sidecar/package.json`**

```json
{
  "name": "@teamsland/sidecar",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts"
  },
  "dependencies": {
    "@teamsland/types": "workspace:*",
    "@teamsland/memory": "workspace:*",
    "@teamsland/lark": "workspace:*",
    "@teamsland/session": "workspace:*"
  },
  "scripts": {
    "typecheck": "tsc --noEmit"
  }
}
```

- [ ] **Step 2: Create `packages/sidecar/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "rootDir": "./src",
    "outDir": "./dist"
  },
  "include": ["src"],
  "references": [
    { "path": "../types" },
    { "path": "../memory" },
    { "path": "../lark" },
    { "path": "../session" }
  ]
}
```

- [ ] **Step 3: Create `packages/sidecar/src/index.ts`**

```typescript
// @teamsland/sidecar — ProcessController, SubagentRegistry, SidecarDataPlane
export {};
```

- [ ] **Step 4: Create `packages/swarm/package.json`**

```json
{
  "name": "@teamsland/swarm",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts"
  },
  "dependencies": {
    "@teamsland/types": "workspace:*",
    "@teamsland/sidecar": "workspace:*",
    "@teamsland/context": "workspace:*"
  },
  "scripts": {
    "typecheck": "tsc --noEmit"
  }
}
```

- [ ] **Step 5: Create `packages/swarm/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "rootDir": "./src",
    "outDir": "./dist"
  },
  "include": ["src"],
  "references": [
    { "path": "../types" },
    { "path": "../sidecar" },
    { "path": "../context" }
  ]
}
```

- [ ] **Step 6: Create `packages/swarm/src/index.ts`**

```typescript
// @teamsland/swarm — TaskPlanner, Swarm runner
export {};
```

- [ ] **Step 7: Run typecheck across both packages**

Run: `bunx tsc --build packages/sidecar packages/swarm`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add packages/sidecar/ packages/swarm/
git commit -m "chore: add top-layer packages — sidecar, swarm"
```

---

### Task 6: apps/server — main process entry point

**Files:**
- Create: `apps/server/package.json`
- Create: `apps/server/tsconfig.json`
- Create: `apps/server/src/main.ts`

- [ ] **Step 1: Create `apps/server/package.json`**

```json
{
  "name": "@teamsland/server",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "bun run --watch src/main.ts",
    "start": "bun run src/main.ts",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@teamsland/types": "workspace:*",
    "@teamsland/config": "workspace:*",
    "@teamsland/memory": "workspace:*",
    "@teamsland/session": "workspace:*",
    "@teamsland/meego": "workspace:*",
    "@teamsland/ingestion": "workspace:*",
    "@teamsland/context": "workspace:*",
    "@teamsland/sidecar": "workspace:*",
    "@teamsland/swarm": "workspace:*",
    "@teamsland/git": "workspace:*",
    "@teamsland/lark": "workspace:*",
    "@teamsland/observability": "workspace:*"
  }
}
```

- [ ] **Step 2: Create `apps/server/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "rootDir": "./src",
    "outDir": "./dist"
  },
  "include": ["src"],
  "references": [
    { "path": "../../packages/types" },
    { "path": "../../packages/config" },
    { "path": "../../packages/memory" },
    { "path": "../../packages/session" },
    { "path": "../../packages/meego" },
    { "path": "../../packages/ingestion" },
    { "path": "../../packages/context" },
    { "path": "../../packages/sidecar" },
    { "path": "../../packages/swarm" },
    { "path": "../../packages/git" },
    { "path": "../../packages/lark" },
    { "path": "../../packages/observability" }
  ]
}
```

- [ ] **Step 3: Create `apps/server/src/main.ts`**

```typescript
// @teamsland/server — main process entry point
// Startup sequence, graceful shutdown, and scheduled tasks
// will be implemented in Phase 1.
console.log("[teamsland] server starting...");
```

- [ ] **Step 4: Verify the server runs**

Run: `bun run apps/server/src/main.ts`
Expected: prints `[teamsland] server starting...`

- [ ] **Step 5: Commit**

```bash
git add apps/server/
git commit -m "chore: add @teamsland/server app scaffold"
```

---

### Task 7: apps/dashboard — React frontend

**Files:**
- Create: `apps/dashboard/package.json`
- Create: `apps/dashboard/tsconfig.json`
- Create: `apps/dashboard/rspack.config.ts`
- Create: `apps/dashboard/tailwind.config.ts`
- Create: `apps/dashboard/postcss.config.js`
- Create: `apps/dashboard/src/index.tsx`
- Create: `apps/dashboard/src/App.tsx`
- Create: `apps/dashboard/src/index.html`

- [ ] **Step 1: Create `apps/dashboard/package.json`**

```json
{
  "name": "@teamsland/dashboard",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "rspack serve",
    "build": "rspack build",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@teamsland/types": "workspace:*",
    "react": "^19.1",
    "react-dom": "^19.1"
  },
  "devDependencies": {
    "@rspack/cli": "^1.3",
    "@rspack/core": "^1.3",
    "@rspack/plugin-react-refresh": "^1.1",
    "@types/react": "^19.1",
    "@types/react-dom": "^19.1",
    "autoprefixer": "^10.4",
    "postcss": "^8.5",
    "postcss-loader": "^8.1",
    "react-refresh": "^0.16",
    "tailwindcss": "^4.1"
  }
}
```

- [ ] **Step 2: Create `apps/dashboard/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "rootDir": "./src",
    "outDir": "./dist",
    "jsx": "react-jsx",
    "types": ["bun-types"]
  },
  "include": ["src"],
  "references": [
    { "path": "../../packages/types" }
  ]
}
```

- [ ] **Step 3: Create `apps/dashboard/rspack.config.ts`**

```typescript
import { defineConfig } from "@rspack/cli";
import { rspack } from "@rspack/core";
import RefreshPlugin from "@rspack/plugin-react-refresh";

const isDev = process.env.NODE_ENV === "development";

export default defineConfig({
  entry: { main: "./src/index.tsx" },
  resolve: { extensions: [".ts", ".tsx", ".js", ".jsx"] },
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        use: {
          loader: "builtin:swc-loader",
          options: {
            jsc: {
              parser: { syntax: "typescript", tsx: true },
              transform: { react: { runtime: "automatic", development: isDev, refresh: isDev } },
            },
          },
        },
      },
      {
        test: /\.css$/,
        use: ["postcss-loader"],
        type: "css",
      },
    ],
  },
  plugins: [
    new rspack.HtmlRspackPlugin({ template: "./src/index.html" }),
    isDev && new RefreshPlugin(),
  ].filter(Boolean),
  devServer: { port: 5173, hot: true },
});
```

- [ ] **Step 4: Create `apps/dashboard/tailwind.config.ts`**

```typescript
import type { Config } from "tailwindcss";

export default {
  content: ["./src/**/*.{ts,tsx}"],
} satisfies Config;
```

- [ ] **Step 5: Create `apps/dashboard/postcss.config.js`**

```javascript
export default {
  plugins: {
    "@tailwindcss/postcss": {},
    autoprefixer: {},
  },
};
```

- [ ] **Step 6: Create `apps/dashboard/src/index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Teamsland Dashboard</title>
  </head>
  <body>
    <div id="root"></div>
  </body>
</html>
```

- [ ] **Step 7: Create `apps/dashboard/src/index.tsx`**

```tsx
import { createRoot } from "react-dom/client";
import { App } from "./App";

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(<App />);
}
```

- [ ] **Step 8: Create `apps/dashboard/src/App.tsx`**

```tsx
export function App() {
  return (
    <div>
      <h1>Teamsland Dashboard</h1>
      <p>Agent monitoring and control panel.</p>
    </div>
  );
}
```

- [ ] **Step 9: Create `apps/dashboard/src/components/.gitkeep`**

```bash
mkdir -p apps/dashboard/src/components
touch apps/dashboard/src/components/.gitkeep
```

- [ ] **Step 10: Commit**

```bash
git add apps/dashboard/
git commit -m "chore: add @teamsland/dashboard app scaffold — rspack + React + TailwindCSS"
```

---

### Task 8: apps/docs — Rspress documentation site

**Files:**
- Create: `apps/docs/package.json`
- Create: `apps/docs/rspress.config.ts`
- Create: `apps/docs/docs/index.md`

- [ ] **Step 1: Create `apps/docs/package.json`**

```json
{
  "name": "@teamsland/docs",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "rspress dev",
    "build": "rspress build"
  },
  "devDependencies": {
    "rspress": "^2.0"
  }
}
```

- [ ] **Step 2: Create `apps/docs/rspress.config.ts`**

```typescript
import { defineConfig } from "rspress/config";

export default defineConfig({
  root: "docs",
  title: "Teamsland",
  description: "Team AI Collaboration Platform — Architecture & API Documentation",
  themeConfig: {
    sidebar: {
      "/": [
        { text: "Introduction", link: "/index" },
      ],
    },
  },
});
```

- [ ] **Step 3: Create `apps/docs/docs/index.md`**

```markdown
# Teamsland

Team AI Collaboration Platform — architecture documentation and API reference.

See the [design docs](../../docs/README.md) for the full architecture specification.
```

- [ ] **Step 4: Commit**

```bash
git add apps/docs/
git commit -m "chore: add @teamsland/docs app scaffold — Rspress"
```

---

### Task 9: Config YAML stubs + test fixtures

**Files:**
- Create: `config/session.yaml`
- Create: `config/lark.yaml`
- Create: `config/sidecar.yaml`
- Create: `config/confirmation.yaml`
- Create: `config/storage.yaml`
- Create: `config/repo_mapping.yaml`
- Create: `config/meego.yaml`
- Create: `config/memory.yaml`
- Create: `config/skill_routing.yaml`
- Create: `config/dashboard.yaml`
- Create: `config/test.yaml`
- Create: `test/fixtures/corpus/.gitkeep`
- Create: `test/fixtures/queries/.gitkeep`

- [ ] **Step 1: Create `config/session.yaml`**

```yaml
session:
  compaction_token_threshold: 80000
  sqlite_jitter_range_ms: [20, 150]
  busy_timeout_ms: 5000
```

- [ ] **Step 2: Create `config/lark.yaml`**

```yaml
lark:
  app_id: "${LARK_APP_ID}"
  app_secret: "${LARK_APP_SECRET}"
  bot:
    history_context_count: 20
  notification:
    team_channel_id: ""
```

- [ ] **Step 3: Create `config/sidecar.yaml`**

```yaml
sidecar:
  max_concurrent_sessions: 20
  max_retry_count: 3
  max_delegate_depth: 2
  worker_timeout_seconds: 300
  health_check_timeout_ms: 30000
  min_swarm_success_ratio: 0.5
```

- [ ] **Step 4: Create `config/confirmation.yaml`**

```yaml
confirmation:
  reminder_interval_min: 30
  max_reminders: 3
  poll_interval_ms: 60000
```

- [ ] **Step 5: Create `config/storage.yaml`**

```yaml
storage:
  sqlite_vec:
    db_path: "./data/memory.sqlite"
    busy_timeout_ms: 5000
    vector_dimensions: 512
  embedding:
    model: "hf:Qwen/Qwen3-Embedding-0.6B-GGUF/Qwen3-Embedding-0.6B-Q8_0.gguf"
    context_size: 2048
  entity_merge:
    cosine_threshold: 0.95
  fts5:
    optimize_interval_hours: 24
```

- [ ] **Step 6: Create `config/repo_mapping.yaml`**

```yaml
repo_mapping:
  - meego_project_id: "project_xxx"
    repos:
      - path: "/home/user/repos/frontend-main"
        name: "前端主仓库"
      - path: "/home/user/repos/frontend-components"
        name: "组件库"
  - meego_project_id: "project_yyy"
    repos:
      - path: "/home/user/repos/admin-portal"
        name: "管理后台"
```

- [ ] **Step 7: Create `config/meego.yaml`**

```yaml
meego:
  spaces:
    - space_id: "xxx"
      name: "开放平台前端"
    - space_id: "yyy"
      name: "开放平台基础"
  event_mode: "both"
  webhook:
    host: "0.0.0.0"
    port: 8080
    path: "/meego/webhook"
  poll:
    interval_seconds: 60
    lookback_minutes: 5
  long_connection:
    enabled: true
    reconnect_interval_seconds: 10
```

- [ ] **Step 8: Create `config/memory.yaml`**

```yaml
memory:
  decay_half_life_days: 30
  extract_loop_max_iterations: 3
```

- [ ] **Step 9: Create `config/skill_routing.yaml`**

```yaml
skill_routing:
  frontend_dev:
    - figma-reader
    - lark-docs
    - git-tools
    - architect-template
  code_review:
    - git-diff
    - lark-comment
  bot_query:
    - lark-docs
    - lark-base
```

- [ ] **Step 10: Create `config/dashboard.yaml`**

```yaml
dashboard:
  port: 3000
  auth:
    provider: "lark_oauth"
    session_ttl_hours: 8
    allowed_departments: []
```

- [ ] **Step 11: Create `config/test.yaml`**

```yaml
test:
  memory_corpus_path: "test/fixtures/corpus/"
  memory_queries_path: "test/fixtures/queries/"
  precision_threshold: 0.8
  sidecar_recovery_timeout_ms: 60000
  concurrent_write_agents: 10
```

- [ ] **Step 12: Create test fixture directories**

```bash
mkdir -p test/fixtures/corpus test/fixtures/queries
touch test/fixtures/corpus/.gitkeep test/fixtures/queries/.gitkeep
```

- [ ] **Step 13: Commit**

```bash
git add config/ test/
git commit -m "chore: add 11 YAML config stubs + test fixture directories"
```

---

### Task 10: Install dependencies + full verification

- [ ] **Step 1: Run `bun install` from repo root**

Run: `bun install`
Expected: all workspace packages resolved, `bun.lockb` updated, lefthook postinstall runs.

- [ ] **Step 2: Verify workspace packages are linked**

Run: `bun pm ls --all 2>&1 | head -30`
Expected: all `@teamsland/*` packages listed with `workspace:*` resolution.

- [ ] **Step 3: Run root typecheck**

Run: `bunx tsc --build`
Expected: no errors. All 14 tsconfig references (12 packages + 2 apps with tsconfig) resolve.

- [ ] **Step 4: Run biome lint on entire repo**

Run: `bun run lint`
Expected: no errors. All `src/index.ts` files pass strict rules (they only contain `export {}` which is clean).

- [ ] **Step 5: Verify pre-commit hook works — create a deliberately bad file**

Create a temporary file `packages/types/src/bad.ts`:
```typescript
const x: any = 123;
```

Run:
```bash
git add packages/types/src/bad.ts
git commit -m "test: should be blocked by pre-commit"
```
Expected: commit is blocked by biome with `noExplicitAny` error.

Clean up:
```bash
git restore --staged packages/types/src/bad.ts
rm packages/types/src/bad.ts
```

- [ ] **Step 6: Verify file length check — create a deliberately long file**

Create a temporary file `packages/types/src/long.ts` with 801+ lines:
```bash
python3 -c "print('export {};\n' + '// line\n' * 801)" > packages/types/src/long.ts
```

Run:
```bash
git add packages/types/src/long.ts
git commit -m "test: should be blocked by file-length check"
```
Expected: commit is blocked with `ERROR: packages/types/src/long.ts has 80X lines (max 800). Split it.`

Clean up:
```bash
git restore --staged packages/types/src/long.ts
rm packages/types/src/long.ts
```

- [ ] **Step 7: Verify server runs**

Run: `bun run apps/server/src/main.ts`
Expected: prints `[teamsland] server starting...`

- [ ] **Step 8: Final commit with lockfile**

```bash
git add bun.lockb package.json
git commit -m "chore: update lockfile after full dependency install"
```

---

### Task 11: Final directory structure verification

- [ ] **Step 1: Print and verify the full tree**

Run:
```bash
find . -not -path './node_modules/*' -not -path './.git/*' -not -path './hermes-agent/*' -not -path './multica/*' -not -path './OpenViking/*' -not -path './qmd/*' -not -path './docs/0*' -not -path './docs/R*' -not -name 'bun.lockb' -not -name 'JOURNAL.md' | sort
```

Expected structure matches the spec:
- `./apps/server/`, `./apps/dashboard/`, `./apps/docs/`
- `./packages/types/`, `./packages/config/`, ... (12 packages)
- `./config/` (11 YAML files)
- `./test/fixtures/corpus/.gitkeep`, `./test/fixtures/queries/.gitkeep`
- Root: `package.json`, `tsconfig.json`, `biome.json`, `lefthook.yml`, `CLAUDE.md`, `.gitignore`, `.env.example`, `docker-compose.yml`

- [ ] **Step 2: Count packages**

Run: `ls packages/ | wc -l`
Expected: 12

Run: `ls apps/ | wc -l`
Expected: 3

Run: `ls config/*.yaml | wc -l`
Expected: 11

Scaffold is complete.
