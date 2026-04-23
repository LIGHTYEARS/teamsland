// @teamsland/server — main process entry point
// 启动编排、优雅关闭

import { createLogger, shutdownTracing } from "@teamsland/observability";
import { toCoordinatorEvent } from "./coordinator-event-mapper.js";
import { initConfigAndLogging } from "./init/config-and-logging.js";
import { initContext } from "./init/context.js";
import { initCoordinator } from "./init/coordinator.js";
import { initDashboard } from "./init/dashboard.js";
import { initEvents } from "./init/events.js";
import { initHooks } from "./init/hooks.js";
import { initLark } from "./init/lark.js";
import { initScheduledTasks } from "./init/scheduled-tasks.js";
import { initSidecar } from "./init/sidecar.js";
import { initStorage } from "./init/storage.js";

(async () => {
  try {
    // ── Phase 0: 配置 + 日志 + Tracing ──
    const { config, logger, controller } = await initConfigAndLogging();

    // ── Phase 1: 存储层 ──
    const storage = await initStorage(config, logger);

    // ── Phase 2: 飞书组件 ──
    const lark = initLark(config, logger);

    // ── Phase 3: Sidecar 进程管理 ──
    const sidecar = await initSidecar(config, lark.notifier, storage.sessionDb, logger);

    // ── Phase 4: 业务上下文 ──
    const context = initContext(config, storage, sidecar, lark, logger);

    // ── Phase 4.5: Hook 引擎 ──
    const hooks = await initHooks(config, lark, sidecar, context, logger);

    // ── Phase 5: 事件管线 ──
    const coordinatorEnabled = config.coordinator?.enabled === true;
    const { eventBus, queue } = await initEvents(
      config,
      context,
      sidecar,
      storage,
      lark,
      controller,
      logger,
      coordinatorEnabled,
      hooks.engine,
      hooks.hookContext,
      hooks.metricsCollector,
    );

    // 将 PersistentQueue 绑定到 Hook 上下文的延迟引用
    hooks.queueRef.current = queue;

    // ── Phase 5.5: Coordinator ──
    const coordinator = await initCoordinator(config, queue, sidecar.registry, controller, logger);
    if (coordinator.manager) {
      queue.consume(async (msg) => {
        const event = toCoordinatorEvent(msg);
        await coordinator.manager?.processEvent(event);
      });
      logger.info("Coordinator 队列消费者已注册");
    }

    // ── Phase 6: Dashboard ──
    const dashboard = initDashboard(
      config,
      sidecar.registry,
      storage.sessionDb,
      lark,
      controller,
      logger,
      sidecar,
      context,
      hooks.engine,
      hooks.metricsCollector,
    );

    // ── Phase 7: 定时任务 ──
    const timers = initScheduledTasks(config, storage, sidecar, context, lark, eventBus, logger);

    // ── 系统启动完成 ──
    logger.info("系统启动完成");

    // ── 优雅关闭 ──
    const shutdown = async () => {
      logger.info("收到关闭信号，开始优雅关闭");
      controller.abort();
      timers.clearAll();
      if (sidecar.orphanTimer) clearInterval(sidecar.orphanTimer);
      if (coordinator.manager) coordinator.manager.reset();
      if (hooks.engine) hooks.engine.stop();
      dashboard.server.stop();
      await shutdownTracing();
      await sidecar.registry.persist();
      queue.close();
      storage.sessionDb.close();
      storage.memoryStore.close();
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
