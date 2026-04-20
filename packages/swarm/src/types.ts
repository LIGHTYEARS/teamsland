import type { DynamicContextAssembler } from "@teamsland/context";
import type { ProcessController, SubagentRegistry } from "@teamsland/sidecar";
import type { SidecarConfig } from "@teamsland/types";
import type { TaskPlanner } from "./task-planner.js";

/**
 * LLM 调用结果
 *
 * @example
 * ```typescript
 * import type { LlmResponse } from "@teamsland/swarm";
 *
 * const resp: LlmResponse = {
 *   content: '[{"taskId":"st-1","description":"...","agentRole":"...","dependencies":[]}]',
 * };
 * ```
 */
export interface LlmResponse {
  /** 文本回复内容 */
  content: string;
}

/**
 * Swarm 模块内部 LLM 客户端接口
 *
 * 仅需 chat() 方法（无工具调用），简化可注入接口。
 * 真实实现由调用方（apps/server）在启动时注入。
 *
 * @example
 * ```typescript
 * import type { LlmClient } from "@teamsland/swarm";
 *
 * const fakeLlm: LlmClient = {
 *   async chat(_messages) {
 *     return { content: JSON.stringify([{ taskId: "t1", description: "...", agentRole: "...", dependencies: [] }]) };
 *   },
 * };
 * ```
 */
export interface LlmClient {
  /**
   * 发送对话消息并获取回复
   * @param messages - 消息历史（role + content 对）
   */
  chat(messages: Array<{ role: "system" | "user" | "assistant"; content: string }>): Promise<LlmResponse>;
}

/**
 * runSwarm 选项
 *
 * 所有外部依赖均通过此对象注入，便于测试时替换 Mock。
 *
 * @example
 * ```typescript
 * import type { SwarmOpts } from "@teamsland/swarm";
 *
 * const opts: SwarmOpts = {
 *   planner,
 *   registry,
 *   assembler,
 *   processController,
 *   config: appConfig.sidecar,
 *   teamId: "team-abc",
 * };
 * ```
 */
export interface SwarmOpts {
  /** 任务拆解器，负责将 ComplexTask 分解为 SubTask[] */
  planner: TaskPlanner;
  /** Subagent 注册表，用于 Worker 启动与追踪 */
  registry: SubagentRegistry;
  /** 动态上下文组装器，用于构建 Worker Prompt */
  assembler: DynamicContextAssembler;
  /** 进程控制器，负责 Bun.spawn Claude Code 子进程 */
  processController: ProcessController;
  /** Sidecar 配置（workerTimeoutSeconds、minSwarmSuccessRatio） */
  config: SidecarConfig;
  /** 团队 ID，透传给 Worker 上下文组装 */
  teamId: string;
}
