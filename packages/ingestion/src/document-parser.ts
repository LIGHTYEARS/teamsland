import { createLogger } from "@teamsland/observability";

const logger = createLogger("ingestion:parser");

const HEADING_RE = /^(#{1,6})\s+(.+)$/m;
const API_PATH_RE = /(?:(?:GET|POST|PUT|DELETE|PATCH)\s+)?\/[a-zA-Z0-9/_:.-]{2,}/g;
const MODULE_RE = /\b[A-Z][a-zA-Z0-9]{2,}(?:Service|Module|Controller|Store|Model|Handler|Manager|Client|Adapter)\b/g;
const TYPE_DECL_RE = /(?:interface|type|class)\s+([A-Z][a-zA-Z0-9]+)/g;

/**
 * Markdown 文档的单个章节
 *
 * @example
 * ```typescript
 * import type { Section } from "@teamsland/ingestion";
 *
 * const section: Section = { heading: "API 设计", level: 2, content: "POST /api/users/login" };
 * ```
 */
export interface Section {
  /** 章节标题（不含 # 前缀） */
  heading: string;
  /** 标题级别（1-6） */
  level: number;
  /** 章节正文内容 */
  content: string;
}

/**
 * 解析后的结构化文档
 *
 * @example
 * ```typescript
 * import type { ParsedDocument } from "@teamsland/ingestion";
 *
 * const doc: ParsedDocument = {
 *   title: "用户中心技术方案",
 *   sections: [],
 *   entities: ["UserService", "/api/users/:id"],
 * };
 * ```
 */
export interface ParsedDocument {
  /** 文档标题（一级标题，若无则为空字符串） */
  title: string;
  /** 所有章节列表（按文档顺序） */
  sections: Section[];
  /**
   * 提取的实体列表
   *
   * 包含从标题和正文中识别的模块名、API 路径、数据模型名称。
   */
  entities: string[];
}

/**
 * Markdown 文档结构化解析器
 *
 * 纯工具类，无状态，构造函数不接受参数。
 * 适合在 DI 容器中以单例形式注册。
 *
 * @example
 * ```typescript
 * import { DocumentParser } from "@teamsland/ingestion";
 *
 * const parser = new DocumentParser();
 * const result = parser.parseMarkdown(markdownContent);
 * console.log(result.title);    // 文档标题
 * console.log(result.sections); // 章节列表
 * console.log(result.entities); // 提取的实体
 * ```
 */
export class DocumentParser {
  /**
   * 解析 Markdown PRD / 技术方案文档，提取结构化章节和实体
   *
   * 提取逻辑：
   * 1. 按 ATX 标题（`# ` 到 `###### `）切分文档为章节
   * 2. 从章节标题和正文中提取模块名、API 路径、数据模型
   * 3. 实体去重后返回
   *
   * @param content - Markdown 文档内容
   * @returns 结构化的 ParsedDocument
   *
   * @example
   * ```typescript
   * import { DocumentParser } from "@teamsland/ingestion";
   *
   * const parser = new DocumentParser();
   * const doc = parser.parseMarkdown(`
   * # 用户中心技术方案
   *
   * ## 模块架构
   *
   * 本方案包含 UserService 和 AuthModule 两个核心模块。
   *
   * ## API 设计
   *
   * - POST /api/users/login
   * - GET /api/users/:id
   *
   * ## 数据模型
   *
   * \`\`\`typescript
   * interface UserRecord { id: string; name: string; }
   * \`\`\`
   * `);
   *
   * // doc.title === "用户中心技术方案"
   * // doc.sections.length === 4
   * // doc.entities 包含 ["UserService", "AuthModule", "/api/users/login", "/api/users/:id", "UserRecord"]
   * ```
   */
  parseMarkdown(content: string): ParsedDocument {
    const lines = content.split("\n");
    const sections = this.splitSections(lines);
    const title = sections.find((s) => s.level === 1)?.heading ?? "";
    const entities = extractEntities(sections);

    logger.debug({ title, sectionCount: sections.length, entityCount: entities.length }, "文档解析完成");

    return { title, sections, entities };
  }

  private splitSections(lines: string[]): Section[] {
    const sections: Section[] = [];
    let currentHeading = "";
    let currentLevel = 0;
    const contentLines: string[] = [];

    const flush = (): void => {
      if (currentHeading !== "") {
        sections.push({
          heading: currentHeading,
          level: currentLevel,
          content: contentLines.join("\n").trim(),
        });
      }
      contentLines.length = 0;
    };

    for (const line of lines) {
      const match = HEADING_RE.exec(line);
      if (match !== null) {
        flush();
        currentLevel = match[1].length;
        currentHeading = match[2].trim();
      } else {
        contentLines.push(line);
      }
    }
    flush();

    return sections;
  }
}

function extractEntities(sections: Section[]): string[] {
  const found = new Set<string>();

  for (const section of sections) {
    const text = `${section.heading}\n${section.content}`;

    for (const match of text.matchAll(API_PATH_RE)) {
      found.add(match[0].trim());
    }

    for (const match of text.matchAll(MODULE_RE)) {
      found.add(match[0]);
    }

    for (const match of text.matchAll(TYPE_DECL_RE)) {
      if (match[1] !== undefined) {
        found.add(match[1]);
      }
    }
  }

  return Array.from(found);
}
