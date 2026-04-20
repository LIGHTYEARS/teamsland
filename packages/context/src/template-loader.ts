import { createLogger } from "@teamsland/observability";

const logger = createLogger("context:template-loader");

/**
 * 角色指令模板加载器
 *
 * 从本地 Markdown 文件读取 Agent 角色的指令模板。
 * 模板路径约定：`{basePath}/{agentRole}.md`
 * 文件不存在时立即抛出，不返回空字符串（fail-fast）。
 *
 * @example
 * ```typescript
 * const content = await TemplateLoader.load("frontend-dev");
 * // 读取 config/templates/frontend-dev.md 并返回内容
 * ```
 */
export class TemplateLoader {
  /**
   * 加载指定角色的指令模板
   *
   * @param agentRole - Agent 角色标识符（如 "frontend-dev"、"tech-spec"）
   * @param basePath - 模板目录路径，默认为 "config/templates"
   * @returns 模板文件内容字符串
   * @throws 若文件不存在则抛出 Error
   *
   * @example
   * ```typescript
   * // 加载前端开发角色模板
   * const template = await TemplateLoader.load("frontend-dev", "config/templates");
   * console.log(template); // "# 前端开发 Agent 指令\n..."
   * ```
   */
  static async load(agentRole: string, basePath = "config/templates"): Promise<string> {
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
}
