// @teamsland/server — main process entry point
// 启动编排、事件管线、定时任务、优雅关闭

import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { loadConfig, RepoMapping } from "@teamsland/config";
import { DynamicContextAssembler } from "@teamsland/context";
import { BunCommandRunner as GitBunCommandRunner, WorktreeManager } from "@teamsland/git";
import { DocumentParser, IntentClassifier } from "@teamsland/ingestion";
import { BunCommandRunner as LarkBunCommandRunner, LarkCli, LarkConnector, LarkNotifier } from "@teamsland/lark";
import { ConfirmationWatcher, MeegoConnector, MeegoEventBus } from "@teamsland/meego";
import type { Embedder } from "@teamsland/memory";
import {
  checkVec0Available,
  ExtractLoop,
  LocalEmbedder,
  MemoryReaper,
  MemoryUpdater,
  NullEmbedder,
  NullMemoryStore,
  TeamMemoryStore,
} from "@teamsland/memory";
import { createLogger, initTracing, shutdownTracing } from "@teamsland/observability";
import { SessionDB } from "@teamsland/session";
import { ObservableMessageBus, ProcessController, SidecarDataPlane, SubagentRegistry } from "@teamsland/sidecar";
import { TaskPlanner } from "@teamsland/swarm";
import type { LlmConfig } from "@teamsland/types";
import { startDashboard } from "./dashboard.js";
import { registerEventHandlers } from "./event-handlers.js";
import { LarkAuthManager } from "./lark-auth.js";
import { AnthropicLlmClient } from "./llm-client.js";
import {
  createAlerter,
  startFts5Optimize,
  startHealthCheck,
  startMemoryReaper,
  startSeenEventsSweep,
  startWorktreeReaper,
} from "./scheduled-tasks.js";

/** 默认团队 ID */
const TEAM_ID = "default";

/** 根据配置构建 LLM 客户端和 TaskPlanner */
function buildLlmStack(llmConfig: LlmConfig | undefined, logger: ReturnType<typeof createLogger>) {
  if (llmConfig) {
    const client = new AnthropicLlmClient(llmConfig);
    logger.info({ model: llmConfig.model }, "AnthropicLlmClient 已初始化");
    const planner = new TaskPlanner({ llm: client });
    logger.info("TaskPlanner 已初始化 — Swarm 模式可用");
    return { llmClient: client, taskPlanner: planner };
  }
  logger.warn("LLM 未配置，IntentClassifier 将仅使用规则快速路径");
  const stub = {
    async chat(): Promise<{ content: string }> {
      throw new Error("LLM 未配置 — 需要在配置中添加 API 密钥和模型端点");
    },
  };
  return { llmClient: stub, taskPlanner: null };
}

(async () => {
  try {
    // ── 0. 确保数据目录存在 ──
    const root = resolve(import.meta.dir, "../../..");
    process.chdir(root);
    mkdirSync("data", { recursive: true });

    // ── 1. 配置 ──
    const config = await loadConfig();

    // ── 2. Logger + Tracing ──
    initTracing("teamsland-server", "0.1.0");
    const logger = createLogger("server:main");

    // ── 3. AbortController（优雅关闭信号源） ──
    const controller = new AbortController();

    // ── 4. SessionDB ──
    const sessionDb = new SessionDB("data/sessions.sqlite", config.session);
    logger.info("SessionDB 已初始化");

    // ── 5. 事件去重库（内存 SQLite） ──
    const eventDb = new Database(":memory:");
    logger.info("事件去重数据库已创建");

    // ── 6. Embedding（优雅降级） ──
    let embedder: Embedder;
    try {
      const realEmbedder = new LocalEmbedder(config.storage.embedding);
      const initTimeout = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error("LocalEmbedder 初始化超时（5分钟）— 模型可能尚未下载")), 300_000);
      });
      await Promise.race([realEmbedder.init(), initTimeout]);
      embedder = realEmbedder;
      logger.info("LocalEmbedder 初始化完成");
    } catch (embErr: unknown) {
      logger.warn({ err: embErr }, "LocalEmbedder 初始化失败，使用 NullEmbedder");
      embedder = new NullEmbedder(config.storage.embedding.contextSize);
      await embedder.init();
    }

    // ── 7. 团队记忆存储（优雅降级） ──
    let memoryStore: TeamMemoryStore | NullMemoryStore;
    const vec0Check = checkVec0Available();
    if (!vec0Check.ok) {
      logger.warn(
        { error: vec0Check.error },
        "sqlite-vec (vec0) 扩展不可用 — 向量记忆功能将降级为 NullMemoryStore。安装方法: bun add sqlite-vec",
      );
      memoryStore = new NullMemoryStore();
    } else {
      try {
        memoryStore = new TeamMemoryStore(TEAM_ID, config.storage, embedder);
        logger.info("TeamMemoryStore 已初始化（sqlite-vec 可用）");
      } catch (memErr: unknown) {
        logger.warn({ err: memErr }, "TeamMemoryStore 初始化失败，使用 NullMemoryStore");
        memoryStore = new NullMemoryStore();
      }
    }

    // ── 8. 记忆回收器（仅在 TeamMemoryStore 可用时） ──
    const memoryReaper = memoryStore instanceof TeamMemoryStore ? new MemoryReaper(memoryStore, config.memory) : null;

    // ── 9. Lark 命令运行器 ──
    const larkCmdRunner = new LarkBunCommandRunner();

    // ── 10. LarkCli ──
    const larkCli = new LarkCli(config.lark, larkCmdRunner);

    // ── 11. LarkNotifier ──
    const notifier = new LarkNotifier(larkCli, config.lark.notification);

    // ── 12. ProcessController ──
    const processController = new ProcessController({ logger });

    // ── 13. SubagentRegistry ──
    const registry = new SubagentRegistry({
      config: config.sidecar,
      notifier,
      logger,
    });
    const orphanTimer = await registry.restoreOnStartup();
    logger.info("SubagentRegistry 启动恢复完成");

    // ── 14. ObservableMessageBus ──
    const messageBus = new ObservableMessageBus({ logger: createLogger("sidecar:bus") });
    logger.info("ObservableMessageBus 已初始化");

    // ── 14.5. SidecarDataPlane ──
    const dataPlane = new SidecarDataPlane({ registry, sessionDb, logger, messageBus });
    logger.info("SidecarDataPlane 已初始化");

    // ── 15. RepoMapping ──
    const repoMapping = RepoMapping.fromConfig(config.repoMapping);

    // ── 16. DynamicContextAssembler ──
    const assembler = new DynamicContextAssembler({
      config,
      repoMapping,
      memoryStore,
      embedder,
      templateBasePath: config.templateBasePath,
    });

    // ── 17. LLM 客户端 + TaskPlanner（条件初始化） ──
    const { llmClient, taskPlanner } = buildLlmStack(config.llm, logger);
    const intentClassifier = new IntentClassifier({ llm: llmClient });

    // ── 17.5. DocumentParser + Memory Ingestion ──
    const documentParser = new DocumentParser();
    const memoryUpdater = memoryStore instanceof TeamMemoryStore ? new MemoryUpdater(memoryStore) : null;
    const extractLoop =
      memoryStore instanceof TeamMemoryStore
        ? new ExtractLoop({
            llm: llmClient as never,
            store: memoryStore,
            teamId: TEAM_ID,
            maxIterations: config.memory.extractLoopMaxIterations,
          })
        : null;

    // ── 18. WorktreeManager ──
    const worktreeManager = new WorktreeManager(new GitBunCommandRunner());

    // ── 18.5. ConfirmationWatcher ──
    const confirmationWatcher = new ConfirmationWatcher({
      notifier,
      config: config.confirmation,
      meego: { apiBaseUrl: config.meego.apiBaseUrl, pluginAccessToken: config.meego.pluginAccessToken },
    });

    // ── 19. MeegoEventBus ──
    const eventBus = new MeegoEventBus(eventDb);

    // ── 20. 注册事件处理器 ──
    registerEventHandlers(eventBus, {
      intentClassifier,
      processController,
      dataPlane,
      assembler,
      registry,
      worktreeManager,
      notifier,
      larkCli,
      config,
      teamId: TEAM_ID,
      documentParser,
      memoryStore: memoryStore instanceof TeamMemoryStore ? memoryStore : null,
      extractLoop,
      memoryUpdater,
      taskPlanner,
      confirmationWatcher,
    });

    // ── 21. MeegoConnector ──
    const connector = new MeegoConnector({ config: config.meego, eventBus });
    await connector.start(controller.signal);
    logger.info("MeegoConnector 已启动");

    // ── 21b. LarkConnector（飞书群聊 @机器人 → 事件管线） ──
    if (config.lark.connector?.enabled) {
      const larkConnector = new LarkConnector({
        config: config.lark.connector,
        larkCli,
        eventBus,
        historyContextCount: config.lark.bot.historyContextCount,
      });
      await larkConnector.start(controller.signal);
      logger.info("LarkConnector 已启动");
    }

    // ── 22. Dashboard ──
    const authManager =
      config.dashboard.auth.provider === "lark_oauth"
        ? new LarkAuthManager(config.lark, config.dashboard.auth, `http://localhost:${config.dashboard.port}`)
        : undefined;
    const dashboardServer = startDashboard(
      { registry, sessionDb, config: config.dashboard, authManager },
      controller.signal,
    );

    // ── 23. 定时任务 ──
    const alerter = createAlerter(notifier, config.lark.notification.teamChannelId);
    const healthCheckTimer = startHealthCheck(
      alerter,
      registry,
      Math.floor(config.sidecar.maxConcurrentSessions * 0.9),
      60_000,
    );
    const worktreeReaperTimer = startWorktreeReaper(worktreeManager, registry, 3_600_000);
    const memoryReaperTimer = memoryReaper ? startMemoryReaper(memoryReaper, 86_400_000) : null;
    const seenEventsSweepTimer = startSeenEventsSweep(eventBus, 3_600_000);
    const fts5OptimizeTimer =
      memoryStore instanceof TeamMemoryStore
        ? startFts5Optimize(memoryStore, config.storage.fts5.optimizeIntervalHours * 3_600_000)
        : null;

    // ── 24. 系统启动完成 ──
    logger.info("系统启动完成");

    // ── 优雅关闭 ──
    const shutdown = async () => {
      logger.info("收到关闭信号，开始优雅关闭");
      controller.abort();
      clearInterval(healthCheckTimer);
      clearInterval(worktreeReaperTimer);
      if (memoryReaperTimer) clearInterval(memoryReaperTimer);
      clearInterval(seenEventsSweepTimer);
      if (fts5OptimizeTimer) clearInterval(fts5OptimizeTimer);
      if (orphanTimer) clearInterval(orphanTimer);
      dashboardServer.stop();
      await shutdownTracing();
      await registry.persist();
      sessionDb.close();
      memoryStore.close();
      logger.info("优雅关闭完成");
      process.exit(0);
    };

    process.on("SIGTERM", shutdown);
    process.on("SIGINT", shutdown);
  } catch (err: unknown) {
    const logger = createLogger("server:main");
    logger.fatal({ err }, "启动失败");
    process.exit(1);
  }
})();
