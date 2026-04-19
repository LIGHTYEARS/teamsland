// @teamsland/config — JSON 配置加载器 + RepoMapping
// 从单一 config.json 加载全局配置，执行环境变量替换

export { resolveEnvVars } from "./env.js";
export { loadConfig } from "./loader.js";
export { RepoMapping } from "./repo-mapping.js";
