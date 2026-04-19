/**
 * 请求上下文，标识当前操作的用户、Agent 和团队
 *
 * @example
 * ```typescript
 * import type { RequestContext } from "@teamsland/types";
 *
 * const ctx: RequestContext = {
 *   userId: "user-001",
 *   agentId: "orchestrator",
 *   teamId: "team-a",
 * };
 * ```
 */
export interface RequestContext {
  /** 用户 ID */
  userId: string;
  /** 当前 Agent ID */
  agentId: string;
  /** 团队 ID */
  teamId: string;
}

/**
 * 意图分类类型，由 IntentClassifier 输出
 *
 * @example
 * ```typescript
 * import type { IntentType } from "@teamsland/types";
 *
 * const intent: IntentType = "frontend_dev";
 * ```
 */
export type IntentType = "frontend_dev" | "tech_spec" | "design" | "query" | "status_sync" | "confirm";

/**
 * 意图分类结果，包含置信度和提取的实体
 *
 * @example
 * ```typescript
 * import type { IntentResult } from "@teamsland/types";
 *
 * const result: IntentResult = {
 *   type: "frontend_dev",
 *   confidence: 0.92,
 *   entities: {
 *     modules: ["用户登录模块"],
 *     owners: ["张三"],
 *     domains: ["auth"],
 *   },
 * };
 * ```
 */
export interface IntentResult {
  /** 识别的意图类型 */
  type: IntentType;
  /** 置信度（0-1） */
  confidence: number;
  /** 提取的实体信息 */
  entities: {
    /** 涉及的模块名 */
    modules: string[];
    /** 涉及的负责人 */
    owners: string[];
    /** 涉及的功能域 */
    domains: string[];
  };
}
