# Remove TeamMemoryStore — Unify on OpenViking

**Date:** 2026-04-26
**Status:** Approved
**Scope:** Delete the deprecated local SQLite memory system (TeamMemoryStore), keeping OpenViking as the sole memory backend.

## Context

The codebase has two independent, non-synchronized memory stores:

1. **TeamMemoryStore** — local SQLite + sqlite-vec + FTS5, with LLM-based extraction (`ExtractLoop`), hotness-decay reaper, and local embedder (Qwen3-Embedding via node-llama-cpp).
2. **OpenViking** — external vector DB server at `http://127.0.0.1:1933`, used for session archives, agent/user memories, and task resources.

These two stores never sync. Coordinator reads only from Viking; the SQLite store is effectively dead weight from a previous iteration. This spec removes it entirely with no data migration.

## What Gets Deleted

### packages/memory/src/ — 12 source files

| File | Role |
|---|---|
| `team-memory-store.ts` | SQLite + sqlite-vec + FTS5 store |
| `null-memory-store.ts` | No-op fallback for TeamMemoryStore |
| `embedder.ts` | `Embedder` interface + `LocalEmbedder` (node-llama-cpp) |
| `null-embedder.ts` | `NullEmbedder` — zero-vector fallback |
| `extract-loop.ts` | ReAct LLM loop that extracts `MemoryOperation[]` from documents |
| `ingest.ts` | SHA-256 dedup → ExtractLoop → MemoryUpdater pipeline |
| `memory-reaper.ts` | Hotness-decay + TTL-based eviction (daily timer) |
| `memory-updater.ts` | Applies create/update/delete ops from ExtractLoop |
| `retriever.ts` | L0 + vector search + FTS5 BM25 + entity-merge + hotness reranking |
| `entity-merge.ts` | Cosine-similarity deduplication |
| `lifecycle.ts` | `hotnessScore()` decay formula |
| `llm-client.ts` | `LlmClient` interface + `EXTRACT_TOOLS` + operation types |

### packages/memory/src/\_\_tests\_\_/ — 9 test files

Delete all except `viking-health-monitor.test.ts` and `viking-memory-client.test.ts`.

### apps/server/src/scheduled-tasks.ts — entire file

Both exports (`startMemoryReaper`, `startFts5Optimize`) are SQLite-memory-only.

## What Gets Modified

### packages/memory

- **`index.ts`**: Strip all non-Viking exports. Keep only `VikingMemoryClient`, `NullVikingMemoryClient`, `IVikingMemoryClient`, `VikingHealthMonitor`, and their associated types.
- **`package.json`**: Remove `node-llama-cpp`, `sqlite-vec`, `sqlite-vec-darwin-arm64` dependencies.

### packages/types

- **`memory.ts`**: Delete `AbstractMemoryStore` interface and `MemoryEntry` interface. Keep `MemoryType` union (still used for Viking namespace categorization).
- **`config.ts`**: Delete `MemoryConfig`, `StorageConfig`, `SqliteVecConfig`, `EmbeddingConfig`, `EntityMergeConfig`, `Fts5Config`. Remove `memory` and `storage` fields from `AppConfig`.
- **`index.ts`**: Remove corresponding re-exports.

### packages/config

- **`schema.ts`**: Delete `MemoryConfigSchema`, `StorageConfigSchema`, `SqliteVecSchema`, `EmbeddingSchema`, `EntityMergeSchema`, `Fts5Schema`. Remove from `AppConfigSchema`.

### config/config.json

Remove top-level `"memory"` and `"storage"` keys.

### apps/server/src/

| File | Change |
|---|---|
| `init/storage.ts` | Remove TeamMemoryStore/Embedder/Reaper init. `StorageResult` keeps only `sessionDb` + `eventDb`. |
| `init/context.ts` | Remove `MemoryUpdater`/`ExtractLoop` creation. Drop those fields from `ContextResult`. |
| `init/events.ts` | Remove `memoryStore`/`memoryUpdater`/`extractLoop` from event handler deps. |
| `init/scheduled-tasks.ts` | Remove `startMemoryReaper` and `startFts5Optimize` calls. |
| `event-handlers.ts` | Delete `scheduleMemoryIngestion()` and its call site. Remove `memoryStore`/`extractLoop`/`memoryUpdater` from `EventHandlerDeps`. |
| `llm-client.ts` | Inline `LlmClient`/`LlmMessage`/`LlmResponse`/`LlmToolDef` type definitions (previously imported from `@teamsland/memory`). |
| `main.ts` | Remove `storage.memoryStore.close()` shutdown call. Remove `storage.embedder` references. |

### packages/context

- **`assembler.ts`**: Remove `memoryStore`/`embedder` constructor params. Delete the entire §B historical-memory retrieval block (`retrieve()` call). Coordinator already gets memory context from Viking via `LiveContextLoader`.
- **`assembler.test.ts`**: Remove `FakeMemoryStore`/`FakeEmbedder` stubs and related test assertions.

### Server tests

Update any test files under `apps/server/src/__tests__/` that reference deleted fields (`memoryStore`, `extractLoop`, `memoryUpdater`, `memoryReaper`) in mock deps.

## What Stays Unchanged

The entire Viking path is untouched:

- `packages/memory/src/viking-memory-client.ts`
- `packages/memory/src/viking-health-monitor.ts`
- `apps/server/src/init/viking.ts`
- `apps/server/src/coordinator-context.ts` (`LiveContextLoader`)
- `apps/server/src/worker-handlers.ts` (`writebackToViking`)
- `apps/server/src/viking-routes.ts`
- `apps/server/src/dashboard.ts`
- `apps/server/src/init/coordinator.ts`
- `apps/server/src/init/dashboard.ts`
- `scripts/viking-init.ts`

## Verification

After all changes:

1. `bun run typecheck` passes with no errors
2. `bun run test:run` passes (remaining tests)
3. `bun run build` succeeds
4. No imports of deleted symbols remain in the codebase
