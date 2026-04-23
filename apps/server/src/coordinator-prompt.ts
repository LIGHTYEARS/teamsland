import type { CoordinatorContext, CoordinatorEvent, CoordinatorEventType } from "@teamsland/types";

/**
 * 从事件 payload 中安全提取字符串字段
 *
 * @param payload - 事件负载
 * @param key - 字段名
 * @param fallback - 未找到时的默认值
 * @returns 提取到的字符串值
 *
 * @example
 * ```typescript
 * const val = extractString({ chatId: "oc_xxx" }, "chatId", "unknown");
 * // val === "oc_xxx"
 * ```
 */
function extractString(payload: Record<string, unknown>, key: string, fallback = "N/A"): string {
  const value = payload[key];
  return typeof value === "string" ? value : fallback;
}

/**
 * 格式化 Unix 毫秒时间戳为可读字符串
 *
 * @param timestampMs - Unix 毫秒时间戳
 * @returns ISO 8601 格式的时间字符串
 *
 * @example
 * ```typescript
 * const formatted = formatTimestamp(1700000000000);
 * // "2023-11-14T22:13:20.000Z"
 * ```
 */
function formatTimestamp(timestampMs: number): string {
  return new Date(timestampMs).toISOString();
}

/**
 * Coordinator 提示词构建器
 *
 * 根据事件类型和上下文信息，生成结构化的 Coordinator 提示词。
 * 采用事件类型 → 处理函数映射的模式，避免大型 switch 语句，保持低认知复杂度。
 *
 * @example
 * ```typescript
 * import { CoordinatorPromptBuilder } from "./coordinator-prompt.js";
 * import type { CoordinatorEvent, CoordinatorContext } from "@teamsland/types";
 *
 * const builder = new CoordinatorPromptBuilder();
 * const event: CoordinatorEvent = {
 *   type: "lark_mention",
 *   id: "msg-001",
 *   timestamp: Date.now(),
 *   priority: 1,
 *   payload: { chatId: "oc_xxx", chatName: "前端群", senderId: "ou_aaa", senderName: "张三", message: "帮我看看代码", messageId: "msg-001" },
 * };
 * const context: CoordinatorContext = {
 *   taskStateSummary: "当前有 2 个 Worker 运行中",
 *   recentMessages: "",
 *   relevantMemories: "",
 * };
 * const prompt = builder.build(event, context);
 * ```
 */
export class CoordinatorPromptBuilder {
  /**
   * 事件类型到提示词生成函数的映射表
   */
  private readonly promptHandlers: Record<CoordinatorEventType, (event: CoordinatorEvent) => string> = {
    lark_mention: (e) => this.buildLarkMention(e),
    meego_issue_created: (e) => this.buildMeegoIssueCreated(e),
    meego_issue_assigned: (e) => this.buildMeegoIssueAssigned(e),
    meego_issue_status_changed: (e) => this.buildMeegoIssueStatusChanged(e),
    meego_sprint_started: (e) => this.buildMeegoSprintStarted(e),
    worker_completed: (e) => this.buildWorkerCompleted(e),
    worker_anomaly: (e) => this.buildWorkerAnomaly(e),
    worker_timeout: (e) => this.buildWorkerTimeout(e),
    diagnosis_ready: (e) => this.buildDiagnosisReady(e),
    user_query: (e) => this.buildUserQuery(e),
  };

  /**
   * 构建完整的 Coordinator 提示词
   *
   * 将系统上下文块与事件特定提示词组合，生成最终发送给 Coordinator 的提示词。
   *
   * @param event - 统一 Coordinator 事件
   * @param context - 加载的上下文信息
   * @returns 完整的提示词字符串
   *
   * @example
   * ```typescript
   * const builder = new CoordinatorPromptBuilder();
   * const prompt = builder.build(event, context);
   * // prompt 包含系统上下文和事件特定提示
   * ```
   */
  build(event: CoordinatorEvent, context: CoordinatorContext): string {
    const systemContext = this.buildSystemContext(context);
    const eventPrompt = this.buildEventPrompt(event);
    return `${systemContext}\n---\n${eventPrompt}`;
  }

  /**
   * 构建系统上下文块
   *
   * @param context - 上下文信息
   * @returns 格式化的系统上下文字符串
   *
   * @example
   * ```typescript
   * const builder = new CoordinatorPromptBuilder();
   * // 内部方法，通过 build() 间接调用
   * ```
   */
  private buildSystemContext(context: CoordinatorContext): string {
    const taskState = context.taskStateSummary || "当前没有运行中的 Worker。";
    const messages = context.recentMessages || "无近期对话记录。";
    const memories = context.relevantMemories || "无相关历史记忆。";
    const now = new Date().toISOString();

    return [
      "## 当前状态",
      "",
      "### 运行中的 Worker",
      taskState,
      "",
      "### 近期对话",
      messages,
      "",
      "### 相关记忆",
      memories,
      "",
      "### 当前时间",
      now,
    ].join("\n");
  }

  /**
   * 根据事件类型分发到对应的提示词生成函数
   *
   * @param event - 统一 Coordinator 事件
   * @returns 事件特定的提示词字符串
   *
   * @example
   * ```typescript
   * const builder = new CoordinatorPromptBuilder();
   * // 内部方法，通过 build() 间接调用
   * ```
   */
  private buildEventPrompt(event: CoordinatorEvent): string {
    const handler = this.promptHandlers[event.type];
    return handler(event);
  }

  /**
   * 生成飞书 @提及 事件的提示词
   */
  private buildLarkMention(event: CoordinatorEvent): string {
    const { payload } = event;
    const chatId = extractString(payload, "chatId");
    const senderId = extractString(payload, "senderId");
    const message = extractString(payload, "message");
    const messageId = extractString(payload, "messageId");
    const chatContext = extractString(payload, "chatContext", "");

    const parts = [
      "## 新消息",
      "",
      `群聊 (ID: ${chatId}) 中，用户 (ID: ${senderId}) 说：`,
      "",
      `> ${message}`,
      "",
      `消息 ID: ${messageId}`,
      `时间: ${formatTimestamp(event.timestamp)}`,
    ];

    if (chatContext && chatContext !== message) {
      parts.push("", "### 聊天上下文", "", chatContext);
    }

    parts.push(
      "",
      "---",
      "",
      "请按照决策流程处理这条消息。如果需要 spawn worker，确保在 --task 中包含 --origin-chat " +
        `"${chatId}" 以便 worker 完成后回复。`,
    );

    return parts.join("\n");
  }

  /**
   * 生成 Meego 工单创建事件的提示词
   */
  private buildMeegoIssueCreated(event: CoordinatorEvent): string {
    const { payload } = event;
    const issueId = extractString(payload, "issueId");
    const projectKey = extractString(payload, "projectKey");
    const title = extractString(payload, "title");
    const description = extractString(payload, "description", "无描述");
    const assigneeId = extractString(payload, "assigneeId", "未指派");

    return [
      "## 新工单",
      "",
      "Meego 工单已创建：",
      `- 工单 ID: ${issueId}`,
      `- 项目: ${projectKey}`,
      `- 标题: ${title}`,
      "- 描述:",
      `> ${description}`,
      `- 指派人: ${assigneeId}`,
      `- 创建时间: ${formatTimestamp(event.timestamp)}`,
      "",
      "---",
      "",
      "请判断这个工单是否需要自动处理。如果需要，通过 teamsland spawn 创建 worker。",
    ].join("\n");
  }

  /**
   * 生成 Meego 工单指派事件的提示词
   */
  private buildMeegoIssueAssigned(event: CoordinatorEvent): string {
    const { payload } = event;
    const issueId = extractString(payload, "issueId");
    const projectKey = extractString(payload, "projectKey");
    const assigneeId = extractString(payload, "assigneeId");
    const title = extractString(payload, "title");

    return [
      "## 工单指派",
      "",
      `Meego 工单 ${issueId}（项目 ${projectKey}）已指派给 ${assigneeId}。`,
      `标题: ${title}`,
      "",
      "---",
      "",
      "请通过 lark-cli 发送私聊消息通知被指派人。",
    ].join("\n");
  }

  /**
   * 生成 Meego 工单状态变更事件的提示词
   */
  private buildMeegoIssueStatusChanged(event: CoordinatorEvent): string {
    const { payload } = event;
    const issueId = extractString(payload, "issueId");
    const projectKey = extractString(payload, "projectKey");
    const oldStatus = extractString(payload, "oldStatus");
    const newStatus = extractString(payload, "newStatus");

    return [
      "## 工单状态变更",
      "",
      `Meego 工单 ${issueId}（项目 ${projectKey}）状态从「${oldStatus}」变为「${newStatus}」。`,
      `时间: ${formatTimestamp(event.timestamp)}`,
      "",
      "---",
      "",
      "请评估是否需要通知相关人员或触发后续流程。",
    ].join("\n");
  }

  /**
   * 生成 Meego Sprint 启动事件的提示词
   */
  private buildMeegoSprintStarted(event: CoordinatorEvent): string {
    const { payload } = event;
    const sprintName = extractString(payload, "sprintName");
    const projectKey = extractString(payload, "projectKey");

    return [
      "## Sprint 启动",
      "",
      `项目 ${projectKey} 的 Sprint「${sprintName}」已启动。`,
      `时间: ${formatTimestamp(event.timestamp)}`,
      "",
      "---",
      "",
      "请通知团队成员 Sprint 已开始，并提醒关注各自的任务。",
    ].join("\n");
  }

  /**
   * 生成 Worker 完成事件的提示词
   */
  private buildWorkerCompleted(event: CoordinatorEvent): string {
    const { payload } = event;
    const workerId = extractString(payload, "workerId");
    const issueId = extractString(payload, "issueId", "无关联工单");
    const resultSummary = extractString(payload, "resultSummary", "无结果摘要");

    return [
      "## Worker 完成",
      "",
      `Worker ${workerId} 已完成任务。`,
      `- 关联任务: ${issueId}`,
      `- 运行时长: ${formatTimestamp(event.timestamp)}`,
      "",
      "执行结果:",
      `> ${resultSummary}`,
      "",
      "---",
      "",
      "请整理结果摘要，通过 lark-cli 回复相关群聊。",
    ].join("\n");
  }

  /**
   * 生成 Worker 异常事件的提示词
   */
  private buildWorkerAnomaly(event: CoordinatorEvent): string {
    const { payload } = event;
    const workerId = extractString(payload, "workerId");
    const anomalyType = extractString(payload, "anomalyType");
    const details = extractString(payload, "details");

    return [
      "## Worker 异常 [优先处理]",
      "",
      `Worker ${workerId} 出现异常。`,
      `- 异常类型: ${anomalyType}`,
      `- 错误信息: ${details}`,
      "",
      "---",
      "",
      "请立即处理：",
      "1. 评估异常严重性",
      "2. 如果可恢复：teamsland cancel + teamsland spawn --worktree 接力",
      "3. 如果不可恢复：通过 lark-cli 通知相关人员",
    ].join("\n");
  }

  /**
   * 生成 Worker 超时事件的提示词
   */
  private buildWorkerTimeout(event: CoordinatorEvent): string {
    const { payload } = event;
    const workerId = extractString(payload, "workerId");
    const timeoutSeconds = payload.timeoutSeconds;
    const timeoutStr = typeof timeoutSeconds === "number" ? `${timeoutSeconds}s` : "N/A";

    return [
      "## Worker 超时",
      "",
      `Worker ${workerId} 已超时（限制: ${timeoutStr}）。`,
      `时间: ${formatTimestamp(event.timestamp)}`,
      "",
      "---",
      "",
      "请决定是否取消并重新分配任务。",
    ].join("\n");
  }

  /**
   * 生成诊断就绪事件的提示词
   */
  private buildDiagnosisReady(event: CoordinatorEvent): string {
    const { payload } = event;
    const diagnosisId = extractString(payload, "diagnosisId");
    const summary = extractString(payload, "summary");

    return [
      "## 诊断报告就绪",
      "",
      `诊断 ID: ${diagnosisId}`,
      `摘要: ${summary}`,
      `时间: ${formatTimestamp(event.timestamp)}`,
      "",
      "---",
      "",
      "请审阅诊断结果并决定后续行动。",
    ].join("\n");
  }

  /**
   * 生成用户查询事件的提示词
   */
  private buildUserQuery(event: CoordinatorEvent): string {
    const { payload } = event;
    const query = extractString(payload, "query");
    const userId = extractString(payload, "userId");

    return [
      "## 用户查询",
      "",
      `用户 ${userId} 提问：`,
      "",
      `> ${query}`,
      "",
      `时间: ${formatTimestamp(event.timestamp)}`,
      "",
      "---",
      "",
      "请根据当前上下文回答用户的问题。",
    ].join("\n");
  }
}
