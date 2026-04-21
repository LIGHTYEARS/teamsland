// @teamsland/memory — TeamMemoryStore, ExtractLoop, embedder, lifecycle
// 团队记忆系统：向量检索 + FTS5 + 本地 Embedding + ReAct 提取 + 热度衰减回收

// 接口
export type { Embedder } from "./embedder.js";
// 类
export { LocalEmbedder } from "./embedder.js";
export { cosineSimilarity, entityMerge } from "./entity-merge.js";
export type { ExtractLoopOpts } from "./extract-loop.js";
export { ExtractLoop } from "./extract-loop.js";
export { ingestDocument } from "./ingest.js";
// 函数
export { hotnessScore } from "./lifecycle.js";
export type {
  LlmClient,
  LlmMessage,
  LlmResponse,
  LlmToolCall,
  LlmToolDef,
  MemoryOperation,
  MemoryOperationType,
} from "./llm-client.js";
// 常量
export { EXTRACT_TOOLS } from "./llm-client.js";
export { MemoryReaper } from "./memory-reaper.js";
export { MemoryUpdater } from "./memory-updater.js";
export { NullEmbedder } from "./null-embedder.js";
export { NullMemoryStore } from "./null-memory-store.js";
export { retrieve } from "./retriever.js";
export { TeamMemoryStore } from "./team-memory-store.js";
