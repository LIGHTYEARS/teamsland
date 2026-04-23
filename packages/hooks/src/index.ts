// @teamsland/hooks — Hook 引擎类型定义与核心导出
// 所有类型通过此 barrel 统一导出

export { buildHookContext } from "./context.js";
export { HookEngine } from "./engine.js";
export { HookMetricsCollector } from "./metrics.js";
export type {
  HookContext,
  HookContextDeps,
  HookEngineConfig,
  HookLarkAccess,
  HookLogger,
  HookMetrics,
  HookModule,
  HookNotifierAccess,
  HookRegistryAccess,
  HookSpawnOptions,
  HookSpawnResult,
  HookStatus,
  LoadedHook,
  MetricsSnapshot,
} from "./types.js";
export { isValidHookModule } from "./validation.js";
