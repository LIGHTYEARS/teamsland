import { describe, expect, it } from "vitest";
import { DocumentParser } from "../document-parser.js";

const SAMPLE_MD = `# 用户中心技术方案

## 模块架构

本方案包含 UserService 和 AuthModule 两个核心模块。

## API 设计

- POST /api/users/login
- GET /api/users/:id

## 数据模型

\`\`\`typescript
interface UserRecord { id: string; name: string; }
\`\`\``.trim();

describe("DocumentParser", () => {
  const parser = new DocumentParser();

  it("正确提取文档标题", () => {
    const doc = parser.parseMarkdown(SAMPLE_MD);
    expect(doc.title).toBe("用户中心技术方案");
  });

  it("正确拆分章节（1 个一级标题 + 3 个二级章节）", () => {
    const doc = parser.parseMarkdown(SAMPLE_MD);
    const h2Sections = doc.sections.filter((s) => s.level === 2);
    expect(h2Sections).toHaveLength(3);
    expect(h2Sections[0].heading).toBe("模块架构");
    expect(h2Sections[1].heading).toBe("API 设计");
    expect(h2Sections[2].heading).toBe("数据模型");
  });

  it("章节 level 与标题层级一致", () => {
    const doc = parser.parseMarkdown(SAMPLE_MD);
    const h1 = doc.sections.filter((s) => s.level === 1);
    expect(h1).toHaveLength(1);
    expect(h1[0].heading).toBe("用户中心技术方案");
  });

  it("提取 API 路径到 entities", () => {
    const doc = parser.parseMarkdown(SAMPLE_MD);
    expect(doc.entities.some((e) => e.includes("/api/users/login"))).toBe(true);
    expect(doc.entities.some((e) => e.includes("/api/users/:id"))).toBe(true);
  });

  it("提取 PascalCase 模块名到 entities", () => {
    const doc = parser.parseMarkdown(SAMPLE_MD);
    expect(doc.entities).toContain("UserService");
    expect(doc.entities).toContain("AuthModule");
  });

  it("提取 interface 类型名到 entities", () => {
    const doc = parser.parseMarkdown(SAMPLE_MD);
    expect(doc.entities).toContain("UserRecord");
  });

  it("空文档返回空结构", () => {
    const doc = parser.parseMarkdown("");
    expect(doc.title).toBe("");
    expect(doc.sections).toHaveLength(0);
    expect(doc.entities).toHaveLength(0);
  });

  it("无一级标题时 title 为空字符串，其他章节正常提取", () => {
    const md = `## 概述\n\n本文档描述系统架构。\n\n## 详情\n\n见附件。`;
    const doc = parser.parseMarkdown(md);
    expect(doc.title).toBe("");
    expect(doc.sections).toHaveLength(2);
  });

  it("实体去重：同名实体只出现一次", () => {
    const md = `# 测试\n\nUserService 模块\n\n## 详情\n\nUserService 处理用户逻辑。`;
    const doc = parser.parseMarkdown(md);
    const count = doc.entities.filter((e) => e === "UserService").length;
    expect(count).toBe(1);
  });

  it("多级标题均被正确提取", () => {
    const md = `# 一级标题\n\n## 二级标题\n\n### 三级标题\n\n内容`;
    const doc = parser.parseMarkdown(md);
    expect(doc.sections.find((s) => s.level === 1)?.heading).toBe("一级标题");
    expect(doc.sections.find((s) => s.level === 2)?.heading).toBe("二级标题");
    expect(doc.sections.find((s) => s.level === 3)?.heading).toBe("三级标题");
  });

  it("提取 type 声明名称到 entities", () => {
    const md = `# 类型文档\n\n\`\`\`typescript\ntype TaskConfig = { id: string };\n\`\`\``;
    const doc = parser.parseMarkdown(md);
    expect(doc.entities).toContain("TaskConfig");
  });
});
