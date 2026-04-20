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
   *
   * 设计为幂等操作，多次调用无副作用。
   *
   * @example
   * ```typescript
   * await registry.restoreOnStartup();
   * logger.info({ count: registry.runningCount() }, "注册表恢复完成");
   * ```
   */
  async restoreOnStartup(): Promise<void> {
    const file = Bun.file(this.registryPath);
    if (!(await file.exists())) return;

    const text = await file.text();
    const state = JSON.parse(text) as RegistryState;

    let restored = 0;
    let cleaned = 0;
    for (const record of state.agents) {
      if (this.isAlive(record.pid)) {
        this.map.set(record.agentId, record);
        restored++;
      } else {
        cleaned++;
      }
    }
    this.logger?.info({ restored, cleaned }, "注册表恢复完成");
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
}
