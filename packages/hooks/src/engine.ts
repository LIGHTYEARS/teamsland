import { watch } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import { createLogger } from "@teamsland/observability";
import type { MeegoEvent } from "@teamsland/types";
import type { HookContext, HookEngineConfig, HookStatus, LoadedHook } from "./types.js";
import { isValidHookModule } from "./validation.js";

const logger = createLogger("hooks:engine");

/**
 * Hook 引擎 — 负责加载、管理和执行 hook 模块
 *
 * 从指定目录加载 `.ts` hook 文件，监听文件变更实现热重载，
 * 并按优先级顺序将事件分发给匹配的 hook 处理。
 *
 * @example
 * ```typescript
 * import { HookEngine } from "@teamsland/hooks";
 * import type { HookEngineConfig } from "@teamsland/hooks";
 *
 * const config: HookEngineConfig = {
 *   hooksDir: "/app/hooks",
 *   defaultTimeoutMs: 30000,
 *   multiMatch: false,
 * };
 *
 * const engine = new HookEngine(config);
 * await engine.start();
 *
 * // 处理事件
 * const consumed = await engine.processEvent(event, ctx);
 *
 * // 获取状态
 * const status = engine.getStatus();
 *
 * // 停止引擎
 * engine.stop();
 * ```
 */
export class HookEngine {
  private hooks: Map<string, LoadedHook> = new Map();
  private readonly config: HookEngineConfig;
  private watcher: ReturnType<typeof watch> | null = null;
  private lastReloadAt = 0;

  constructor(config: HookEngineConfig) {
    this.config = config;
  }

  /**
   * 启动 Hook 引擎：加载目录中所有 hook 文件，并启动文件监听器以实现热重载
   *
   * @example
   * ```typescript
   * import { HookEngine } from "@teamsland/hooks";
   *
   * const engine = new HookEngine({
   *   hooksDir: "/app/hooks",
   *   defaultTimeoutMs: 30000,
   *   multiMatch: false,
   * });
   * await engine.start();
   * // 引擎已就绪，可通过 engine.size 查看已加载 hook 数量
   * ```
   */
  async start(): Promise<void> {
    await this.loadAll();

    this.watcher = watch(this.config.hooksDir, { recursive: true }, (_eventType, filename) => {
      if (!filename?.endsWith(".ts")) return;
      this.handleFileChange(filename).catch((err: unknown) => {
        logger.error({ err, filename }, "Hook 文件变更处理失败");
      });
    });

    this.lastReloadAt = Date.now();
    logger.info({ dir: this.config.hooksDir, count: this.hooks.size }, "Hook 引擎已启动");
  }

  /**
   * 停止 Hook 引擎：关闭文件监听器并清空已加载的 hook
   *
   * @example
   * ```typescript
   * import { HookEngine } from "@teamsland/hooks";
   *
   * const engine = new HookEngine({
   *   hooksDir: "/app/hooks",
   *   defaultTimeoutMs: 30000,
   *   multiMatch: false,
   * });
   * await engine.start();
   * // ... 处理事件 ...
   * engine.stop();
   * // 引擎已停止，engine.size === 0
   * ```
   */
  stop(): void {
    this.watcher?.close();
    this.watcher = null;
    this.hooks.clear();
    logger.info("Hook 引擎已停止");
  }

  /**
   * 处理事件：按优先级将事件分发给匹配的 hook
   *
   * 在单匹配模式（默认）下，第一个匹配的 hook 处理后即返回 `true`。
   * 在多匹配模式下，所有匹配的 hook 都会执行，只要有任意一个匹配即返回 `true`。
   * 如果没有 hook 匹配，返回 `false`。
   *
   * @param event - 待处理的飞书项目事件
   * @param ctx - Hook 运行时上下文，包含日志、指标、飞书客户端等依赖
   * @returns 是否有 hook 消费了该事件
   *
   * @example
   * ```typescript
   * import { HookEngine } from "@teamsland/hooks";
   * import type { HookContext } from "@teamsland/hooks";
   * import type { MeegoEvent } from "@teamsland/types";
   *
   * const engine = new HookEngine({
   *   hooksDir: "/app/hooks",
   *   defaultTimeoutMs: 30000,
   *   multiMatch: false,
   * });
   * await engine.start();
   *
   * const consumed = await engine.processEvent(event, ctx);
   * if (!consumed) {
   *   // 没有 hook 匹配，将事件推入队列
   *   await ctx.queue.enqueue(event);
   * }
   * ```
   */
  async processEvent(event: MeegoEvent, ctx: HookContext): Promise<boolean> {
    const sorted = [...this.hooks.values()].sort((a, b) => (a.module.priority ?? 100) - (b.module.priority ?? 100));

    let anyMatched = false;

    for (const hook of sorted) {
      try {
        const matchStart = performance.now();
        const matched = hook.module.match(event);
        ctx.metrics.recordMatchDuration(hook.id, performance.now() - matchStart);

        if (!matched) continue;

        anyMatched = true;
        logger.info({ hookId: hook.id, eventId: event.eventId }, "Hook 匹配成功");

        const handleStart = performance.now();
        await Promise.race([
          hook.module.handle(event, ctx),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error(`Hook ${hook.id} 执行超时 (${hook.timeoutMs}ms)`)), hook.timeoutMs),
          ),
        ]);
        ctx.metrics.recordHandleDuration(hook.id, performance.now() - handleStart);
        ctx.metrics.recordHookHit(hook.id, event.type);

        // 单匹配模式：第一个匹配成功后立即返回
        if (!this.config.multiMatch) return true;
      } catch (err: unknown) {
        logger.error({ hookId: hook.id, eventId: event.eventId, err }, "Hook 执行失败");
        ctx.metrics.recordHookError(hook.id, event.type);

        // 单匹配模式：事件一旦被匹配即视为已消费，即使执行出错也不传递给下一个 hook
        if (!this.config.multiMatch) return true;
      }
    }

    return anyMatched;
  }

  /**
   * 获取引擎状态信息，供 Dashboard API 使用
   *
   * 返回可序列化的状态对象，包含 hook 目录路径、已加载 hook 列表及上次重载时间。
   *
   * @returns 引擎状态摘要
   *
   * @example
   * ```typescript
   * import { HookEngine } from "@teamsland/hooks";
   *
   * const engine = new HookEngine({
   *   hooksDir: "/app/hooks",
   *   defaultTimeoutMs: 30000,
   *   multiMatch: false,
   * });
   * await engine.start();
   *
   * const status = engine.getStatus();
   * // status.totalLoaded — 已加载 hook 总数
   * // status.loadedHooks — 各 hook 状态详情
   * // status.lastReloadAt — 上次重载时间戳
   * ```
   */
  getStatus(): {
    hooksDir: string;
    loadedHooks: HookStatus[];
    totalLoaded: number;
    lastReloadAt: number;
  } {
    const loadedHooks: HookStatus[] = [...this.hooks.values()].map((h) => ({
      id: h.id,
      filePath: h.filePath,
      loadedAt: h.loadedAt,
      description: h.module.description,
      priority: h.module.priority ?? 100,
    }));
    return {
      hooksDir: this.config.hooksDir,
      loadedHooks,
      totalLoaded: this.hooks.size,
      lastReloadAt: this.lastReloadAt,
    };
  }

  /**
   * 已加载 hook 的数量
   *
   * @example
   * ```typescript
   * import { HookEngine } from "@teamsland/hooks";
   *
   * const engine = new HookEngine({
   *   hooksDir: "/app/hooks",
   *   defaultTimeoutMs: 30000,
   *   multiMatch: false,
   * });
   * await engine.start();
   * const count = engine.size; // e.g. 5
   * ```
   */
  get size(): number {
    return this.hooks.size;
  }

  // ─── 私有方法 ───

  private async loadAll(): Promise<void> {
    try {
      const files = await this.findTsFiles(this.config.hooksDir);
      await Promise.allSettled(files.map((f) => this.loadHook(f)));
    } catch (err: unknown) {
      logger.warn({ err, dir: this.config.hooksDir }, "hooks 目录加载失败（目录可能不存在）");
    }
  }

  private async loadHook(filePath: string): Promise<void> {
    const hookId = relative(this.config.hooksDir, filePath).replace(/\.ts$/, "");
    try {
      // 使用时间戳查询参数绕过模块缓存，实现热重载
      const moduleUrl = `${filePath}?t=${Date.now()}`;
      const mod: unknown = await import(moduleUrl);

      if (!isValidHookModule(mod)) {
        logger.warn({ hookId, filePath }, "无效 hook 模块：缺少 match/handle 导出");
        return;
      }

      this.hooks.set(hookId, {
        id: hookId,
        filePath,
        module: mod,
        timeoutMs: this.config.defaultTimeoutMs,
        loadedAt: Date.now(),
      });
      this.lastReloadAt = Date.now();
      logger.info({ hookId }, "Hook 已加载");
    } catch (err: unknown) {
      logger.error({ err, hookId, filePath }, "Hook 加载失败");
    }
  }

  private unloadHook(hookId: string): void {
    if (this.hooks.delete(hookId)) {
      this.lastReloadAt = Date.now();
      logger.info({ hookId }, "Hook 已卸载");
    }
  }

  private async handleFileChange(filename: string): Promise<void> {
    const filePath = join(this.config.hooksDir, filename);
    const hookId = filename.replace(/\.ts$/, "");

    try {
      await stat(filePath);
      // 文件存在 — 加载或重新加载
      await this.loadHook(filePath);
    } catch {
      // 文件已删除 — 卸载
      this.unloadHook(hookId);
    }
  }

  private async findTsFiles(dir: string): Promise<string[]> {
    const results: string[] = [];
    const entries = await readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        results.push(...(await this.findTsFiles(fullPath)));
      } else if (entry.name.endsWith(".ts")) {
        results.push(fullPath);
      }
    }

    return results;
  }
}
