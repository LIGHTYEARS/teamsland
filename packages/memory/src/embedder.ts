import type { EmbeddingConfig } from "@teamsland/types";

/**
 * Embedding 生成器接口
 *
 * 抽象向量嵌入生成，允许测试中注入 FakeEmbedder。
 * 真实实现 LocalEmbedder 使用 node-llama-cpp 加载本地 Qwen3 GGUF 模型。
 *
 * @example
 * ```typescript
 * import type { Embedder } from "@teamsland/memory";
 *
 * async function getVector(embedder: Embedder, text: string): Promise<number[]> {
 *   await embedder.init();
 *   return embedder.embed(text);
 * }
 * ```
 */
export interface Embedder {
  /** 初始化模型（首次调用时加载） */
  init(): Promise<void>;
  /** 生成单条文本的 embedding 向量 */
  embed(text: string): Promise<number[]>;
  /** 批量生成 embedding 向量 */
  embedBatch(texts: string[]): Promise<number[][]>;
}

/**
 * 本地 Embedding 生成器
 *
 * 基于 node-llama-cpp 的 Qwen3-Embedding GGUF 模型实现。
 * 首次 `init()` 时懒加载模型（约 630MB，自动从 HuggingFace 下载）。
 * Qwen3 查询格式: `Instruct: Retrieve relevant documents for the query\nQuery: ${text}`
 *
 * @example
 * ```typescript
 * import { LocalEmbedder } from "@teamsland/memory";
 * import type { EmbeddingConfig } from "@teamsland/types";
 *
 * const config: EmbeddingConfig = {
 *   model: "hf:Qwen/Qwen3-Embedding-0.6B-GGUF/Qwen3-Embedding-0.6B-Q8_0.gguf",
 *   contextSize: 2048,
 * };
 * const embedder = new LocalEmbedder(config);
 * await embedder.init();
 * const vector = await embedder.embed("团队会议纪要");
 * console.log(vector.length); // 512
 * ```
 */
export class LocalEmbedder implements Embedder {
  private ctx: unknown = null;
  private readonly config: EmbeddingConfig;

  constructor(config: EmbeddingConfig) {
    this.config = config;
  }

  /**
   * 初始化模型
   *
   * 首次调用时下载并加载 GGUF 模型。后续调用为无操作。
   *
   * @example
   * ```typescript
   * const embedder = new LocalEmbedder(config);
   * await embedder.init();
   * ```
   */
  async init(): Promise<void> {
    if (this.ctx) return;
    const { getLlama, resolveModelFile } = await import("node-llama-cpp");
    const llama = await getLlama();
    const modelPath = await resolveModelFile(this.config.model);
    const model = await llama.loadModel({ modelPath });
    this.ctx = await model.createEmbeddingContext({
      contextSize: this.config.contextSize,
    });
  }

  /**
   * 生成单条文本的 embedding 向量
   *
   * @param text - 待编码文本
   * @returns 512 维浮点向量
   * @throws 若未调用 init() 则抛出 Error("Embedder not initialized")
   *
   * @example
   * ```typescript
   * const vector = await embedder.embed("代码审查反馈");
   * console.log(vector.length); // 512
   * ```
   */
  async embed(text: string): Promise<number[]> {
    if (!this.ctx) throw new Error("Embedder not initialized");
    const formatted = `Instruct: Retrieve relevant documents for the query\nQuery: ${text}`;
    const embeddingCtx = this.ctx as { getEmbeddingFor(text: string): Promise<{ vector: Float32Array }> };
    const result = await embeddingCtx.getEmbeddingFor(formatted);
    return Array.from(result.vector);
  }

  /**
   * 批量生成 embedding 向量（并发执行）
   *
   * node-llama-cpp 不支持批量 embedding context，因此使用多个并发 worker
   * 并行调用 embed()。默认并发度为 4，结果与输入 texts 索引一一对应。
   *
   * @param texts - 待编码文本列表
   * @returns 与 texts 索引一一对应的向量列表
   *
   * @example
   * ```typescript
   * const vectors = await embedder.embedBatch(["文本1", "文本2", "文本3"]);
   * console.log(vectors.length); // 3
   * ```
   */
  async embedBatch(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    const concurrency = 4;
    const results = new Array<number[]>(texts.length);
    let cursor = 0;

    async function worker(self: LocalEmbedder): Promise<void> {
      while (true) {
        const idx = cursor++;
        if (idx >= texts.length) break;
        results[idx] = await self.embed(texts[idx]);
      }
    }

    const workers = Array.from({ length: Math.min(concurrency, texts.length) }, () => worker(this));
    await Promise.all(workers);
    return results;
  }
}
