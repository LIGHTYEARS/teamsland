import { createLogger } from "@teamsland/observability";
import type { MeegoConfig, MeegoEvent } from "@teamsland/types";
import type { MeegoEventBus } from "./event-bus.js";

const logger = createLogger("meego:connector");

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
 * @example
 * ```typescript
 * import { Database } from "bun:sqlite";
 * import { MeegoEventBus, MeegoConnector } from "@teamsland/meego";
 * import type { MeegoConfig } from "@teamsland/types";
 *
 * const db = new Database(":memory:");
 * const bus = new MeegoEventBus(db);
 * const config: MeegoConfig = {
 *   spaces: [{ spaceId: "xxx", name: "开放平台前端" }],
 *   eventMode: "webhook",
 *   webhook: { host: "0.0.0.0", port: 8080, path: "/meego/webhook" },
 *   poll: { intervalSeconds: 60, lookbackMinutes: 5 },
 *   longConnection: { enabled: false, reconnectIntervalSeconds: 10 },
 * };
 *
 * const connector = new MeegoConnector({ config, eventBus: bus });
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

  /**
   * @param opts.config - Meego 完整配置
   * @param opts.eventBus - 已构建的 MeegoEventBus 实例
   *
   * @example
   * ```typescript
   * const connector = new MeegoConnector({ config, eventBus: bus });
   * ```
   */
  constructor(opts: { config: MeegoConfig; eventBus: MeegoEventBus }) {
    this.config = opts.config;
    this.eventBus = opts.eventBus;
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
    const { host, port, path } = this.config.webhook;
    const eventBus = this.eventBus;

    const server = Bun.serve({
      hostname: host,
      port,
      fetch: async (req) => {
        const url = new URL(req.url);

        // 健康检查端点
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

        let event: MeegoEvent;
        try {
          event = (await req.json()) as MeegoEvent;
        } catch {
          return new Response("Bad Request", { status: 400 });
        }

        await eventBus.handle(event);
        return new Response("OK", { status: 200 });
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
    const eventBus = this.eventBus;

    const poll = async (): Promise<void> => {
      logger.debug({ lookbackMinutes }, "poll tick");
      // 占位实现：真实 Meego REST API 接入时替换此处
      // const since = Date.now() - lookbackMinutes * 60 * 1000;
      // const events = await fetchMeegoEvents(since);
      // for (const event of events) { await eventBus.handle(event); }
      void lookbackMinutes;
      void eventBus;
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
   * 实现 EventSource-like 长连接，支持指数退避重连。
   * 连接断开时按 `reconnectIntervalSeconds * 2^retryCount`（最大 300s）等待后重连。
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

    const connect = async (): Promise<void> => {
      let retryCount = 0;

      while (true) {
        if (signal?.aborted) {
          logger.info("long-connection terminated by signal");
          return;
        }

        logger.debug({ retryCount }, "long-connection attempt");

        try {
          // 占位实现：真实 EventSource/SSE endpoint 接入时替换此处
          await new Promise<void>((resolve) => setTimeout(resolve, 1000));
          retryCount = 0; // 成功连接后重置重试计数
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

    logger.info({ reconnectIntervalSeconds }, "long-connection started");
  }
}
