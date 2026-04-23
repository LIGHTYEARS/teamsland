/**
 * @deprecated 将在 Coordinator 架构下被 teamsland CLI 的多 worker spawn 替代。
 * 参见 PRODUCT.md "大脑 + 手脚" 章节。
 *
 * @module @teamsland/swarm
 */

export { runSwarm } from "./swarm.js";
export { TaskPlanner } from "./task-planner.js";
export type { LlmClient, LlmResponse, SwarmOpts } from "./types.js";
export { runWorker } from "./worker.js";
