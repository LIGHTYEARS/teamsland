// @teamsland/server — main process entry point
// 启动编排、优雅关闭

import { Database } from "bun:sqlite";
import { homedir } from "node:os";
import { join } from "node:path";
import { createLogger, shutdownTracing } from "@teamsland/observability";
import { TicketStore } from "@teamsland/ticket";
import { toCoordinatorEvent } from "./coordinator-event-mapper.js";
import { verifyWorkspaceIntegrity } from "./coordinator-init.js";
import { initConfigAndLogging } from "./init/config-and-logging.js";
import { initContext } from "./init/context.js";
import { initCoordinator } from "./init/coordinator.js";
import { initDashboard } from "./init/dashboard.js";
import { initEvents } from "./init/events.js";
import { initHooks } from "./init/hooks.js";
import { initLark } from "./init/lark.js";
import { initScheduledTasks } from "./init/scheduled-tasks.js";
import { initSidecar } from "./init/sidecar.js";
import { initStorage, TEAM_ID } from "./init/storage.js";
import { getVikingClient, initViking } from "./init/viking.js";
import { PipelineTracker } from "./pipeline-tracker.js";

(async () => {
  try {
    // ── Phase 0: 配置 + 日志 + Tracing ──
    const { config, logger, controller } = await initConfigAndLogging();

    // ── Crash Guards ──
    process.on("uncaughtException", (err) => {
      logger.fatal({ err }, "未捕获异常，进程即将退出");
      process.exit(1);
    });

    process.on("unhandledRejection", (reason) => {
      logger.fatal({ reason }, "未处理 Promise 拒绝，进程即将退出");
      process.exit(1);
    });

    // ── Config Validation ──
    const { validateConfig } = await import("@teamsland/config");
    const validation = validateConfig(config);
    for (const w of validation.warnings) logger.warn(w);
    if (validation.fatal.length > 0) {
      for (const f of validation.fatal) logger.fatal(f);
      logger.fatal({ fatalCount: validation.fatal.length }, "配置校验失败，进程退出");
      process.exit(1);
    }

    const startTime = performance.now();
    const phaseTimings: Record<string, number> = {};
    function timePhase(name: string, t0: number): void {
      const ms = Math.round(performance.now() - t0);
      phaseTimings[name] = ms;
      logger.info({ phase: name, durationMs: ms }, `${name} 完成`);
    }

    // ── Phase 1: 存储层 ──
    let t0 = performance.now();
    const storage = await initStorage(config, logger);

    // ── Phase 1.1: Ticket Store ──
    const ticketDb = new Database("data/tickets.sqlite", { create: true });
    ticketDb.exec("PRAGMA journal_mode=WAL");
    const ticketStore = new TicketStore(ticketDb);
    logger.info("TicketStore 已初始化");
    timePhase("storage", t0);

    // ── Phase 1.5: OpenViking 连接 ──
    t0 = performance.now();
    const viking = await initViking(config, logger);
    timePhase("viking", t0);

    // ── Phase 2: 飞书组件 ──
    t0 = performance.now();
    const lark = initLark(config, logger);
    timePhase("lark", t0);

    // ── Phase 3: Sidecar 进程管理 ──
    t0 = performance.now();
    const sidecar = await initSidecar(config, lark.notifier, storage.sessionDb, logger);
    timePhase("sidecar", t0);

    // ── Phase 4: 业务上下文 ──
    t0 = performance.now();
    const context = initContext(config, storage, sidecar, lark, logger);
    timePhase("context", t0);

    // ── Phase 4.5: Hook 引擎 ──
    t0 = performance.now();
    const hooks = await initHooks(config, lark, sidecar, context, logger, storage.sessionDb, TEAM_ID);
    timePhase("hooks", t0);

    // ── Phase 5: 事件管线 ──
    t0 = performance.now();
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
      getVikingClient(viking),
    );

    // 将 PersistentQueue 绑定到 Hook 上下文的延迟引用
    hooks.queueRef.current = queue;
    timePhase("events", t0);

    // ── Phase 5.5: Coordinator ──
    t0 = performance.now();
    const vikingClient = getVikingClient(viking);
    const coordinator = await initCoordinator(
      config,
      queue,
      sidecar.registry,
      controller,
      logger,
      vikingClient,
      lark.notifier,
      storage.sessionDb,
    );
    let onQueueProcessed: (() => void) | undefined;

    if (coordinator.coordinator) {
      // Dead letter 告警
      queue.onDeadLetter(({ id, type, lastError }) => {
        logger.error({ msgId: id, type, lastError }, "消息进入死信队列");
        lark.notifier
          .sendCard("消息进入死信队列", `消息 ID: ${id}\n类型: ${type}\n错误: ${lastError}`, "error")
          .catch((err) => logger.warn({ err, msgId: id }, "死信告警发送失败"));
      });

      queue.consume(async (msg) => {
        const tracker = new PipelineTracker(msg.id, msg.type, msg.createdAt);

        tracker.phase("eventMapping");
        const event = toCoordinatorEvent(msg);
        tracker.endPhase();

        logger.info({ msgId: msg.id, eventId: event.id, eventType: event.type }, "开始处理队列消息");
        try {
          await coordinator.coordinator?.processEvent(event, tracker);
          tracker.setOutcome("success");
          logger.info({ msgId: msg.id, eventId: event.id }, "队列消息处理完成");
        } catch (err) {
          tracker.setOutcome("failed");
          const errMsg = err instanceof Error ? err.message : String(err);
          logger.error(
            { msgId: msg.id, eventId: event.id, eventType: event.type, error: errMsg },
            "Coordinator 事件处理失败",
          );
          lark.notifier
            .sendCard("Coordinator 处理失败", `事件类型: ${event.type}\n事件 ID: ${event.id}\n错误: ${errMsg}`, "error")
            .catch((sendErr) => logger.warn({ sendErr }, "Coordinator 失败告警发送失败"));
          throw err;
        } finally {
          const summary = tracker.summarize();
          logger.info(summary, "消息处理链路完成");
          onQueueProcessed?.();
        }
      });
      logger.info("Coordinator 队列消费者已注册");
    }

    // ── Phase 5.6: Workspace 完整性校验 ──
    if (config.coordinator?.enabled) {
      const workspacePath = config.coordinator.workspacePath?.startsWith("~")
        ? join(homedir(), config.coordinator.workspacePath.slice(1))
        : (config.coordinator.workspacePath ?? join(homedir(), ".teamsland/coordinator"));
      const integrity = await verifyWorkspaceIntegrity(workspacePath);
      if (!integrity.ok) {
        logger.warn(
          { missing: integrity.missing },
          "Coordinator workspace 完整性检查失败，缺失文件将在下次 init 时重建",
        );
      }
    }
    timePhase("coordinator", t0);

    // ── Phase 6: Dashboard ──
    t0 = performance.now();
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
      vikingClient,
      {
        ticketStore,
        queue,
        larkSendDm: (userId, text) => lark.larkCli.sendDm(userId, text),
        coordinatorManager: coordinator.coordinator,
      },
    );
    timePhase("dashboard", t0);
    onQueueProcessed = dashboard.broadcastQueueUpdate;

    // ── Phase 7: 定时任务 ──
    t0 = performance.now();
    const timers = initScheduledTasks(config, storage, sidecar, context, lark, eventBus, logger);
    timePhase("scheduledTasks", t0);

    // ── 系统启动完成 ──
    logger.info(
      {
        phases: phaseTimings,
        coordinatorEnabled: !!coordinator.coordinator,
        workerManagerEnabled: !!coordinator.workerManager,
        hooksEnabled: !!hooks.engine,
        totalDurationMs: Math.round(performance.now() - startTime),
      },
      "系统启动完成",
    );

    // ── 优雅关闭 ──
    const shutdown = async () => {
      logger.info("收到关闭信号，开始优雅关闭");
      controller.abort();
      timers.clearAll();
      if (sidecar.orphanTimer) clearInterval(sidecar.orphanTimer);
      if (coordinator.coordinator) await coordinator.coordinator.reset();
      if (coordinator.workerManager) await coordinator.workerManager.terminateAll();
      if (hooks.engine) hooks.engine.stop();
      if (viking.healthMonitor) viking.healthMonitor.stop();
      dashboard.server.stop();
      await shutdownTracing();
      await sidecar.registry.persist();
      queue.close();
      ticketDb.close();
      storage.sessionDb.close();
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
