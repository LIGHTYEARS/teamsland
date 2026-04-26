// @teamsland/server — 业务上下文组件初始化模块

import { RepoMapping } from "@teamsland/config";
import { DynamicContextAssembler } from "@teamsland/context";
import { BunCommandRunner as GitBunCommandRunner, WorktreeManager } from "@teamsland/git";
import { DocumentParser } from "@teamsland/ingestion";
import { ConfirmationWatcher } from "@teamsland/meego";
import type { createLogger } from "@teamsland/observability";
import type { AppConfig, LlmConfig } from "@teamsland/types";
import { AnthropicLlmClient } from "../llm-client.js";
import type { LarkResult } from "./lark.js";
import type { SidecarResult } from "./sidecar.js";
import type { StorageResult } from "./storage.js";

/**
 * 业务上下文初始化结果
 *
 * @example
 * ```typescript
 * import type { ContextResult } from "./context.js";
 *
 * const ctx: ContextResult = initContext(config, storage, sidecar, lark, logger);
 * const prompt = await ctx.assembler.buildInitialPrompt(taskConfig, "default");
 * ```
 */
export interface ContextResult {
  /** 仓库映射 */
  repoMapping: RepoMapping;
  /** 动态上下文组装器 */
  assembler: DynamicContextAssembler;
  /** LLM 客户端（未配置时为 stub） */
  llmClient: { chat(messages: unknown[], tools?: unknown[]): Promise<{ content: string }> };
  /** 文档解析器 */
  documentParser: DocumentParser;
  /** Git Worktree 管理器 */
  worktreeManager: WorktreeManager;
  /** 人工确认监视器 */
  confirmationWatcher: ConfirmationWatcher;
}

/**
 * 根据配置构建 LLM 客户端
 *
 * 当 LLM 配置存在时创建 AnthropicLlmClient，
 * 否则返回 stub 客户端（调用时抛出错误）。
 *
 * @param llmConfig - LLM 配置（可选）
 * @param logger - 日志记录器
 * @returns LLM 客户端
 *
 * @example
 * ```typescript
 * const { llmClient } = buildLlmStack(config.llm, logger);
 * ```
 */
function buildLlmStack(llmConfig: LlmConfig | undefined, logger: ReturnType<typeof createLogger>) {
  if (llmConfig) {
    const client = new AnthropicLlmClient(llmConfig);
    logger.info({ model: llmConfig.model }, "AnthropicLlmClient 已初始化");
    return { llmClient: client };
  }
  logger.warn("LLM 未配置");
  const stub = {
    async chat(): Promise<{ content: string }> {
      throw new Error("LLM 未配置 — 需要在配置中添加 API 密钥和模型端点");
    },
  };
  return { llmClient: stub };
}

/**
 * 初始化业务上下文相关组件
 *
 * 包含以下组件的初始化：
 * - RepoMapping — 仓库映射
 * - DynamicContextAssembler — 动态上下文组装
 * - LLM 客户端 — 条件初始化
 * - DocumentParser — 文档解析
 * - WorktreeManager — Git worktree 管理
 * - ConfirmationWatcher — 人工确认监视
 *
 * @param config - 应用配置
 * @param storage - 存储层初始化结果
 * @param sidecar - Sidecar 初始化结果（未使用，预留扩展）
 * @param lark - 飞书组件初始化结果
 * @param logger - 日志记录器
 * @returns 所有业务上下文组件
 *
 * @example
 * ```typescript
 * import { initContext } from "./init/context.js";
 *
 * const context = initContext(config, storage, sidecar, lark, logger);
 * const prompt = await context.assembler.buildInitialPrompt(taskConfig, "default");
 * ```
 */
export function initContext(
  config: AppConfig,
  storage: StorageResult,
  _sidecar: SidecarResult,
  lark: LarkResult,
  logger: ReturnType<typeof createLogger>,
): ContextResult {
  // RepoMapping
  const repoMapping = RepoMapping.fromConfig(config.repoMapping);

  // DynamicContextAssembler
  const assembler = new DynamicContextAssembler({
    config,
    repoMapping,
  });

  // LLM 客户端（条件初始化）
  const { llmClient } = buildLlmStack(config.llm, logger);

  // DocumentParser
  const documentParser = new DocumentParser();

  // WorktreeManager
  const worktreeManager = new WorktreeManager(new GitBunCommandRunner());

  // ConfirmationWatcher
  const confirmationWatcher = new ConfirmationWatcher({
    notifier: lark.notifier,
    config: config.confirmation,
    meego: { apiBaseUrl: config.meego.apiBaseUrl, pluginAccessToken: config.meego.pluginAccessToken },
  });

  logger.info("业务上下文组件初始化完成");

  return {
    repoMapping,
    assembler,
    llmClient,
    documentParser,
    worktreeManager,
    confirmationWatcher,
  };
}
