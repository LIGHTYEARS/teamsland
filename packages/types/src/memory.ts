/**
 * 记忆类型枚举
 *
 * 团队记忆系统支持的 12 种记忆分类，覆盖从个体偏好到项目上下文的全部语义域。
 */
export type MemoryType =
  | "profile"
  | "preferences"
  | "entities"
  | "events"
  | "cases"
  | "patterns"
  | "tools"
  | "skills"
  | "decisions"
  | "project_context"
  | "soul"
  | "identity";
