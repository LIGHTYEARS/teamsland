import type { MeegoEventBus } from "@teamsland/meego";
import { createLogger } from "@teamsland/observability";
import type { LarkConnectorConfig, MeegoEvent } from "@teamsland/types";
import type { LarkCli } from "./lark-cli.js";

const logger = createLogger("lark:connector");

/** 重连基准间隔（ms） */
const BASE_RECONNECT_MS = 5_000;
/** 最大重连间隔（ms） */
const MAX_RECONNECT_MS = 300_000;

/**
 * 飞书 NDJSON 事件中的原始消息结构（`--compact` 模式下）
 *
 * @example
 * ```typescript
 * const raw: LarkRawEvent = JSON.parse(ndjsonLine);
 * if (raw.header?.event_type === "im.message.receive_v1") { ... }
 * ```
 */
interface LarkRawEvent {
  header?: {
    event_id?: string;
    event_type?: string;
  };
  event?: {
    sender?: {
      sender_id?: { open_id?: string; user_id?: string };
      sender_type?: string;
    };
    message?: {
      message_id?: string;
      chat_id?: string;
      chat_type?: string;
      content?: string;
      message_type?: string;
      mentions?: Array<{ key?: string; id?: { open_id?: string }; name?: string }>;
      create_time?: string;
    };
  };
}

/**
 * LarkConnector 构造参数
 *
 * @example
 * ```typescript
 * import { LarkConnector } from "@teamsland/lark";
 *
 * const connector = new LarkConnector({
 *   config: { enabled: true, eventTypes: ["im.message.receive_v1"], chatProjectMapping: {} },
 *   larkCli,
 *   eventBus,
 *   historyContextCount: 20,
 * });
 * ```
 */
export interface LarkConnectorOpts {
  config: LarkConnectorConfig;
  larkCli: LarkCli;
  eventBus: MeegoEventBus;
  historyContextCount: number;
}

/**
 * 飞书实时事件连接器
 *
 * 通过 `lark-cli event +subscribe` 订阅飞书事件（WebSocket + NDJSON 输出），
 * 将群聊中 @机器人 的消息桥接为 MeegoEvent 注入到现有事件管线。
 *
 * 进程退出后自动指数退避重连。`AbortSignal` 控制优雅关闭。
 *
 * @example
 * ```typescript
 * import { LarkConnector } from "@teamsland/lark";
 *
 * const connector = new LarkConnector({ config, larkCli, eventBus, historyContextCount: 20 });
 * await connector.start(controller.signal);
 * ```
 */
export class LarkConnector {
  private readonly config: LarkConnectorConfig;
  private readonly larkCli: LarkCli;
  private readonly eventBus: MeegoEventBus;
  private readonly historyContextCount: number;

  constructor(opts: LarkConnectorOpts) {
    this.config = opts.config;
    this.larkCli = opts.larkCli;
    this.eventBus = opts.eventBus;
    this.historyContextCount = opts.historyContextCount;
  }

  /**
   * 启动飞书事件订阅
   *
   * 在后台启动 `lark-cli event +subscribe` 子进程并持续读取 NDJSON 输出。
   * 进程异常退出时自动重连（指数退避）。
   *
   * @param signal - 可选的 AbortSignal，用于优雅关闭
   *
   * @example
   * ```typescript
   * const controller = new AbortController();
   * await connector.start(controller.signal);
   * // 关闭：controller.abort();
   * ```
   */
  async start(signal?: AbortSignal): Promise<void> {
    const eventTypes = this.config.eventTypes.join(",");
    logger.info({ eventTypes }, "LarkConnector 启动中");

    this.runLoop(eventTypes, signal).catch((err: unknown) => {
      logger.error({ err }, "LarkConnector 致命错误");
    });
  }

  private async runLoop(eventTypes: string, signal?: AbortSignal): Promise<void> {
    let retryCount = 0;

    while (true) {
      if (signal?.aborted) return;

      try {
        await this.consumeProcess(eventTypes, signal);
        retryCount = 0;
      } catch (err: unknown) {
        logger.warn({ err, retryCount }, "lark-cli 事件流异常，即将重连");
      }

      if (signal?.aborted) return;

      const waitMs = Math.min(BASE_RECONNECT_MS * 2 ** Math.min(retryCount, 8), MAX_RECONNECT_MS);
      logger.info({ waitMs, retryCount }, "等待重连");
      await new Promise((r) => setTimeout(r, waitMs));
      retryCount++;
    }
  }

  private async consumeProcess(eventTypes: string, signal?: AbortSignal): Promise<void> {
    const cmd = ["lark-cli", "event", "+subscribe", "--as", "bot", "--event-types", eventTypes, "--quiet", "--force"];

    const proc = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe" });
    logger.info({ pid: proc.pid, eventTypes }, "lark-cli event +subscribe 已启动");

    const killProc = () => {
      try {
        proc.kill();
      } catch {
        // 进程可能已退出
      }
    };
    signal?.addEventListener("abort", killProc, { once: true });

    const reader = proc.stdout.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (true) {
        if (signal?.aborted) {
          killProc();
          return;
        }

        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          await this.handleLine(trimmed);
        }
      }
    } finally {
      reader.releaseLock();
      signal?.removeEventListener("abort", killProc);
    }

    const exitCode = await proc.exited;
    if (exitCode !== 0 && !signal?.aborted) {
      const stderr = await new Response(proc.stderr).text();
      throw new Error(`lark-cli 退出码 ${exitCode}: ${stderr.slice(0, 500)}`);
    }
  }

  private async handleLine(line: string): Promise<void> {
    let raw: LarkRawEvent;
    try {
      raw = JSON.parse(line) as LarkRawEvent;
    } catch {
      logger.warn({ line: line.slice(0, 200) }, "NDJSON 解析失败");
      return;
    }

    const mention = extractBotMention(raw);
    if (!mention) return;

    logger.info(
      { eventId: mention.eventId, chatId: mention.chatId, senderId: mention.senderId, messageId: mention.messageId },
      "收到群聊 @机器人 消息",
    );

    const event = await this.buildBridgeEvent(mention);
    if (!event) return;

    try {
      await this.eventBus.handle(event);
      logger.info({ eventId: event.eventId, issueId: event.issueId }, "Lark 消息已桥接到事件管线");
    } catch (err: unknown) {
      logger.error({ err, eventId: event.eventId }, "事件管线处理失败");
    }
  }

  private async buildBridgeEvent(mention: BotMention): Promise<MeegoEvent | null> {
    const text = extractPlainText(mention.content, mention.messageType);
    if (!text) {
      logger.warn({ eventId: mention.eventId, messageType: mention.messageType }, "无法提取文本内容，跳过");
      return null;
    }

    const projectKey = this.config.chatProjectMapping[mention.chatId];
    if (!projectKey) {
      logger.warn(
        { chatId: mention.chatId, eventId: mention.eventId },
        "群聊未配置项目映射（chatProjectMapping），跳过",
      );
      return null;
    }

    let historyContext = "";
    try {
      const messages = await this.larkCli.imHistory(mention.chatId, this.historyContextCount);
      historyContext = messages.map((m) => `${m.sender}: ${m.content}`).join("\n");
    } catch (err: unknown) {
      logger.warn({ err, chatId: mention.chatId }, "获取聊天历史失败，将不带历史上下文");
    }

    return {
      eventId: `lark-${mention.eventId}`,
      issueId: mention.messageId,
      projectKey,
      type: "issue.created",
      payload: {
        title: text,
        description: historyContext || text,
        chatId: mention.chatId,
        messageId: mention.messageId,
        senderId: mention.senderId,
        source: "lark_mention",
      },
      timestamp: mention.timestamp,
    };
  }
}

/** 从原始事件中提取的机器人 @mention 信息 */
interface BotMention {
  eventId: string;
  chatId: string;
  senderId: string;
  messageId: string;
  content: string | undefined;
  messageType: string | undefined;
  timestamp: number;
}

/**
 * 从原始飞书事件中提取群聊 @机器人 的有效信息
 *
 * 过滤条件：必须是 im.message.receive_v1、群聊消息、包含 @机器人 mention。
 * 不满足返回 null。
 *
 * @example
 * ```typescript
 * const mention = extractBotMention(rawEvent);
 * if (mention) { ... }
 * ```
 */
function extractBotMention(raw: LarkRawEvent): BotMention | null {
  if (raw.header?.event_type !== "im.message.receive_v1") return null;

  const msg = raw.event?.message;
  if (!msg || msg.chat_type !== "group") return null;

  const hasBotMention = msg.mentions?.some((m) => m.key === "@_user_1") ?? false;
  if (!hasBotMention) return null;

  return {
    eventId: raw.header?.event_id ?? msg.message_id ?? `lark-${Date.now()}`,
    chatId: msg.chat_id ?? "",
    senderId: raw.event?.sender?.sender_id?.open_id ?? "",
    messageId: msg.message_id ?? `lark-msg-${Date.now()}`,
    content: msg.content,
    messageType: msg.message_type,
    timestamp: msg.create_time ? Number(msg.create_time) : Date.now(),
  };
}

/**
 * 从飞书消息 content 中提取纯文本
 *
 * 飞书 text 消息格式：`{"text":"@_user_1 具体内容"}`
 * 去除 `@_user_N` 标记并 trim。
 *
 * @example
 * ```typescript
 * extractPlainText('{"text":"@_user_1 前端开发任务"}', "text");
 * // => "前端开发任务"
 * ```
 */
function extractPlainText(content: string | undefined, messageType: string | undefined): string {
  if (!content) return "";

  if (messageType !== "text") {
    // 非文本消息暂不处理
    return "";
  }

  try {
    const parsed = JSON.parse(content) as { text?: string };
    const rawText = parsed.text ?? "";
    // 去除 @_user_N 标记
    return rawText.replace(/@_user_\d+/g, "").trim();
  } catch {
    return content.trim();
  }
}
