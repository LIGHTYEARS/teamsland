import type { Logger } from "@teamsland/observability";
import type { SessionDB } from "@teamsland/session";
import type { SubagentRegistry } from "./registry.js";

/**
 * NDJSON 事件类型
 *
 * @example
 * ```typescript
 * import type { SidecarEventType } from "@teamsland/sidecar";
 *
 * const eventType: SidecarEventType = "tool_use";
 * ```
 */
export type SidecarEventType = "tool_use" | "result" | "error" | "system" | "assistant" | "log";

/**
 * 被拦截的 Worker 工具名称
 *
 * Worker 子进程不得调用这些工具（防止递归委派）。
 * 数据平面层拦截后记录警告，不转发给调用方。
 *
 * @example
 * ```typescript
 * import type { InterceptedTool } from "@teamsland/sidecar";
 *
 * const tool: InterceptedTool = "delegate";
 * ```
 */
export type InterceptedTool = "delegate" | "spawn_agent" | "memory_write";

/**
 * 原始 NDJSON 事件监听器
 *
 * 在 `routeEvent` 解析成功后触发，将原始 NDJSON 行及 agentId 传递给外部。
 * Dashboard 层可通过此回调将事件 normalize 后广播到 WebSocket 客户端。
 *
 * @example
 * ```typescript
 * import type { RawEventListener } from "@teamsland/sidecar";
 *
 * const listener: RawEventListener = (agentId, line) => {
 *   console.log(`Agent ${agentId} 产生事件:`, line);
 * };
 * ```
 */
export type RawEventListener = (agentId: string, line: string) => void;

const INTERCEPTED_TOOLS: Set<string> = new Set(["delegate", "spawn_agent", "memory_write"]);

/**
 * Sidecar 数据平面
 *
 * 消费 Claude Code 的 NDJSON stdout 流，按事件类型路由，
 * 持久化消息到 SessionDB，并拦截 Worker 不应执行的工具调用。
 *
 * @example
 * ```typescript
 * import { SidecarDataPlane } from "@teamsland/sidecar";
 * import { createLogger } from "@teamsland/observability";
 *
 * const dataPlane = new SidecarDataPlane({ registry, sessionDb, logger });
 *
 * // 消费进程 stdout 流（后台运行，不阻塞调用方）
 * dataPlane.processStream("agent-001", spawnResult.stdout).catch((err) => {
 *   logger.error({ err }, "流处理异常");
 * });
 * ```
 */
export class SidecarDataPlane {
  private readonly registry: SubagentRegistry;
  private readonly sessionDb: SessionDB;
  private readonly logger: Logger;
  private rawEventListener: RawEventListener | null = null;

  constructor(opts: {
    registry: SubagentRegistry;
    sessionDb: SessionDB;
    logger: Logger;
  }) {
    this.registry = opts.registry;
    this.sessionDb = opts.sessionDb;
    this.logger = opts.logger;
  }

  /**
   * 设置原始 NDJSON 事件监听器
   *
   * 每次 `routeEvent` 成功解析一行 NDJSON 后，会调用此回调将原始行文本和 agentId 传出。
   * Dashboard 层通过此机制将事件 normalize 后广播到 WebSocket 客户端。
   *
   * @param listener - 事件监听器，传 null 取消监听
   *
   * @example
   * ```typescript
   * dataPlane.setRawEventListener((agentId, line) => {
   *   const messages = normalizeJsonlEntry(line, sessionId);
   *   for (const msg of messages) broadcast(clients, msg);
   * });
   * ```
   */
  setRawEventListener(listener: RawEventListener | null): void {
    this.rawEventListener = listener;
  }

  /**
   * 处理 Agent stdout NDJSON 流
   *
   * 逐行读取 ReadableStream，解析 JSON 事件，按 `type` 字段路由：
   * - `tool_use`：检查是否为拦截工具，是则记录警告并跳过，否则写入 SessionDB
   * - `result`：写入 SessionDB，更新 AgentRecord.status 为 "completed"
   * - `error`：写入 SessionDB，更新 AgentRecord.status 为 "failed"，记录错误日志
   * - `system`：提取 sessionId 等元数据，记录 info 日志
   * - `assistant`：写入 SessionDB（消息内容）
   * - `log`：记录 debug 日志，不写入 SessionDB
   *
   * 流结束后自动从 registry 注销 Agent。
   * 任何单行解析错误只记录 warn，不中断流处理。
   *
   * @param agentId - 目标 Agent ID（用于查找 registry 记录）
   * @param stdout - Claude CLI 的 stdout ReadableStream
   *
   * @example
   * ```typescript
   * const { pid, sessionId, stdout } = await controller.spawn(params);
   * dataPlane.processStream(agentId, stdout).catch((err) => {
   *   logger.error({ err, agentId }, "流处理异常");
   * });
   * ```
   */
  async processStream(agentId: string, stdout: ReadableStream<Uint8Array>): Promise<void> {
    const reader = stdout.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          await this.routeEvent(agentId, trimmed);
        }
      }
      // 处理残余 buffer
      if (buffer.trim()) {
        await this.routeEvent(agentId, buffer.trim());
      }
    } finally {
      reader.releaseLock();
      this.registry.unregister(agentId);
    }
  }

  /** 解析单行 JSON 并按事件类型路由 */
  private async routeEvent(agentId: string, line: string): Promise<void> {
    let event: Record<string, unknown>;
    try {
      event = JSON.parse(line) as Record<string, unknown>;
    } catch {
      this.logger.warn({ agentId, line }, "NDJSON 行解析失败，跳过");
      return;
    }

    // 通知外部监听器（dashboard 层用于实时广播 NormalizedMessage）
    this.rawEventListener?.(agentId, line);

    const type = event.type as string | undefined;

    switch (type) {
      case "tool_use": {
        const toolName = event.name as string | undefined;
        if (toolName && INTERCEPTED_TOOLS.has(toolName)) {
          this.logger.warn({ agentId, toolName }, "拦截 Worker 禁止工具调用");
          return;
        }
        await this.appendToSession(agentId, event);
        break;
      }
      case "result": {
        await this.appendToSession(agentId, event);
        this.updateStatus(agentId, "completed");
        break;
      }
      case "error": {
        await this.appendToSession(agentId, event);
        this.updateStatus(agentId, "failed");
        this.logger.error({ agentId, event }, "Agent 进程报错");
        break;
      }
      case "system": {
        this.logger.info({ agentId, sessionId: event.session_id }, "system 事件");
        break;
      }
      case "assistant": {
        await this.appendToSession(agentId, event);
        break;
      }
      case "log": {
        this.logger.debug({ agentId, event }, "log 事件");
        break;
      }
      default: {
        this.logger.debug({ agentId, type }, "未知事件类型");
        break;
      }
    }
  }

  /** 将事件写入 SessionDB */
  private async appendToSession(agentId: string, event: Record<string, unknown>): Promise<void> {
    const record = this.registry.get(agentId);
    const sessionId = record?.sessionId ?? agentId;
    try {
      await this.sessionDb.appendMessage({
        sessionId,
        role: "assistant",
        content: JSON.stringify(event),
      });
    } catch (err) {
      this.logger.warn({ agentId, err }, "写入 SessionDB 失败");
    }
  }

  /** 更新 AgentRecord 状态 */
  private updateStatus(agentId: string, status: "completed" | "failed"): void {
    const record = this.registry.get(agentId);
    if (record) {
      record.status = status;
    }
  }
}
