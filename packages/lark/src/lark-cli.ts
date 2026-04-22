import type { LarkConfig } from "@teamsland/types";
import type { CommandRunner } from "./command-runner.js";
import type { LarkCard, LarkContact, LarkGroup, LarkMessage } from "./types.js";

/** lark-cli JSON 响应通用外壳 */
interface LarkCliResponse<T> {
  ok: boolean;
  identity?: string;
  data?: T;
}

/** lark-cli im +chat-messages-list 的 data 结构 */
interface LarkChatMessagesData {
  messages?: Array<{
    message_id?: string;
    content?: string;
    msg_type?: string;
    create_time?: string;
    sender?: { id?: string; name?: string; sender_type?: string };
    mentions?: Array<{ key?: string; id?: string; name?: string }>;
  }>;
  has_more?: boolean;
  page_token?: string;
  total?: number;
}

/**
 * lark-cli 命令执行错误
 *
 * 当 lark-cli 命令执行失败时抛出，包含命令、退出码和标准错误输出
 *
 * @example
 * ```typescript
 * import { LarkCliError } from "@teamsland/lark";
 *
 * try {
 *   await cli.sendDm("ou_user001", "hello");
 * } catch (err) {
 *   if (err instanceof LarkCliError) {
 *     console.error(`命令失败: ${err.command.join(" ")}, 退出码: ${err.exitCode}`);
 *   }
 * }
 * ```
 */
export class LarkCliError extends Error {
  constructor(
    message: string,
    public readonly command: string[],
    public readonly exitCode: number,
    public readonly stderr: string,
  ) {
    super(message);
    this.name = "LarkCliError";
  }
}

/**
 * 飞书官方 CLI (@larksuite/cli) 命令行工具封装
 *
 * 通过注入 CommandRunner 调用外部 lark-cli 二进制文件，
 * 提供消息发送、文档操作、联系人和群组查询等功能。
 * 认证由 CLI 内部管理（OS 钥匙串），无需传递 appId/appSecret 环境变量。
 *
 * @example
 * ```typescript
 * import { BunCommandRunner, LarkCli } from "@teamsland/lark";
 * import type { LarkConfig } from "@teamsland/types";
 *
 * const config: LarkConfig = {
 *   appId: "cli_xxx",
 *   appSecret: "secret_xxx",
 *   bot: { historyContextCount: 20 },
 *   notification: { teamChannelId: "oc_xxx" },
 * };
 * const cli = new LarkCli(config, new BunCommandRunner());
 * await cli.sendDm("ou_user001", "你好");
 * ```
 */
export class LarkCli {
  private readonly historyContextCount: number;

  constructor(
    config: LarkConfig,
    private readonly runner: CommandRunner,
  ) {
    this.historyContextCount = config.bot.historyContextCount;
  }

  /**
   * 发送私聊消息
   *
   * @param userId - 接收人的 open_id
   * @param text - 消息文本内容
   *
   * @example
   * ```typescript
   * await cli.sendDm("ou_user001", "你好，这是一条私聊消息");
   * ```
   */
  async sendDm(userId: string, text: string): Promise<void> {
    const cmd = ["lark-cli", "im", "+messages-send", "--as", "bot", "--user-id", userId, "--text", text];
    await this.exec(cmd);
  }

  /**
   * 发送群消息
   *
   * @param chatId - 群聊 ID
   * @param content - 消息内容
   * @param opts - 可选参数，支持回复指定消息
   *
   * @example
   * ```typescript
   * await cli.sendGroupMessage("oc_chat001", "大家好");
   * await cli.sendGroupMessage("oc_chat001", "收到", { replyToMessageId: "om_msg123" });
   * ```
   */
  async sendGroupMessage(chatId: string, content: string, opts?: { replyToMessageId?: string }): Promise<void> {
    if (opts?.replyToMessageId) {
      const cmd = [
        "lark-cli",
        "im",
        "+messages-reply",
        "--as",
        "bot",
        "--message-id",
        opts.replyToMessageId,
        "--text",
        content,
      ];
      await this.exec(cmd);
    } else {
      const cmd = ["lark-cli", "im", "+messages-send", "--as", "bot", "--chat-id", chatId, "--text", content];
      await this.exec(cmd);
    }
  }

  /**
   * 发送互动卡片消息
   *
   * @param chatId - 群聊 ID
   * @param card - 卡片数据对象
   *
   * @example
   * ```typescript
   * await cli.sendInteractiveCard("oc_chat001", {
   *   title: "部署通知",
   *   content: "v1.0.0 已上线",
   *   level: "info",
   * });
   * ```
   */
  async sendInteractiveCard(chatId: string, card: LarkCard): Promise<void> {
    const cmd = [
      "lark-cli",
      "im",
      "+messages-send",
      "--as",
      "bot",
      "--chat-id",
      chatId,
      "--msg-type",
      "interactive",
      "--content",
      JSON.stringify(card),
    ];
    await this.exec(cmd);
  }

  /**
   * 获取群聊历史消息
   *
   * @param chatId - 群聊 ID
   * @param count - 获取条数，默认使用配置中的 historyContextCount
   * @returns 消息数组
   *
   * @example
   * ```typescript
   * const messages = await cli.imHistory("oc_chat001", 20);
   * for (const msg of messages) {
   *   console.log(`${msg.sender}: ${msg.content}`);
   * }
   * ```
   */
  async imHistory(chatId: string, count?: number): Promise<LarkMessage[]> {
    const effectiveCount = count ?? this.historyContextCount;
    const cmd = [
      "lark-cli",
      "im",
      "+chat-messages-list",
      "--as",
      "bot",
      "--chat-id",
      chatId,
      "--page-size",
      String(effectiveCount),
      "--format",
      "json",
    ];
    const result = await this.exec(cmd);
    const raw = this.parseJson<LarkCliResponse<LarkChatMessagesData>>(result.stdout, cmd);
    const messages = raw.data?.messages ?? [];
    return messages.map((m) => ({
      messageId: m.message_id ?? "",
      sender: m.sender?.name ?? m.sender?.id ?? "",
      content: m.content ?? "",
      timestamp: m.create_time ? new Date(m.create_time).getTime() : 0,
    }));
  }

  /**
   * 读取飞书文档内容
   *
   * @param url - 文档 URL 或 token
   * @returns 文档内容字符串
   *
   * @example
   * ```typescript
   * const content = await cli.docRead("https://docs.feishu.cn/wiki/abc123");
   * console.log(content);
   * ```
   */
  async docRead(url: string): Promise<string> {
    const cmd = ["lark-cli", "docs", "+fetch", "--doc", url, "--format", "json"];
    const result = await this.exec(cmd);
    return result.stdout;
  }

  /**
   * 创建飞书文档
   *
   * @param title - 文档标题
   * @param content - 文档 Markdown 内容
   * @returns 新文档的 URL
   *
   * @example
   * ```typescript
   * const url = await cli.docCreate("会议纪要", "# 2026-04-20 周会\n\n...");
   * console.log(`文档已创建: ${url}`);
   * ```
   */
  async docCreate(title: string, content: string): Promise<string> {
    const cmd = ["lark-cli", "docs", "+create", "--title", title, "--markdown", content];
    const result = await this.exec(cmd);
    return result.stdout.trim();
  }

  /**
   * 搜索飞书联系人
   *
   * @param query - 搜索关键词
   * @param limit - 返回结果数量限制
   * @returns 联系人数组
   *
   * @example
   * ```typescript
   * const contacts = await cli.contactSearch("张三", 5);
   * for (const c of contacts) {
   *   console.log(`${c.name} (${c.department})`);
   * }
   * ```
   */
  async contactSearch(query: string, limit?: number): Promise<LarkContact[]> {
    const cmd = ["lark-cli", "contact", "+search-user", "--query", query, "--format", "json"];
    if (limit !== undefined) {
      cmd.push("--page-size", String(limit));
    }
    const result = await this.exec(cmd);
    return this.parseJson<LarkContact[]>(result.stdout, cmd);
  }

  /**
   * 搜索飞书群组
   *
   * @param query - 搜索关键词
   * @param limit - 返回结果数量限制
   * @returns 群组数组
   *
   * @example
   * ```typescript
   * const groups = await cli.groupSearch("前端", 10);
   * for (const g of groups) {
   *   console.log(`${g.name}: ${g.description}`);
   * }
   * ```
   */
  async groupSearch(query: string, limit?: number): Promise<LarkGroup[]> {
    const cmd = ["lark-cli", "im", "+chat-search", "--query", query, "--format", "json"];
    if (limit !== undefined) {
      cmd.push("--page-size", String(limit));
    }
    const result = await this.exec(cmd);
    return this.parseJson<LarkGroup[]>(result.stdout, cmd);
  }

  /**
   * 列出已加入的群组
   *
   * @param filter - 可选的过滤关键词（有值时使用搜索，无值时列出全部）
   * @returns 群组数组
   *
   * @example
   * ```typescript
   * const allGroups = await cli.groupListJoined();
   * const filtered = await cli.groupListJoined("前端");
   * ```
   */
  async groupListJoined(filter?: string): Promise<LarkGroup[]> {
    let cmd: string[];
    if (filter !== undefined) {
      cmd = ["lark-cli", "im", "+chat-search", "--query", filter, "--format", "json"];
    } else {
      cmd = ["lark-cli", "im", "chats", "list", "--format", "json"];
    }
    const result = await this.exec(cmd);
    return this.parseJson<LarkGroup[]>(result.stdout, cmd);
  }

  private async exec(cmd: string[]): Promise<{ stdout: string; stderr: string }> {
    const result = await this.runner.run(cmd);

    if (result.exitCode === 127) {
      throw new LarkCliError(
        "lark-cli is not installed. Please install it first: npm install -g @larksuite/cli",
        cmd,
        result.exitCode,
        result.stderr,
      );
    }

    if (result.exitCode !== 0) {
      throw new LarkCliError(
        `lark-cli command failed with exit code ${result.exitCode}: ${result.stderr}`,
        cmd,
        result.exitCode,
        result.stderr,
      );
    }

    return { stdout: result.stdout, stderr: result.stderr };
  }

  private parseJson<T>(stdout: string, cmd: string[]): T {
    try {
      return JSON.parse(stdout) as T;
    } catch {
      throw new LarkCliError(
        `Failed to parse lark-cli output as JSON (format error): ${stdout.slice(0, 200)}`,
        cmd,
        0,
        "",
      );
    }
  }
}
