import { createLogger } from "@teamsland/observability";
import type { MemoryEntry } from "@teamsland/types";
import type { LlmClient, LlmMessage, LlmToolCall, MemoryOperation } from "./llm-client.js";
import { EXTRACT_TOOLS } from "./llm-client.js";
import type { TeamMemoryStore } from "./team-memory-store.js";

const logger = createLogger("memory:extract-loop");

/** 系统提示模板 — 指导 LLM 分析文档并提取记忆操作 */
const SYSTEM_PROMPT = `你是一个记忆提取助手，负责分析团队文档并提取需要保存的记忆。

你可以使用以下工具查阅现有记忆：
- memory_read: 按 ID 读取单条记忆
- memory_search: 按关键词搜索相关记忆
- memory_ls: 列出团队所有 L0 摘要

分析完成后，请返回一个 JSON 数组，包含所有需要执行的记忆操作。

操作格式：
[
  {
    "type": "create" | "update" | "delete",
    "memoryType": "profile" | "preferences" | "entities" | "soul" | "identity" | "decisions" | "events" | "cases" | "patterns" | "tools" | "skills" | "project_context",
    "content": "记忆内容",
    "targetId": "目标记忆 ID（update/delete 时必填）",
    "metadata": {}
  }
]

若无需提取任何记忆，返回空数组 []。`;

/**
 * ExtractLoop 构造参数
 *
 * @example
 * ```typescript
 * import type { ExtractLoopOpts } from "@teamsland/memory";
 *
 * const opts: ExtractLoopOpts = {
 *   llm: myLlmClient,
 *   store: teamStore,
 *   teamId: "team-1",
 *   maxIterations: 5,
 * };
 * ```
 */
export interface ExtractLoopOpts {
  /** LLM 客户端 */
  llm: LlmClient;
  /** 团队记忆存储 */
  store: TeamMemoryStore;
  /** 团队 ID（用于 memory_ls 工具） */
  teamId: string;
  /** 最大迭代次数（防止无限循环） */
  maxIterations: number;
}

/**
 * 执行单个工具调用
 *
 * 根据工具名称分发到对应的 store 方法，返回 JSON 字符串结果。
 *
 * @param call - LLM 发起的工具调用
 * @param store - 团队记忆存储
 * @param teamId - 团队 ID
 * @returns JSON 字符串形式的工具执行结果
 *
 * @example
 * ```typescript
 * const result = await executeTool(
 *   { name: "memory_search", args: { query: "React" } },
 *   store,
 *   "team-1",
 * );
 * ```
 */
async function executeTool(call: LlmToolCall, store: TeamMemoryStore, teamId: string): Promise<string> {
  switch (call.name) {
    case "memory_read": {
      const entryId = call.args.entryId as string;
      const entry: MemoryEntry | null = store.getEntry(entryId);
      return JSON.stringify(entry ? entry.toDict() : null);
    }
    case "memory_search": {
      const query = call.args.query as string;
      const limit = typeof call.args.limit === "number" ? call.args.limit : 10;
      const results: MemoryEntry[] = store.ftsSearch(query, limit);
      return JSON.stringify(results.map((e) => e.toDict()));
    }
    case "memory_ls": {
      const tid = (call.args.teamId as string | undefined) ?? teamId;
      const abstracts: MemoryEntry[] = await store.listAbstracts(tid);
      return JSON.stringify(abstracts.map((e) => e.toDict()));
    }
    default: {
      logger.warn({ toolName: call.name }, "未知工具调用，已忽略");
      return JSON.stringify({ error: `未知工具：${call.name}` });
    }
  }
}

/**
 * 解析 LLM 返回的 JSON 文本为 MemoryOperation[]
 *
 * 若解析失败或结果不是数组则返回空数组。
 *
 * @param text - LLM 回复文本
 * @returns 解析出的操作列表，失败时返回 []
 *
 * @example
 * ```typescript
 * const ops = parseOperations('[{"type":"create","memoryType":"entities","content":"Alice"}]');
 * console.log(ops.length); // 1
 * ```
 */
function parseOperations(text: string): MemoryOperation[] {
  try {
    const parsed: unknown = JSON.parse(text.trim());
    if (!Array.isArray(parsed)) {
      logger.warn({ text }, "LLM 返回非数组 JSON，已忽略");
      return [];
    }
    return parsed as MemoryOperation[];
  } catch (err: unknown) {
    logger.warn({ text, err }, "LLM 返回无效 JSON，已忽略");
    return [];
  }
}

/**
 * 记忆提取循环
 *
 * 基于 ReAct 模式的 LLM 工具调用循环：
 * 1. 发送文档给 LLM，附带工具定义
 * 2. 若 LLM 返回工具调用 → 执行工具 → 将结果追加到消息历史 → 继续
 * 3. 若 LLM 返回纯文本 → 解析为 MemoryOperation[] → 返回
 * 4. 超过 maxIterations → 返回 []
 *
 * @example
 * ```typescript
 * import { ExtractLoop } from "@teamsland/memory";
 *
 * const loop = new ExtractLoop({ llm, store, teamId: "team-1", maxIterations: 5 });
 * const operations = await loop.extract("会议记录：讨论了架构迁移方案...");
 * console.log(operations);
 * // [{ type: "create", memoryType: "decisions", content: "决定迁移到微服务架构" }]
 * ```
 */
export class ExtractLoop {
  private readonly llm: LlmClient;
  private readonly store: TeamMemoryStore;
  private readonly teamId: string;
  private readonly maxIterations: number;

  /**
   * 构造 ExtractLoop
   *
   * @param opts - 构造参数
   *
   * @example
   * ```typescript
   * const loop = new ExtractLoop({
   *   llm: myLlmClient,
   *   store: teamStore,
   *   teamId: "team-1",
   *   maxIterations: 5,
   * });
   * ```
   */
  constructor(opts: ExtractLoopOpts) {
    this.llm = opts.llm;
    this.store = opts.store;
    this.teamId = opts.teamId;
    this.maxIterations = opts.maxIterations;
  }

  /**
   * 提取文档中的记忆操作
   *
   * 使用 LLM + 工具调用循环分析文档，提取结构化的记忆操作列表。
   *
   * @param doc - 待分析的文档文本
   * @returns 提取出的记忆操作列表，异常时返回 []
   *
   * @example
   * ```typescript
   * const loop = new ExtractLoop({ llm, store, teamId: "team-1", maxIterations: 5 });
   * const ops = await loop.extract("会议纪要：团队确定使用 PostgreSQL");
   * ```
   */
  async extract(doc: string): Promise<MemoryOperation[]> {
    if (!doc.trim()) {
      return [];
    }

    try {
      return await this.runLoop(doc);
    } catch (err: unknown) {
      logger.warn({ err }, "ExtractLoop 运行时异常，返回空数组");
      return [];
    }
  }

  /** 执行主循环逻辑 */
  private async runLoop(doc: string): Promise<MemoryOperation[]> {
    const messages: LlmMessage[] = [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: `请分析以下文档并提取记忆操作：\n\n${doc}` },
    ];

    for (let iteration = 0; iteration < this.maxIterations; iteration++) {
      const response = await this.llm.chat(messages, EXTRACT_TOOLS);

      if (!response.toolCalls || response.toolCalls.length === 0) {
        // 纯文本回复 → 解析为操作列表
        return parseOperations(response.content);
      }

      // 工具调用 → 执行并追加结果
      messages.push({ role: "assistant", content: response.content });
      await this.appendToolResults(messages, response.toolCalls);

      logger.info({ iteration, toolCount: response.toolCalls.length }, "ExtractLoop 工具调用轮次完成");
    }

    logger.warn({ maxIterations: this.maxIterations }, "ExtractLoop 超过最大迭代次数，返回空数组");
    return [];
  }

  /** 执行工具调用列表，将结果追加到消息历史 */
  private async appendToolResults(messages: LlmMessage[], toolCalls: LlmToolCall[]): Promise<void> {
    for (const call of toolCalls) {
      const result = await executeTool(call, this.store, this.teamId);
      messages.push({
        role: "tool",
        content: result,
        toolCallId: call.name,
      });
    }
  }
}
