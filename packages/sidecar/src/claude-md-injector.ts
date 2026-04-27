import { join } from "node:path";

/**
 * CLAUDE.md 注入的任务上下文信息
 *
 * 包含 worker 身份、任务详情、关联工单及环境变量等字段，
 * 由 {@link ClaudeMdInjector} 注入到 worktree 的 CLAUDE.md 文件末尾。
 *
 * @example
 * ```typescript
 * import type { ClaudeMdContext } from "@teamsland/sidecar";
 *
 * const ctx: ClaudeMdContext = {
 *   workerId: "worker-01",
 *   taskType: "code-review",
 *   requester: "张三",
 *   issueId: "PROJ-1234",
 *   chatId: "oc_abc123",
 *   messageId: "om_def456",
 *   taskPrompt: "请审查 PR #42 的代码变更",
 *   meegoApiBase: "https://meego.example.com",
 *   meegoPluginToken: "token_xxx",
 * };
 * ```
 */
export interface ClaudeMdContext {
  /** Worker 实例 ID */
  workerId: string;
  /** 任务类型（如 code-review、bugfix 等） */
  taskType: string;
  /** 发起人名称 */
  requester: string;
  /** 关联的 Meego 工单 ID */
  issueId: string;
  /** 飞书群聊 ID */
  chatId: string;
  /** 飞书消息 ID */
  messageId: string;
  /** 任务指令文本 */
  taskPrompt: string;
  /** Meego API 基础地址 */
  meegoApiBase: string;
  /** Meego 插件认证 Token */
  meegoPluginToken: string;
  /** teamsland 主服务 API 基础地址 */
  teamslandApiBase: string;
  /** Worker worktree 路径 */
  worktreePath: string;
}

/**
 * CLAUDE.md 任务上下文注入器
 *
 * 向 worktree 的 CLAUDE.md 文件追加任务上下文块（使用标记行分隔），
 * 不覆盖文件中已有的内容。支持幂等注入（重复调用会先移除旧块再重新追加）
 * 和清理（移除注入块，保留原始内容）。
 *
 * @example
 * ```typescript
 * import { ClaudeMdInjector } from "@teamsland/sidecar";
 *
 * const injector = new ClaudeMdInjector();
 *
 * // 注入任务上下文
 * await injector.inject("/path/to/worktree", {
 *   workerId: "worker-01",
 *   taskType: "bugfix",
 *   requester: "李四",
 *   issueId: "BUG-5678",
 *   chatId: "oc_abc123",
 *   messageId: "om_def456",
 *   taskPrompt: "修复登录页面的 CSRF 漏洞",
 *   meegoApiBase: "https://meego.example.com",
 *   meegoPluginToken: "token_xxx",
 * });
 *
 * // 清理注入块
 * await injector.cleanup("/path/to/worktree");
 * ```
 */
export class ClaudeMdInjector {
  private static readonly MARKER = "<!-- teamsland-task-context: DO NOT EDIT BELOW -->";

  /**
   * 向 worktree 的 CLAUDE.md 追加任务上下文
   *
   * 如果 MARKER 已存在，先移除旧的注入块再重新追加（幂等操作）。
   * 如果 CLAUDE.md 不存在，创建新文件并写入注入块。
   *
   * @param worktreePath - worktree 根目录路径
   * @param ctx - 要注入的任务上下文
   *
   * @example
   * ```typescript
   * const injector = new ClaudeMdInjector();
   * await injector.inject("/tmp/worktree-abc", {
   *   workerId: "w-1",
   *   taskType: "feature",
   *   requester: "王五",
   *   issueId: "FEAT-99",
   *   chatId: "oc_chat",
   *   messageId: "om_msg",
   *   taskPrompt: "实现用户头像上传功能",
   *   meegoApiBase: "https://meego.example.com",
   *   meegoPluginToken: "tok_abc",
   * });
   * ```
   */
  async inject(worktreePath: string, ctx: ClaudeMdContext): Promise<void> {
    const filePath = join(worktreePath, "CLAUDE.md");
    const file = Bun.file(filePath);
    let existing = "";

    if (await file.exists()) {
      existing = await file.text();
    }

    // Remove old injected block if present
    const cleaned = this.removeMarkerBlock(existing);

    const block = this.buildBlock(ctx);
    const separator = cleaned.length > 0 && !cleaned.endsWith("\n") ? "\n" : "";
    const result = `${cleaned}${separator}${block}`;

    await Bun.write(filePath, result);
  }

  /**
   * 从 CLAUDE.md 移除注入块
   *
   * 查找 MARKER 行并移除该行及其后的所有内容。
   * 如果未找到 MARKER，不做任何修改。
   *
   * @param worktreePath - worktree 根目录路径
   *
   * @example
   * ```typescript
   * const injector = new ClaudeMdInjector();
   * await injector.cleanup("/tmp/worktree-abc");
   * ```
   */
  async cleanup(worktreePath: string): Promise<void> {
    const filePath = join(worktreePath, "CLAUDE.md");
    const file = Bun.file(filePath);

    if (!(await file.exists())) return;

    const content = await file.text();
    const cleaned = this.removeMarkerBlock(content);

    // Only write if something changed
    if (cleaned !== content) {
      await Bun.write(filePath, cleaned);
    }
  }

  /**
   * 移除 MARKER 行及其后面的所有内容
   */
  private removeMarkerBlock(content: string): string {
    const marker = ClaudeMdInjector.MARKER;

    // Check if content starts with the marker
    if (content.startsWith(marker)) {
      return "";
    }

    const idx = content.indexOf(`\n${marker}`);
    if (idx === -1) return content;

    return content.slice(0, idx + 1);
  }

  /**
   * 构建要注入的 Markdown 块
   */
  private buildBlock(ctx: ClaudeMdContext): string {
    const marker = ClaudeMdInjector.MARKER;
    return `${marker}

## teamsland 任务上下文

| 字段 | 值 |
|------|-----|
| 任务类型 | ${ctx.taskType} |
| 发起人 | ${ctx.requester} |
| 关联工单 | ${ctx.issueId} |
| Worktree | ${ctx.worktreePath} |

### 工作约定

**身份**：你是 Teamsland 平台的 Worker 执行单元，负责完成分配的任务并回报结果。

**回报纪律**：
- 任务完成 → 必须调用 teamsland-report 回报（status: success）
- 遇到阻塞 → 必须调用 teamsland-report 说明阻塞原因（status: blocked），不得静默退出
- 部分完成 → 回报已完成的部分和剩余待做的部分（status: partial）
- 如需回复群聊，使用 lark-reply skill
- 如关联了 Meego 工单，完成后通过 meego-update skill 更新状态

**工具约束**：
- 禁止调用 delegate、spawn_agent、memory_write
- 优先使用 skill 提供的 CLI 工具（teamsland、lark-cli）

**异常处理**：
- 权限不足 → 回报 blocked，说明需要的权限
- 文件/路径不存在 → 回报 blocked，说明缺失的资源
- 网络错误 → 重试一次，仍失败则回报 blocked
- 不要自行 spawn 子进程或委派任务

### 环境变量

| 变量 | 值 |
|------|-----|
| WORKER_ID | ${ctx.workerId} |
| TEAMSLAND_API_BASE | ${ctx.teamslandApiBase} |
| MEEGO_API_BASE | ${ctx.meegoApiBase} |
| MEEGO_PLUGIN_TOKEN | ${ctx.meegoPluginToken} |
| LARK_CHAT_ID | ${ctx.chatId} |
| LARK_MESSAGE_ID | ${ctx.messageId} |
| LARK_USER_ID | ${ctx.requester} |
`;
  }
}
