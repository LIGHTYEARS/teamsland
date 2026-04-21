import { createLogger } from "@teamsland/observability";
import type { Embedder } from "./embedder.js";

const logger = createLogger("memory:null-embedder");

/**
 * 空操作 Embedding 生成器
 *
 * 当 node-llama-cpp 未安装时的降级替代。
 * 所有 embed 调用返回零向量，向量检索将无法匹配任何记忆。
 *
 * @example
 * ```typescript
 * import { NullEmbedder } from "@teamsland/memory";
 *
 * const embedder = new NullEmbedder(512);
 * await embedder.init();
 * const vec = await embedder.embed("测试文本");
 * // vec: [0, 0, ..., 0] (512维零向量)
 * ```
 */
export class NullEmbedder implements Embedder {
  private readonly dimensions: number;

  constructor(dimensions = 512) {
    this.dimensions = dimensions;
  }

  async init(): Promise<void> {
    logger.warn("NullEmbedder 已激活 — 向量检索将返回空结果");
  }

  async embed(_text: string): Promise<number[]> {
    return new Array<number>(this.dimensions).fill(0);
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    return texts.map(() => new Array<number>(this.dimensions).fill(0));
  }
}
