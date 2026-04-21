// @teamsland/server — main process entry point
// 启动编排、事件管线、定时任务、优雅关闭

import { Database } from "bun:sqlite";
import { loadConfig, RepoMapping } from "@teamsland/config";
import { DynamicContextAssembler } from "@teamsland/context";
import { BunCommandRunner as GitBunCommandRunner, WorktreeManager } from "@teamsland/git";
import type { LlmClient } from "@teamsland/ingestion";
import { IntentClassifier } from "@teamsland/ingestion";
import { BunCommandRunner as LarkBunCommandRunner, LarkCli, LarkNotifier } from "@teamsland/lark";
import { MeegoConnector, MeegoEventBus } from "@teamsland/meego";
import { LocalEmbedder, MemoryReaper, TeamMemoryStore } from "@teamsland/memory";
import { createLogger } from "@teamsland/observability";
import { SessionDB } from "@teamsland/session";
import { ProcessController, SubagentRegistry } from "@teamsland/sidecar";
import { startDashboard } from "./dashboard.js";
import { registerEventHandlers } from "./event-handlers.js";
import { startFts5Optimize, startMemoryReaper, startSeenEventsSweep, startWorktreeReaper } from "./scheduled-tasks.js";

/** 默认团队 ID */
const TEAM_ID = "default";

(async () => {
  try {
    // ── 1. 配置 ──
    const config = await loadConfig();

    // ── 2. Logger ──
    const logger = createLogger("server:main");

    // ── 3. AbortController（优雅关闭信号源） ──
    const controller = new AbortController();

    // ── 4. SessionDB ──
    const sessionDb = new SessionDB("data/sessions.sqlite", config.session);
    logger.info("SessionDB 已初始化");

    // ── 5. 事件去重库（内存 SQLite） ──
    const eventDb = new Database(":memory:");
    logger.info("事件去重数据库已创建");

    // ── 6. 本地 Embedding ──
    const embedder = new LocalEmbedder(config.storage.embedding);
    await embedder.init();
    logger.info("LocalEmbedder 初始化完成");

    // ── 7. 团队记忆存储 ──
    const memoryStore = new TeamMemoryStore(TEAM_ID, config.storage, embedder);
    logger.info("TeamMemoryStore 已初始化");

    // ── 8. 记忆回收器 ──
    const memoryReaper = new MemoryReaper(memoryStore, config.memory);

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
    await registry.restoreOnStartup();
    logger.info("SubagentRegistry 启动恢复完成");

    // ── 14. RepoMapping ──
    const repoMapping = RepoMapping.fromConfig(config.repoMapping);

    // ── 15. DynamicContextAssembler ──
    const assembler = new DynamicContextAssembler({
      config,
      repoMapping,
      memoryStore,
      embedder,
    });

    // ── 16. IntentClassifier（Stub LLM） ──
    const stubLlmClient: LlmClient = {
      async chat(): Promise<{ content: string }> {
        throw new Error("LLM 未配置 — 需要在配置中添加 API 密钥和模型端点");
      },
    };
    logger.warn("LLM 未配置，IntentClassifier 将仅使用规则快速路径");
    const intentClassifier = new IntentClassifier({ llm: stubLlmClient });

    // ── 17. WorktreeManager ──
    const worktreeManager = new WorktreeManager(new GitBunCommandRunner());

    // ── 18. MeegoEventBus ──
    const eventBus = new MeegoEventBus(eventDb);

    // ── 19. 注册事件处理器 ──
    registerEventHandlers(eventBus, {
      intentClassifier,
      processController,
      assembler,
      registry,
      worktreeManager,
      notifier,
      config,
      teamId: TEAM_ID,
    });

    // ── 20. MeegoConnector ──
    const connector = new MeegoConnector({ config: config.meego, eventBus });
    await connector.start(controller.signal);
    logger.info("MeegoConnector 已启动");

    // ── 21. Dashboard ──
    startDashboard({ registry, config: config.dashboard }, controller.signal);

    // ── 22. 定时任务 ──
    const worktreeReaperTimer = startWorktreeReaper(worktreeManager, registry, 3_600_000);
    const memoryReaperTimer = startMemoryReaper(memoryReaper, 86_400_000);
    const seenEventsSweepTimer = startSeenEventsSweep(eventBus, 3_600_000);
    const fts5OptimizeTimer = startFts5Optimize(memoryStore, config.storage.fts5.optimizeIntervalHours * 3_600_000);

    // ── 23. 系统启动完成 ──
    logger.info("系统启动完成");

    // ── 优雅关闭 ──
    const shutdown = async () => {
      logger.info("收到关闭信号，开始优雅关闭");
      controller.abort();
      clearInterval(worktreeReaperTimer);
      clearInterval(memoryReaperTimer);
      clearInterval(seenEventsSweepTimer);
      clearInterval(fts5OptimizeTimer);
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
