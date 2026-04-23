import { createHmac, timingSafeEqual } from "node:crypto";
import { createLogger } from "@teamsland/observability";
import type { EnqueueFn, MeegoConfig, MeegoEvent, MeegoEventType } from "@teamsland/types";
import type { MeegoEventBus } from "./event-bus.js";

const logger = createLogger("meego:connector");

/**
 * 从 Meego OpenAPI 拉取指定空间自 `since` 以来的事件列表
 *
 * 使用 `plugin_access_token` 认证，请求 `/work_item/filter` 接口。
 * 返回的原始数据被转换为 `MeegoEvent[]` 格式供 EventBus 消费。
 * 网络或解析错误时返回空数组并记录警告日志。
 *
 * @param apiBaseUrl - Meego OpenAPI 基础地址
 * @param token - 插件访问令牌
 * @param spaceId - Meego 空间 ID
 * @param since - 起始时间戳（Unix 毫秒）
 * @returns 事件数组
 *
 * @example
 * ```typescript
 * const events = await fetchMeegoEvents("https://project.feishu.cn/open_api", "token", "space1", Date.now() - 300000);
 * ```
 */
async function fetchMeegoEvents(
  apiBaseUrl: string,
  token: string,
  spaceId: string,
  since: number,
): Promise<MeegoEvent[]> {
  const url = `${apiBaseUrl}/${spaceId}/work_item/filter`;
  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Plugin-Token": token,
      },
      body: JSON.stringify({
        work_item_type_keys: ["story", "bug", "task"],
        updated_at_min: Math.floor(since / 1000),
      }),
    });

    if (!resp.ok) {
      logger.warn({ status: resp.status, spaceId, url }, "Meego API 返回非 200 状态");
      return [];
    }

    const body = (await resp.json()) as {
      data?: Array<{
        id: string;
        name: string;
        work_item_type_key: string;
        updated_at: number;
        [key: string]: unknown;
      }>;
    };

    if (!body.data || !Array.isArray(body.data)) return [];

    return body.data.map((item) => ({
      eventId: `poll-${spaceId}-${item.id}-${item.updated_at}`,
      issueId: item.id,
      projectKey: spaceId,
      type: "issue.created" as const,
      payload: { title: item.name, ...item },
      timestamp: item.updated_at * 1000,
    }));
  } catch (err: unknown) {
    logger.warn({ spaceId, err }, "Meego API 调用失败");
    return [];
  }
}

/** 处理 webhook POST 请求：验签 → JSON 解析 → 事件分发 */
async function handleWebhookPost(
  req: Request,
  secret: string | undefined,
  dispatch: (event: MeegoEvent) => Promise<void>,
): Promise<Response> {
  let rawBody: string;
  try {
    rawBody = await req.text();
  } catch {
    return new Response("Bad Request", { status: 400 });
  }

  if (secret) {
    const signature = req.headers.get("x-meego-signature");
    if (!signature || !verifySignature(rawBody, signature, secret)) {
      logger.warn("webhook 签名验证失败或缺少签名头");
      return new Response("Unauthorized", { status: 401 });
    }
  }

  let event: MeegoEvent;
  try {
    event = JSON.parse(rawBody) as MeegoEvent;
  } catch {
    return new Response("Bad Request", { status: 400 });
  }

  await dispatch(event);
  return new Response("OK", { status: 200 });
}
function verifySignature(rawBody: string, signature: string, secret: string): boolean {
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const sigBuffer = Buffer.from(signature, "hex");
  const expectedBuffer = Buffer.from(expected, "hex");
  return sigBuffer.length === expectedBuffer.length && timingSafeEqual(sigBuffer, expectedBuffer);
}

/**
 * 将 MeegoEventType 映射为队列消息类型字符串
 *
 * @example
 * ```typescript
 * mapEventTypeToQueueType("issue.created"); // => "meego_issue_created"
 * ```
 */
function mapEventTypeToQueueType(eventType: MeegoEventType): string {
  const mapping: Record<string, string> = {
    "issue.created": "meego_issue_created",
    "issue.status_changed": "meego_issue_status_changed",
    "issue.assigned": "meego_issue_assigned",
    "sprint.started": "meego_sprint_started",
  };
  return mapping[eventType] ?? "meego_issue_created";
}

/**
 * MeegoConnector 构造参数
 *
 * @example
 * ```typescript
 * import type { MeegoConnectorOpts } from "@teamsland/meego";
 *
 * const opts: MeegoConnectorOpts = { config, eventBus: bus };
 * ```
 */
export interface MeegoConnectorOpts {
  /** Meego 完整配置 */
  config: MeegoConfig;
  /** @deprecated 旧事件总线，双写过渡期保留 */
  eventBus: MeegoEventBus;
  /** 消息入队函数，新的队列路径（可选，双写过渡期） */
  enqueue?: EnqueueFn;
}

/**
 * Meego 事件连接器
 *
 * 根据 `config.eventMode` 启动一种或多种事件接收模式：
 * - `"webhook"` — 启动 Bun HTTP 服务器接收推送
 * - `"poll"` — 定时轮询 Meego API 拉取最近事件
 * - `"both"` — 同时启动 webhook 和 poll
 *
 * 长连接（`longConnection.enabled: true`）始终独立于 eventMode 运行。
 *
 * 支持双写模式：若提供 `enqueue`，事件同时入队到 PersistentQueue；
 * 同时始终经过 `eventBus.handle()` 保持向后兼容。
 *
 * @example
 * ```typescript
 * import { Database } from "bun:sqlite";
 * import { MeegoEventBus, MeegoConnector } from "@teamsland/meego";
 * import type { MeegoConfig, EnqueueFn } from "@teamsland/types";
 *
 * const db = new Database(":memory:");
 * const bus = new MeegoEventBus(db);
 * const enqueue: EnqueueFn = (opts) => "msg-id";
 * const config: MeegoConfig = {
 *   spaces: [{ spaceId: "xxx", name: "开放平台前端" }],
 *   eventMode: "webhook",
 *   webhook: { host: "0.0.0.0", port: 8080, path: "/meego/webhook" },
 *   poll: { intervalSeconds: 60, lookbackMinutes: 5 },
 *   longConnection: { enabled: false, reconnectIntervalSeconds: 10 },
 *   apiBaseUrl: "https://project.feishu.cn/open_api",
 *   pluginAccessToken: "",
 * };
 *
 * const connector = new MeegoConnector({ config, eventBus: bus, enqueue });
 * const controller = new AbortController();
 * await connector.start(controller.signal);
 *
 * // 优雅停止
 * controller.abort();
 * ```
 */
export class MeegoConnector {
  private readonly config: MeegoConfig;
  private readonly eventBus: MeegoEventBus;
  private readonly enqueue: EnqueueFn | undefined;

  /**
   * @param opts - 连接器配置，包含 eventBus（必需）和 enqueue（可选，双写路径）
   *
   * @example
   * ```typescript
   * const connector = new MeegoConnector({ config, eventBus: bus, enqueue });
   * ```
   */
  constructor(opts: MeegoConnectorOpts) {
    this.config = opts.config;
    this.eventBus = opts.eventBus;
    this.enqueue = opts.enqueue;
  }

  /**
   * 统一事件分发
   *
   * 若 `enqueue` 已设置，将事件入队到 PersistentQueue；
   * 同时始终经过 `eventBus.handle()` 保持向后兼容（双写过渡期）。
   *
   * @param event - 待分发的 MeegoEvent
   *
   * @example
   * ```typescript
   * await connector['dispatchEvent'](event);
   * ```
   */
  private async dispatchEvent(event: MeegoEvent): Promise<void> {
    if (this.enqueue) {
      try {
        this.enqueue({
          type: mapEventTypeToQueueType(event.type),
          payload: { event },
          traceId: event.eventId,
        });
      } catch (err: unknown) {
        logger.error({ err, eventId: event.eventId }, "队列入队失败，回退到 EventBus");
      }
    }
    await this.eventBus.handle(event);
  }

  /**
   * 启动事件接收
   *
   * 根据 `config.eventMode` 并发启动对应模式，所有模式共用同一 `signal` 控制停止。
   * `signal` 触发时，webhook 服务器关闭，poll timer 清除，长连接循环终止。
   *
   * @param signal - 可选的 AbortSignal，用于优雅停止
   *
   * @example
   * ```typescript
   * const ac = new AbortController();
   * await connector.start(ac.signal);
   * setTimeout(() => ac.abort(), 5000); // 5 秒后停止
   * ```
   */
  async start(signal?: AbortSignal): Promise<void> {
    const { eventMode, longConnection } = this.config;

    if (eventMode === "webhook" || eventMode === "both") {
      this.startWebhook(signal);
    }
    if (eventMode === "poll" || eventMode === "both") {
      this.startPoll(signal);
    }
    if (longConnection.enabled) {
      this.startLongConnection(signal);
    }
  }

  /**
   * 启动 Webhook 模式（私有）
   *
   * 使用 `Bun.serve` 在 `config.webhook.host:port` 监听 HTTP POST 请求。
   * 校验请求方法，解析 body 为 `MeegoEvent`，调用 `eventBus.handle(event)`，返回 `200 OK`。
   * 非 POST 请求返回 `405 Method Not Allowed`；JSON 解析失败返回 `400 Bad Request`。
   *
   * @param signal - AbortSignal，触发时关闭 Bun.serve 服务器
   *
   * @example
   * ```typescript
   * // 内部调用，由 start() 驱动
   * this.startWebhook(signal);
   * ```
   */
  private startWebhook(signal?: AbortSignal): void {
    const { host, port, path, secret } = this.config.webhook;
    const dispatch = (event: MeegoEvent) => this.dispatchEvent(event);

    if (!secret) {
      logger.warn("webhook.secret 未配置，跳过签名验证 — 生产环境请务必设置");
    }

    const server = Bun.serve({
      hostname: host,
      port,
      fetch: async (req) => {
        const url = new URL(req.url);

        // 健康检查端点（免验签）
        if (req.method === "GET" && url.pathname === "/health") {
          return new Response(JSON.stringify({ status: "ok", uptime: process.uptime() }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }

        if (req.method !== "POST") {
          return new Response("Method Not Allowed", { status: 405 });
        }

        if (url.pathname !== path) {
          return new Response("Not Found", { status: 404 });
        }

        return handleWebhookPost(req, secret, dispatch);
      },
    });

    signal?.addEventListener("abort", () => {
      server.stop(true);
      logger.info("webhook server stopped");
    });

    logger.info({ host, port, path }, "webhook server started");
  }

  /**
   * 启动轮询模式（私有）
   *
   * 使用 `setInterval` 每 `config.poll.intervalSeconds * 1000` 毫秒执行一次拉取。
   * 每次拉取调用占位 fetch 获取近 `lookbackMinutes` 分钟的事件列表，
   * 逐条调用 `eventBus.handle(event)`。signal 触发时清除 interval。
   *
   * @param signal - AbortSignal，触发时清除 setInterval
   *
   * @example
   * ```typescript
   * // 内部调用，由 start() 驱动
   * this.startPoll(signal);
   * ```
   */
  private startPoll(signal?: AbortSignal): void {
    const { intervalSeconds, lookbackMinutes } = this.config.poll;
    const { spaces, apiBaseUrl, pluginAccessToken } = this.config;

    if (!pluginAccessToken) {
      logger.warn("pluginAccessToken 未配置，轮询模式将跳过 API 调用");
    }

    const poll = async (): Promise<void> => {
      if (!pluginAccessToken) return;
      const since = Date.now() - lookbackMinutes * 60 * 1000;
      logger.debug({ lookbackMinutes, since, spaceCount: spaces.length }, "poll tick");

      for (const space of spaces) {
        const events = await fetchMeegoEvents(apiBaseUrl, pluginAccessToken, space.spaceId, since);
        for (const event of events) {
          await this.dispatchEvent(event);
        }
      }
    };

    const timer = setInterval(() => {
      poll().catch((err) => {
        logger.error({ error: err }, "poll error");
      });
    }, intervalSeconds * 1000);

    signal?.addEventListener("abort", () => {
      clearInterval(timer);
      logger.info("poll stopped");
    });

    logger.info({ intervalSeconds, lookbackMinutes }, "poll started");
  }

  /**
   * 启动长连接模式（私有）
   *
   * 使用 fetch-based SSE 流读取 Meego 实时事件推送。
   * 连接断开时按 `reconnectIntervalSeconds * 2^retryCount`（最大 300s）等待后重连。
   * 支持 `Last-Event-ID` 头实现断点续传。
   * signal 触发时终止重连循环。
   *
   * @param signal - AbortSignal，触发时终止重连循环
   *
   * @example
   * ```typescript
   * // 内部调用，由 start() 驱动（仅 longConnection.enabled=true 时）
   * this.startLongConnection(signal);
   * ```
   */
  private startLongConnection(signal?: AbortSignal): void {
    const { reconnectIntervalSeconds } = this.config.longConnection;
    const { apiBaseUrl, pluginAccessToken } = this.config;
    const dispatch = (event: MeegoEvent) => this.dispatchEvent(event);

    if (!pluginAccessToken) {
      logger.warn("pluginAccessToken 未配置，长连接模式将跳过");
      return;
    }

    const sseUrl = `${apiBaseUrl}/events/stream`;

    const connect = async (): Promise<void> => {
      let retryCount = 0;
      let lastEventId = "";

      while (true) {
        if (signal?.aborted) {
          logger.info("long-connection terminated by signal");
          return;
        }

        logger.debug({ retryCount, lastEventId }, "long-connection attempt");

        try {
          await consumeSseStream(sseUrl, pluginAccessToken, lastEventId, dispatch, signal, (id) => {
            lastEventId = id;
          });
          retryCount = 0;
        } catch (err) {
          logger.warn({ error: err, retryCount }, "long-connection error, will retry");
        }

        if (signal?.aborted) return;

        const cappedRetry = Math.min(retryCount, 8);
        const waitMs = Math.min(reconnectIntervalSeconds * 2 ** cappedRetry, 300) * 1000;
        logger.debug({ waitMs, retryCount }, "long-connection backoff");
        await new Promise<void>((resolve) => setTimeout(resolve, waitMs));
        retryCount++;
      }
    };

    connect().catch((err) => {
      logger.error({ error: err }, "long-connection fatal");
    });

    logger.info({ reconnectIntervalSeconds, sseUrl }, "long-connection started");
  }
}

/** SSE 行解析上下文 */
interface SseParseContext {
  dataLines: string[];
  onId: (id: string) => void;
  onEvent: (raw: string) => Promise<void>;
}

/** 处理单条 SSE 行 */
async function processSseLine(line: string, ctx: SseParseContext): Promise<void> {
  if (line.startsWith("id:")) {
    ctx.onId(line.slice(3).trim());
  } else if (line.startsWith("data:")) {
    ctx.dataLines.push(line.slice(5).trim());
  } else if (line === "" && ctx.dataLines.length > 0) {
    const raw = ctx.dataLines.join("\n");
    ctx.dataLines.length = 0;
    await ctx.onEvent(raw);
  }
}

/** 尝试解析并分发一条 SSE JSON 事件 */
async function dispatchSseEvent(raw: string, dispatch: (event: MeegoEvent) => Promise<void>): Promise<void> {
  try {
    const event = JSON.parse(raw) as MeegoEvent;
    await dispatch(event);
  } catch (parseErr: unknown) {
    logger.warn({ raw: raw.slice(0, 200), err: parseErr }, "SSE 事件解析失败");
  }
}

/**
 * 消费 SSE 流：打开 fetch 连接，逐行解析 `text/event-stream` 协议
 *
 * SSE 协议格式：
 * - `id: <value>`     → 更新 lastEventId（用于断点续传）
 * - `event: <value>`  → 可选的事件类型（此处不使用）
 * - `data: <value>`   → JSON 数据行，可多行拼接
 * - 空行              → 分发已积累的 data 作为一条完整事件
 *
 * 连接关闭（流结束 / 非 200 响应）时正常返回，让外层重连循环处理。
 *
 * @param url - SSE 端点地址
 * @param token - 插件访问令牌
 * @param lastEventId - 上次接收到的事件 ID（空串表示从头开始）
 * @param dispatch - 事件分发函数
 * @param signal - 取消信号
 * @param onId - 每收到 `id:` 行时的回调，用于更新外层 lastEventId
 */
async function consumeSseStream(
  url: string,
  token: string,
  lastEventId: string,
  dispatch: (event: MeegoEvent) => Promise<void>,
  signal: AbortSignal | undefined,
  onId: (id: string) => void,
): Promise<void> {
  const headers: Record<string, string> = {
    "X-Plugin-Token": token,
    Accept: "text/event-stream",
    "Cache-Control": "no-cache",
  };
  if (lastEventId) {
    headers["Last-Event-ID"] = lastEventId;
  }

  const resp = await fetch(url, { method: "GET", headers, signal });

  if (!resp.ok) {
    throw new Error(`SSE connect failed: ${resp.status}`);
  }

  if (!resp.body) {
    throw new Error("SSE response has no body");
  }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const ctx: SseParseContext = {
    dataLines: [],
    onId,
    onEvent: (raw) => dispatchSseEvent(raw, dispatch),
  };

  try {
    while (true) {
      if (signal?.aborted) return;

      const { done, value } = await reader.read();
      if (done) {
        logger.debug("SSE stream ended");
        return;
      }

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        await processSseLine(line, ctx);
      }
    }
  } finally {
    reader.releaseLock();
  }
}
