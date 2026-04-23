import { createLogger } from "@teamsland/observability";

const logger = createLogger("context:template-loader");

/**
 * 加载指定角色的指令模板
 *
 * 从本地 Markdown 文件读取 Agent 角色的指令模板。
 * 模板路径约定：`{basePath}/{agentRole}.md`
 * 文件不存在时立即抛出，不返回空字符串（fail-fast）。
 *
 * @deprecated 将在 Coordinator 架构下被移除。DynamicContextAssembler 已不再调用此函数（§E 角色指令段已移除）。
 * 保留供外部可能的引用，后续版本清理。
 *
 * @param agentRole - Agent 角色标识符（如 "frontend-dev"、"tech-spec"）
 * @param basePath - 模板目录路径，默认为 "config/templates"
 * @returns 模板文件内容字符串
 * @throws 若文件不存在则抛出 Error
 *
 * @example
 * ```typescript
 * import { loadTemplate } from "@teamsland/context";
 *
 * const content = await loadTemplate("frontend-dev");
 * // 读取 config/templates/frontend-dev.md 并返回内容
 * ```
 */
export async function loadTemplate(agentRole: string, basePath = "config/templates"): Promise<string> {
  const filePath = `${basePath}/${agentRole}.md`;
  logger.debug({ agentRole, filePath }, "加载角色模板");

  const file = Bun.file(filePath);
  const exists = await file.exists();
  if (!exists) {
    throw new Error(`角色模板文件不存在: ${filePath}`);
  }

  const content = await file.text();
  logger.debug({ agentRole, bytes: content.length }, "角色模板加载成功");
  return content;
}
