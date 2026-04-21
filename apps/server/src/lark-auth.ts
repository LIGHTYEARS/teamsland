import { randomUUID } from "node:crypto";
import { createLogger } from "@teamsland/observability";
import type { DashboardAuthConfig, LarkConfig } from "@teamsland/types";

const logger = createLogger("server:lark-auth");

/** Lark OpenAPI 基础地址 */
const LARK_OPEN_BASE = "https://open.feishu.cn";

/**
 * 内存会话记录
 *
 * @example
 * ```typescript
 * const session: AuthSession = {
 *   userId: "ou_xxxx",
 *   name: "张三",
 *   department: "工程部",
 *   expiresAt: Date.now() + 8 * 3600_000,
 * };
 * ```
 */
export interface AuthSession {
  /** 飞书用户 open_id */
  userId: string;
  /** 用户名称 */
  name: string;
  /** 部门名称 */
  department: string;
  /** 过期时间戳（毫秒） */
  expiresAt: number;
}

/**
 * Lark OAuth 会话管理器
 *
 * 基于内存 Map 管理认证会话。通过 Lark OpenAPI 实现 OAuth 2.0 授权码流程。
 * 提供 `getAuthUrl()`、`handleCallback()`、`validate()` 三个核心方法。
 *
 * @example
 * ```typescript
 * import { LarkAuthManager } from "./lark-auth.js";
 *
 * const auth = new LarkAuthManager(larkConfig, dashboardAuthConfig, "http://localhost:3000");
 * const url = auth.getAuthUrl("/");
 * ```
 */
export class LarkAuthManager {
  private readonly sessions = new Map<string, AuthSession>();
  private readonly larkConfig: LarkConfig;
  private readonly authConfig: DashboardAuthConfig;
  private readonly baseUrl: string;

  constructor(larkConfig: LarkConfig, authConfig: DashboardAuthConfig, baseUrl: string) {
    this.larkConfig = larkConfig;
    this.authConfig = authConfig;
    this.baseUrl = baseUrl;
  }

  /**
   * 生成 Lark OAuth 授权 URL
   *
   * @param redirectPath - 登录成功后的前端跳转路径
   * @returns 完整的 Lark 授权页 URL
   *
   * @example
   * ```typescript
   * const url = auth.getAuthUrl("/dashboard");
   * // => "https://open.feishu.cn/open-apis/authen/v1/authorize?app_id=..."
   * ```
   */
  getAuthUrl(redirectPath: string): string {
    const redirectUri = `${this.baseUrl}/auth/lark/callback`;
    const state = encodeURIComponent(redirectPath);
    const params = new URLSearchParams({
      app_id: this.larkConfig.appId,
      redirect_uri: redirectUri,
      state,
    });
    return `${LARK_OPEN_BASE}/open-apis/authen/v1/authorize?${params.toString()}`;
  }

  /**
   * 处理 OAuth 回调，交换 code 并创建会话
   *
   * @param code - Lark 授权码
   * @returns 会话令牌和原始 redirect path
   *
   * @example
   * ```typescript
   * const { token, redirectPath } = await auth.handleCallback("code_xxx", "/");
   * ```
   */
  async handleCallback(code: string, state: string): Promise<{ token: string; redirectPath: string }> {
    const appAccessToken = await this.getAppAccessToken();
    const userAccessToken = await this.exchangeCode(appAccessToken, code);
    const userInfo = await this.getUserInfo(userAccessToken);

    if (this.authConfig.allowedDepartments.length > 0) {
      const allowed = this.authConfig.allowedDepartments.includes(userInfo.department);
      if (!allowed) {
        logger.warn({ userId: userInfo.userId, department: userInfo.department }, "用户部门不在白名单中");
        throw new Error(`Department not allowed: ${userInfo.department}`);
      }
    }

    const token = randomUUID();
    const session: AuthSession = {
      userId: userInfo.userId,
      name: userInfo.name,
      department: userInfo.department,
      expiresAt: Date.now() + this.authConfig.sessionTtlHours * 3600_000,
    };
    this.sessions.set(token, session);
    logger.info({ userId: userInfo.userId, name: userInfo.name }, "用户登录成功");

    const redirectPath = decodeURIComponent(state || "/");
    return { token, redirectPath };
  }

  /**
   * 验证请求中的会话令牌
   *
   * @param token - Cookie 中的会话令牌
   * @returns 有效会话或 null
   *
   * @example
   * ```typescript
   * const session = auth.validate(token);
   * if (!session) return new Response("Unauthorized", { status: 401 });
   * ```
   */
  validate(token: string | undefined): AuthSession | null {
    if (!token) return null;
    const session = this.sessions.get(token);
    if (!session) return null;
    if (Date.now() > session.expiresAt) {
      this.sessions.delete(token);
      return null;
    }
    return session;
  }

  /**
   * 登出，删除会话
   *
   * @param token - 会话令牌
   *
   * @example
   * ```typescript
   * auth.logout(token);
   * ```
   */
  logout(token: string): void {
    this.sessions.delete(token);
  }

  /** 获取应用级别 access_token */
  private async getAppAccessToken(): Promise<string> {
    const resp = await fetch(`${LARK_OPEN_BASE}/open-apis/auth/v3/app_access_token/internal`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        app_id: this.larkConfig.appId,
        app_secret: this.larkConfig.appSecret,
      }),
    });
    const data = (await resp.json()) as { code: number; app_access_token?: string; msg?: string };
    if (data.code !== 0 || !data.app_access_token) {
      throw new Error(`Failed to get app access token: ${data.msg ?? "unknown"}`);
    }
    return data.app_access_token;
  }

  /** 用授权码交换用户 access_token */
  private async exchangeCode(appAccessToken: string, code: string): Promise<string> {
    const resp = await fetch(`${LARK_OPEN_BASE}/open-apis/authen/v1/oidc/access_token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${appAccessToken}`,
      },
      body: JSON.stringify({ grant_type: "authorization_code", code }),
    });
    const data = (await resp.json()) as { code: number; data?: { access_token: string }; msg?: string };
    if (data.code !== 0 || !data.data?.access_token) {
      throw new Error(`Failed to exchange code: ${data.msg ?? "unknown"}`);
    }
    return data.data.access_token;
  }

  /** 通过 user_access_token 获取用户信息 */
  private async getUserInfo(userAccessToken: string): Promise<{ userId: string; name: string; department: string }> {
    const resp = await fetch(`${LARK_OPEN_BASE}/open-apis/authen/v1/user_info`, {
      method: "GET",
      headers: { Authorization: `Bearer ${userAccessToken}` },
    });
    const data = (await resp.json()) as {
      code: number;
      data?: { open_id?: string; name?: string; department_ids?: string[] };
      msg?: string;
    };
    if (data.code !== 0) {
      throw new Error(`Failed to get user info: ${data.msg ?? "unknown"}`);
    }
    return {
      userId: data.data?.open_id ?? "unknown",
      name: data.data?.name ?? "unknown",
      department: data.data?.department_ids?.[0] ?? "unknown",
    };
  }
}

/**
 * 从 Cookie header 提取会话令牌
 *
 * @param cookieHeader - HTTP Cookie header 值
 * @returns token 值或 undefined
 *
 * @example
 * ```typescript
 * const token = extractToken("teamsland_session=abc-123; other=value");
 * // => "abc-123"
 * ```
 */
export function extractToken(cookieHeader: string | null): string | undefined {
  if (!cookieHeader) return undefined;
  const match = cookieHeader.match(/teamsland_session=([^;]+)/);
  return match?.[1];
}
