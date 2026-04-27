import z from "zod";

const MeegoSpaceSchema = z.object({
  spaceId: z.string(),
  name: z.string(),
});

const MeegoWebhookSchema = z.object({
  host: z.string(),
  port: z.number().int().positive(),
  path: z.string(),
  secret: z.string().optional(),
});

const MeegoPollSchema = z.object({
  intervalSeconds: z.number().positive(),
  lookbackMinutes: z.number().positive(),
});

const MeegoLongConnectionSchema = z.object({
  enabled: z.boolean(),
  reconnectIntervalSeconds: z.number().positive(),
});

const MeegoConfigSchema = z.object({
  spaces: z.array(MeegoSpaceSchema),
  eventMode: z.enum(["webhook", "poll", "both"]),
  webhook: MeegoWebhookSchema,
  poll: MeegoPollSchema,
  longConnection: MeegoLongConnectionSchema,
  apiBaseUrl: z.string().url().default("https://project.feishu.cn/open_api"),
  pluginId: z.string().default(""),
  pluginSecret: z.string().default(""),
  pluginAccessToken: z.string().default(""),
  userKey: z.string().default(""),
});

const LarkBotSchema = z.object({
  historyContextCount: z.number().int().nonnegative(),
});

const LarkNotificationSchema = z.object({
  teamChannelId: z.string(),
});

const LarkConnectorSchema = z.object({
  enabled: z.boolean().default(false),
  eventTypes: z.array(z.string()).default(["im.message.receive_v1"]),
  chatProjectMapping: z.record(z.string(), z.string()).default({}),
});

const LarkConfigSchema = z.object({
  appId: z.string().min(1),
  appSecret: z.string().min(1),
  bot: LarkBotSchema,
  notification: LarkNotificationSchema,
  connector: LarkConnectorSchema.optional(),
});

const SessionConfigSchema = z.object({
  compactionTokenThreshold: z.number().int().positive(),
  sqliteJitterRangeMs: z.tuple([z.number().nonnegative(), z.number().nonnegative()]),
  busyTimeoutMs: z.number().int().positive(),
});

const SidecarConfigSchema = z.object({
  maxConcurrentSessions: z.number().int().positive(),
  maxRetryCount: z.number().int().nonnegative(),
  maxDelegateDepth: z.number().int().nonnegative(),
  workerTimeoutSeconds: z.number().positive(),
  healthCheckTimeoutMs: z.number().int().positive(),
  minSwarmSuccessRatio: z.number().min(0).max(1),
  teamslandApiBase: z.string().default("http://localhost:3001"),
});

const ConfirmationConfigSchema = z.object({
  reminderIntervalMin: z.number().positive(),
  maxReminders: z.number().int().positive(),
  pollIntervalMs: z.number().int().positive(),
});

const DashboardAuthSchema = z.object({
  provider: z.string().min(1),
  sessionTtlHours: z.number().positive(),
  allowedDepartments: z.array(z.string()),
});

const DashboardConfigSchema = z.object({
  port: z.number().int().positive(),
  auth: DashboardAuthSchema,
});

const RepoEntrySchema = z.object({
  path: z.string().min(1),
  name: z.string(),
  remoteUrl: z.string().optional(),
});

const RepoMappingEntrySchema = z.object({
  meegoProjectId: z.string().min(1),
  repos: z.array(RepoEntrySchema),
});

/**
 * AppConfig 的 Zod 校验 Schema
 *
 * 在 `loadConfig()` 中使用，将 JSON 解析后的 `unknown` 对象校验为类型安全的 `AppConfig`。
 * 校验失败时抛出 `ZodError`，包含所有缺失/非法字段的详细路径信息。
 *
 * @example
 * ```typescript
 * import { AppConfigSchema } from "./schema.js";
 *
 * const raw: unknown = JSON.parse(jsonString);
 * const config = AppConfigSchema.parse(raw); // throws ZodError on invalid
 * ```
 */
/**
 * Hook 引擎配置 Zod Schema
 *
 * 校验 hooks 相关配置字段：目录路径、超时时间和多匹配模式。
 *
 * @example
 * ```typescript
 * import { hooksConfigSchema } from "./schema.js";
 *
 * const raw: unknown = { hooksDir: "./hooks", defaultTimeoutMs: 30000, multiMatch: false };
 * const config = hooksConfigSchema.parse(raw);
 * ```
 */
const hooksConfigSchema = z.object({
  hooksDir: z.string().min(1),
  defaultTimeoutMs: z.number().int().positive().default(30000),
  multiMatch: z.boolean().default(false),
});

export const AppConfigSchema = z.object({
  meego: MeegoConfigSchema,
  lark: LarkConfigSchema,
  session: SessionConfigSchema,
  sidecar: SidecarConfigSchema,
  confirmation: ConfirmationConfigSchema,
  dashboard: DashboardConfigSchema,
  repoMapping: z.array(RepoMappingEntrySchema),
  skillRouting: z.record(z.string(), z.array(z.string())).default({}),
  llm: z
    .object({
      provider: z.literal("anthropic"),
      apiKey: z.string().min(1),
      model: z.string().min(1),
      baseUrl: z.string().url().optional(),
      maxTokens: z.number().int().positive().default(4096),
    })
    .optional(),
  queue: z
    .object({
      dbPath: z.string().min(1).default("data/queue.sqlite"),
      busyTimeoutMs: z.number().int().positive().default(5000),
      visibilityTimeoutMs: z.number().int().positive().default(60_000),
      maxRetries: z.number().int().nonnegative().default(3),
      deadLetterEnabled: z.boolean().default(true),
      pollIntervalMs: z.number().int().positive().default(100),
    })
    .optional(),
  hooks: hooksConfigSchema.optional(),
  coordinator: z
    .object({
      workspacePath: z.string().default("~/.teamsland/coordinator"),
      reposDir: z.string().default("~/teamsland-repos"),
      sessionIdleTimeoutMs: z.number().default(300_000),
      sessionMaxLifetimeMs: z.number().default(1_800_000),
      sessionReuseWindowMs: z.number().default(300_000),
      maxRecoveryRetries: z.number().default(3),
      inferenceTimeoutMs: z.number().default(60_000),
      enabled: z.boolean().default(false),
      maxEventsPerSession: z.number().int().positive().default(20),
      resultTimeoutMs: z.number().int().positive().default(300_000),
    })
    .optional(),
  openViking: z
    .object({
      baseUrl: z.string().url(),
      agentId: z.string().min(1),
      apiKey: z.string().optional(),
      timeoutMs: z.number().int().positive(),
      heartbeatIntervalMs: z.number().int().positive(),
      heartbeatFailThreshold: z.number().int().positive(),
    })
    .optional(),
});
