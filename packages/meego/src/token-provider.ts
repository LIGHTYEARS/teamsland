import { createLogger } from "@teamsland/observability";

const logger = createLogger("meego:token-provider");

export interface MeegoTokenProviderOpts {
  /** Meego OpenAPI 基础地址，如 https://meego.larkoffice.com */
  baseUrl: string;
  /** 插件 ID */
  pluginId: string;
  /** 插件 Secret */
  pluginSecret: string;
  /** 可注入的 fetch 函数，用于测试 */
  fetchFn?: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
}

/**
 * Meego plugin_access_token 自动管理。
 *
 * 通过 Plugin ID + Secret 换取临时 token（有效期约 2 小时），
 * 缓存并在过期前 5 分钟自动刷新。
 */
export class MeegoTokenProvider {
  private readonly baseUrl: string;
  private readonly pluginId: string;
  private readonly pluginSecret: string;
  private readonly fetchFn: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

  private cachedToken: string | null = null;
  private expiresAt = 0; // Unix ms
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingRefresh: Promise<string> | null = null;

  /** 过期前提前刷新的毫秒数 */
  private static readonly REFRESH_MARGIN_MS = 5 * 60 * 1000;

  constructor(opts: MeegoTokenProviderOpts) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, "");
    this.pluginId = opts.pluginId;
    this.pluginSecret = opts.pluginSecret;
    this.fetchFn = opts.fetchFn ?? globalThis.fetch;
  }

  /**
   * 获取有效的 plugin_access_token。
   * 首次调用会发起 HTTP 请求，后续返回缓存值直到即将过期。
   */
  async getToken(): Promise<string> {
    if (this.cachedToken && Date.now() < this.expiresAt - MeegoTokenProvider.REFRESH_MARGIN_MS) {
      return this.cachedToken;
    }
    return this.refresh();
  }

  /** 清理定时器，释放资源 */
  dispose(): void {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }
    this.cachedToken = null;
    this.pendingRefresh = null;
  }

  private async refresh(): Promise<string> {
    // 合并并发刷新请求
    if (this.pendingRefresh) return this.pendingRefresh;

    this.pendingRefresh = this.doRefresh();
    try {
      return await this.pendingRefresh;
    } finally {
      this.pendingRefresh = null;
    }
  }

  private async doRefresh(): Promise<string> {
    const url = `${this.baseUrl}/open_api/authen/plugin_token`;
    logger.info("正在刷新 plugin_access_token …");

    const resp = await this.fetchFn(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        plugin_id: this.pluginId,
        plugin_secret: this.pluginSecret,
      }),
    });

    const raw = (await resp.json()) as Record<string, unknown>;
    const data = raw.data as Record<string, unknown> | undefined;

    if (!data?.token) {
      const msg = `plugin_token 刷新失败: ${JSON.stringify(raw)}`;
      logger.error(msg);
      throw new Error(msg);
    }

    const token = data.token as string;
    const expireTtlSeconds = data.expire_time as number; // 相对过期时间（秒），如 7200
    const expiresAt = Date.now() + expireTtlSeconds * 1000;

    this.cachedToken = token;
    this.expiresAt = expiresAt;

    // 安排提前刷新
    this.scheduleRefresh();

    logger.info({ expiresAt: new Date(expiresAt).toISOString() }, "plugin_access_token 已刷新");
    return token;
  }

  private scheduleRefresh(): void {
    if (this.refreshTimer) clearTimeout(this.refreshTimer);

    const delay = this.expiresAt - Date.now() - MeegoTokenProvider.REFRESH_MARGIN_MS;
    if (delay <= 0) return; // 已经在刷新窗口内

    this.refreshTimer = setTimeout(() => {
      this.refresh().catch((err) => {
        logger.error({ err }, "定时刷新 plugin_access_token 失败");
      });
    }, delay);

    // 不阻止进程退出
    if (this.refreshTimer && typeof this.refreshTimer === "object" && "unref" in this.refreshTimer) {
      this.refreshTimer.unref();
    }
  }
}
