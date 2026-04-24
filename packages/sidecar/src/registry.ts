import { rename } from "node:fs/promises";
import type { LarkNotifier } from "@teamsland/lark";
import type { Logger } from "@teamsland/observability";
import type { AgentRecord, RegistryState, SidecarConfig } from "@teamsland/types";

/**
 * 容量超限错误
 *
 * 当并发 Agent 数量达到 `SidecarConfig.maxConcurrentSessions` 时抛出。
 * 调用方应捕获此错误并通过 LarkNotifier 发送 DM 通知任务发起人。
 *
 * @example
 * ```typescript
 * import { SubagentRegistry, CapacityError } from "@teamsland/sidecar";
 *
 * try {
 *   registry.register(record);
 * } catch (err) {
 *   if (err instanceof CapacityError) {
 *     await notifier.sendDm(userId, `容量已满（${err.current}/${err.max}），任务排队等待`);
 *   }
 * }
 * ```
 */
export class CapacityError extends Error {
  /** 当前运行中的 Agent 数量 */
  readonly current: number;
  /** 最大允许并发数 */
  readonly max: number;

  constructor(current: number, max: number) {
    super(`容量超限：当前 ${current} / 最大 ${max}`);
    this.name = "CapacityError";
    this.current = current;
    this.max = max;
  }
}

/**
 * SubagentRegistry 构造参数
 *
 * @example
 * ```typescript
 * import type { SubagentRegistryOpts } from "@teamsland/sidecar";
 *
 * const opts: SubagentRegistryOpts = {
 *   config: sidecarConfig,
 *   notifier: larkNotifier,
 *   registryPath: "/var/run/teamsland/registry.json",
 * };
 * ```
 */
export interface SubagentRegistryOpts {
  /** Sidecar 配置（用于读取 maxConcurrentSessions） */
  config: SidecarConfig;
  /** 飞书通知器（容量告警时发送 DM） */
  notifier: LarkNotifier;
  /** 注册表持久化文件路径，默认 `/tmp/teamsland-registry.json` */
  registryPath?: string;
  /** 可选 logger，不传则不记录日志 */
  logger?: Logger;
}

/**
 * Agent 注册表
 *
 * 维护所有运行中 Claude Code 子进程的内存索引，支持崩溃恢复。
 * 持久化采用 write-tmp + rename 的原子写入策略。
 *
 * @example
 * ```typescript
 * import { SubagentRegistry } from "@teamsland/sidecar";
 *
 * const registry = new SubagentRegistry({
 *   config: sidecarConfig,
 *   notifier: larkNotifier,
 *   registryPath: "/var/run/teamsland/registry.json",
 * });
 *
 * await registry.restoreOnStartup();
 * ```
 */
export class SubagentRegistry {
  private readonly map = new Map<string, AgentRecord>();
  private readonly config: SidecarConfig;
  private readonly registryPath: string;
  private readonly logger: Logger | undefined;
  private readonly listeners: Array<(agents: AgentRecord[]) => void> = [];

  constructor(opts: SubagentRegistryOpts) {
    this.config = opts.config;
    this.registryPath = opts.registryPath ?? "/tmp/teamsland-registry.json";
    this.logger = opts.logger;
  }

  /**
   * 注册 Agent
   *
   * 将 AgentRecord 添加到内存注册表。
   * 若当前运行数 >= maxConcurrentSessions，抛出 CapacityError。
   *
   * @param record - Agent 记录
   * @throws {CapacityError} 容量超限时抛出
   *
   * @example
   * ```typescript
   * registry.register({
   *   agentId: "agent-001",
   *   pid: 12345,
   *   sessionId: "sess-abc",
   *   issueId: "ISSUE-42",
   *   worktreePath: "/repos/fe/.worktrees/req-42",
   *   status: "running",
   *   retryCount: 0,
   *   createdAt: Date.now(),
   * });
   * ```
   */
  register(record: AgentRecord): void {
    const current = this.map.size;
    if (current >= this.config.maxConcurrentSessions) {
      throw new CapacityError(current, this.config.maxConcurrentSessions);
    }
    this.map.set(record.agentId, record);
    this.logger?.info({ agentId: record.agentId, pid: record.pid }, "Agent 注册成功");
    this.notifyListeners();
  }

  /**
   * 注销 Agent
   *
   * 从内存注册表中移除指定 agentId 的记录。
   * 若 agentId 不存在则静默忽略。
   *
   * @param agentId - Agent 唯一标识
   *
   * @example
   * ```typescript
   * registry.unregister("agent-001");
   * ```
   */
  unregister(agentId: string): void {
    this.map.delete(agentId);
    this.logger?.info({ agentId }, "Agent 注销完成");
    this.notifyListeners();
  }

  /**
   * 获取单条 Agent 记录
   *
   * @param agentId - Agent 唯一标识
   * @returns Agent 记录，不存在时返回 undefined
   *
   * @example
   * ```typescript
   * const record = registry.get("agent-001");
   * if (record) {
   *   console.log("状态:", record.status);
   * }
   * ```
   */
  get(agentId: string): AgentRecord | undefined {
    return this.map.get(agentId);
  }

  /**
   * 根据 Session ID 查找 Agent 记录
   *
   * 遍历注册表查找 `sessionId` 匹配的记录。
   * Dashboard 使用 sessionId 标识会话，此方法用于从 sessionId 反查 AgentRecord。
   *
   * @param sessionId - Claude Session ID
   * @returns 匹配的 Agent 记录，未找到时返回 undefined
   *
   * @example
   * ```typescript
   * const record = registry.findBySessionId("sess-abc123");
   * if (record && record.status === "running") {
   *   console.log("会话正在运行中");
   * }
   * ```
   */
  findBySessionId(sessionId: string): AgentRecord | undefined {
    for (const record of this.map.values()) {
      if (record.sessionId === sessionId) return record;
    }
    return undefined;
  }

  /**
   * 获取当前运行中的 Agent 数量
   *
   * @returns 内存注册表中的条目总数
   *
   * @example
   * ```typescript
   * console.log(`当前运行: ${registry.runningCount()} 个 Agent`);
   * ```
   */
  runningCount(): number {
    return this.map.size;
  }

  /**
   * 获取所有运行中的 Agent 记录列表
   *
   * @returns AgentRecord 数组（快照，修改不影响内部状态）
   *
   * @example
   * ```typescript
   * for (const agent of registry.allRunning()) {
   *   console.log(agent.agentId, agent.pid);
   * }
   * ```
   */
  allRunning(): AgentRecord[] {
    return [...this.map.values()];
  }

  /**
   * 订阅注册表变更事件
   *
   * 每次 `register()` 或 `unregister()` 后，所有订阅者会收到当前完整 Agent 列表快照。
   * 返回取消订阅函数。
   *
   * @param listener - 变更回调，参数为最新 Agent 列表
   * @returns 取消订阅函数
   *
   * @example
   * ```typescript
   * const unsub = registry.subscribe((agents) => {
   *   console.log("Agent 列表变更:", agents.length);
   * });
   * // 取消订阅
   * unsub();
   * ```
   */
  subscribe(listener: (agents: AgentRecord[]) => void): () => void {
    this.listeners.push(listener);
    return () => {
      const idx = this.listeners.indexOf(listener);
      if (idx >= 0) this.listeners.splice(idx, 1);
    };
  }

  /**
   * 将注册表状态原子写入磁盘
   *
   * 策略：先写临时文件，再 rename 覆盖目标文件，保证原子性。
   * 使用 `Bun.write()` 进行文件操作，`node:fs/promises` 的 rename 完成原子交换。
   *
   * @example
   * ```typescript
   * await registry.persist();
   * ```
   */
  async persist(): Promise<void> {
    const state = this.toRegistryState();
    const json = JSON.stringify(state, null, 2);
    const tmpPath = `${this.registryPath}.tmp`;
    await Bun.write(tmpPath, json);
    // rename 在同一文件系统内是原子操作
    await rename(tmpPath, this.registryPath);
    this.logger?.info({ path: this.registryPath }, "注册表已持久化");
  }

  /**
   * 启动时从磁盘恢复注册表
   *
   * 行为：
   * 1. 读取 registryPath 文件（不存在则跳过）
   * 2. 解析 JSON 为 RegistryState
   * 3. 对每条记录检查 isAlive(pid)，死进程直接丢弃
   * 4. 将存活的 AgentRecord 重新加载到内存注册表
   * 5. 对存活的孤儿进程启动周期性健康监控
   *
   * 设计为幂等操作，多次调用无副作用。
   * 返回孤儿监控定时器 ID，调用方需在关闭时 clearInterval。
   * 若无存活孤儿则返回 null。
   *
   * @returns 孤儿监控定时器 ID，或 null（无孤儿时）
   *
   * @example
   * ```typescript
   * const orphanTimer = await registry.restoreOnStartup();
   * // 关闭时清理定时器
   * if (orphanTimer) clearInterval(orphanTimer);
   * ```
   */
  async restoreOnStartup(): Promise<ReturnType<typeof setInterval> | null> {
    const file = Bun.file(this.registryPath);
    if (!(await file.exists())) return null;

    const text = await file.text();
    const state = JSON.parse(text) as RegistryState;

    let restored = 0;
    let cleaned = 0;
    const orphanIds: string[] = [];
    for (const record of state.agents) {
      if (this.isAlive(record.pid)) {
        this.map.set(record.agentId, record);
        orphanIds.push(record.agentId);
        restored++;
      } else {
        cleaned++;
      }
    }
    this.logger?.info({ restored, cleaned }, "注册表恢复完成");

    if (orphanIds.length === 0) return null;

    this.logger?.warn({ orphanIds }, "检测到孤儿进程 — 已恢复到注册表但无法重新绑定流处理，将通过周期性探活监控");

    return this.startOrphanMonitor(orphanIds);
  }

  /**
   * 导出注册表状态快照
   *
   * @returns RegistryState 快照（含所有运行中 Agent + 更新时间戳）
   *
   * @example
   * ```typescript
   * const state = registry.toRegistryState();
   * console.log(state.agents.length, state.updatedAt);
   * ```
   */
  toRegistryState(): RegistryState {
    return {
      agents: this.allRunning(),
      updatedAt: Date.now(),
    };
  }

  /** 探测进程存活（内联实现，避免依赖 ProcessController） */
  private isAlive(pid: number): boolean {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }

  /** 通知所有监听者注册表已变更 */
  private notifyListeners(): void {
    if (this.listeners.length === 0) return;
    const snapshot = this.allRunning();
    for (const listener of this.listeners) {
      listener(snapshot);
    }
  }

  /**
   * 启动孤儿进程周期性健康监控
   *
   * 每 30 秒检测一次孤儿进程存活状态。
   * 进程死亡时将其从注册表中移除并标记 status = "failed"。
   * 所有孤儿进程全部清理完毕后自动停止定时器。
   */
  private startOrphanMonitor(orphanIds: string[]): ReturnType<typeof setInterval> {
    const remaining = new Set(orphanIds);
    const timer = setInterval(() => {
      for (const agentId of remaining) {
        const record = this.map.get(agentId);
        if (!record) {
          remaining.delete(agentId);
          continue;
        }
        if (!this.isAlive(record.pid)) {
          record.status = "failed";
          this.map.delete(agentId);
          remaining.delete(agentId);
          this.logger?.info({ agentId, pid: record.pid }, "孤儿进程已退出，从注册表中清理");
        }
      }
      if (remaining.size === 0) {
        this.logger?.info("所有孤儿进程已清理完毕，停止监控");
        clearInterval(timer);
      }
    }, 30_000);
    return timer;
  }
}
