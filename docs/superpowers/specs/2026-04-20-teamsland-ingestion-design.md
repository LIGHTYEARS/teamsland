# @teamsland/ingestion Design Spec

> **TL;DR**: 意图识别与文档解析 — 规则快速路径 + Claude Haiku LLM 回退的两阶段意图分类器，以及从 Markdown PRD/技术方案中提取结构化章节的文档解析器。5 个源文件，1 个可注入接口（LlmClient）保障可测试性。叶子包，最小化依赖。

---

## 目录

- [概述](#概述)
- [依赖关系](#依赖关系)
- [文件结构](#文件结构)
- [本地类型定义（types.ts）](#本地类型定义typests)
- [IntentClassifier](#intentclassifier)
- [DocumentParser](#documentparser)
- [Barrel Exports](#barrel-exports)
- [测试策略](#测试策略)
- [约束与限制](#约束与限制)

---

## 概述

`@teamsland/ingestion` 是意图识别和文档解析的低层叶子包，为上游的 `@teamsland/context`、`@teamsland/sidecar` 提供两项核心能力：

**核心能力：**
- **IntentClassifier** — 两阶段分类 Pipeline：先通过关键词规则快速路径（无 LLM 调用），置信度不足时回退到 Claude Haiku LLM 分类 + 实体提取
- **DocumentParser** — 纯工具类，从 Markdown PRD 和技术方案文档中提取结构化章节、模块名、API 路径、数据模型

包内局部定义 `LlmClient` 接口（duck typing），避免引入 `@teamsland/memory` 的重型依赖，保持叶子包地位。

---

## 依赖关系

```
@teamsland/types        — MeegoEvent, IntentType, IntentResult（仅类型）
@teamsland/observability — createLogger
```

**不依赖：**
- `@teamsland/memory` — LlmClient 接口在包内局部复制，duck typing，避免循环依赖
- 外部 HTTP 库 — LlmClient 的真实实现由应用层注入，包内不发起 HTTP 请求

**package.json 依赖：**
- `@teamsland/types`: workspace dependency
- `@teamsland/observability`: workspace dependency

---

## 文件结构

```
packages/ingestion/src/
├── types.ts                     # 本地 LlmClient、LlmMessage、LlmResponse 接口（duck-typed）
├── intent-classifier.ts         # IntentClassifier — 规则快速路径 + LLM 回退
├── document-parser.ts           # DocumentParser — Markdown 结构化提取
├── index.ts                     # Barrel re-exports
└── __tests__/
    ├── intent-classifier.test.ts
    └── document-parser.test.ts
```

---

## 本地类型定义（types.ts）

为避免依赖 `@teamsland/memory`，在包内局部定义以下接口：

```typescript
// packages/ingestion/src/types.ts

/**
 * LLM 单条消息
 */
export interface LlmMessage {
  /** 消息角色 */
  role: "system" | "user" | "assistant";
  /** 消息内容 */
  content: string;
}

/**
 * LLM 调用返回值
 */
export interface LlmResponse {
  /** 文本回复内容 */
  content: string;
}

/**
 * LLM 客户端接口（本地 duck-typed 定义）
 *
 * 与 @teamsland/memory 的 LlmClient 接口结构兼容，但独立声明以保持叶子包地位。
 * 真实实现（包装 Claude API）由应用层在启动时注入。
 *
 * @example
 * ```typescript
 * import type { LlmClient } from "@teamsland/ingestion";
 *
 * // 测试用 FakeLlmClient
 * const fakeLlm: LlmClient = {
 *   async chat(messages) {
 *     return { content: '{"type":"tech_spec","confidence":0.92,"entities":{}}' };
 *   },
 * };
 * ```
 */
export interface LlmClient {
  /** 发送对话消息并获取回复 */
  chat(messages: LlmMessage[]): Promise<LlmResponse>;
}
```

---

## IntentClassifier

```typescript
// packages/ingestion/src/intent-classifier.ts
```

### 构造函数

```typescript
/**
 * 意图分类器
 *
 * 两阶段分类 Pipeline：规则快速路径（关键词匹配）+ LLM 回退（Claude Haiku）。
 * LlmClient 通过构造函数注入，便于测试时替换为 FakeLlmClient。
 *
 * @example
 * ```typescript
 * import { IntentClassifier } from "@teamsland/ingestion";
 * import type { LlmClient } from "@teamsland/ingestion";
 *
 * declare const llm: LlmClient; // 由应用层注入
 *
 * const classifier = new IntentClassifier({ llm });
 * const result = await classifier.classify("评审一下这个技术方案");
 * // result.type === "tech_spec", result.confidence >= 0.9
 * ```
 */
export class IntentClassifier {
  constructor(opts: { llm: LlmClient })
}
```

### classify 方法

```typescript
/**
 * 对输入文本或 MeegoEvent 进行意图分类
 *
 * Pipeline 步骤：
 * 1. 若输入为 MeegoEvent，提取 title + description 拼接为字符串
 * 2. 规则快速路径 — 关键词匹配，匹配则返回（confidence 0.9）
 * 3. 若规则置信度 < 0.8，调用 LLM 分类 + 实体提取
 * 4. 若 LLM 置信度 < 0.5，回退返回 type = "query"
 *
 * @param input - 待分类的输入（字符串或 MeegoEvent）
 * @returns IntentResult，包含 type、confidence、entities
 *
 * @example
 * ```typescript
 * const result = await classifier.classify("前端开发这个需求");
 * // { type: "frontend_dev", confidence: 0.9, entities: { modules: [], owners: [], domains: [] } }
 *
 * const event: MeegoEvent = { title: "评审设计文档", description: "..." };
 * const result2 = await classifier.classify(event);
 * // { type: "design", confidence: 0.9, entities: { modules: [...], ... } }
 * ```
 */
async classify(input: string | MeegoEvent): Promise<IntentResult>
```

### 规则快速路径

内部纯函数 `applyRules(text: string): { type: IntentType; confidence: number } | null`：

| 关键词组 | 匹配到的 IntentType | 置信度 |
|----------|---------------------|--------|
| `技术方案`、`技术设计`、`架构设计`、`系统设计` | `"tech_spec"` | 0.9 |
| `设计`、`原型`、`UI`、`交互` | `"design"` | 0.9 |
| `评审`、`review`、`code review` | `"tech_spec"` | 0.9 |
| `前端`、`frontend`、`页面`、`组件` | `"frontend_dev"` | 0.9 |
| `确认`、`confirm`、`approve`、`批准` | `"confirm"` | 0.9 |
| `状态`、`进度`、`同步`、`更新` | `"status_sync"` | 0.85 |

匹配优先级由上至下，首个匹配即返回。无匹配返回 `null`（触发 LLM 回退）。

关键词匹配**大小写不敏感**（`text.toLowerCase()` 后比较）。

### LLM 回退

系统提示词要求 LLM 以 JSON 格式返回：

```json
{
  "type": "query",
  "confidence": 0.75,
  "entities": {
    "modules": ["用户管理"],
    "owners": ["张三"],
    "domains": ["后端"]
  }
}
```

若 JSON 解析失败，返回 `{ type: "query", confidence: 0, entities: { modules: [], owners: [], domains: [] } }`，后续会触发低置信度回退逻辑。

### 完整实现示意

```typescript
// packages/ingestion/src/intent-classifier.ts

import { createLogger } from "@teamsland/observability";
import type { IntentResult, IntentType, MeegoEvent } from "@teamsland/types";
import type { LlmClient } from "./types.js";

const logger = createLogger("ingestion:intent");

const RULES: Array<{ keywords: string[]; type: IntentType; confidence: number }> = [
  { keywords: ["技术方案", "技术设计", "架构设计", "系统设计"], type: "tech_spec", confidence: 0.9 },
  { keywords: ["设计", "原型", "ui", "交互"], type: "design", confidence: 0.9 },
  { keywords: ["评审", "review", "code review"], type: "tech_spec", confidence: 0.9 },
  { keywords: ["前端", "frontend", "页面", "组件"], type: "frontend_dev", confidence: 0.9 },
  { keywords: ["确认", "confirm", "approve", "批准"], type: "confirm", confidence: 0.9 },
  { keywords: ["状态", "进度", "同步", "更新"], type: "status_sync", confidence: 0.85 },
];

const FALLBACK_RESULT: IntentResult = {
  type: "query",
  confidence: 0,
  entities: { modules: [], owners: [], domains: [] },
};

function eventToString(event: MeegoEvent): string {
  return [event.title, event.description].filter(Boolean).join(" ");
}

function applyRules(text: string): { type: IntentType; confidence: number } | null {
  const lower = text.toLowerCase();
  for (const rule of RULES) {
    if (rule.keywords.some((kw) => lower.includes(kw))) {
      return { type: rule.type, confidence: rule.confidence };
    }
  }
  return null;
}

export class IntentClassifier {
  private readonly llm: LlmClient;

  constructor(opts: { llm: LlmClient }) {
    this.llm = opts.llm;
  }

  async classify(input: string | MeegoEvent): Promise<IntentResult> {
    const text = typeof input === "string" ? input : eventToString(input);
    logger.debug({ textLen: text.length }, "开始意图分类");

    const ruleResult = applyRules(text);
    if (ruleResult !== null && ruleResult.confidence >= 0.8) {
      logger.info({ type: ruleResult.type, confidence: ruleResult.confidence, path: "rules" }, "规则快速路径命中");
      return { ...ruleResult, entities: { modules: [], owners: [], domains: [] } };
    }

    logger.debug("规则置信度不足，回退到 LLM 分类");
    const llmResult = await this.classifyWithLlm(text);

    if (llmResult.confidence < 0.5) {
      logger.warn({ confidence: llmResult.confidence }, "LLM 置信度低于阈值，回退到 query");
      return { type: "query", confidence: llmResult.confidence, entities: llmResult.entities };
    }

    logger.info({ type: llmResult.type, confidence: llmResult.confidence, path: "llm" }, "LLM 分类完成");
    return llmResult;
  }

  private async classifyWithLlm(text: string): Promise<IntentResult> {
    const messages = [
      {
        role: "system" as const,
        content: `你是意图分类助手。将用户输入分类为以下类型之一：
frontend_dev | tech_spec | design | query | status_sync | confirm

同时提取实体：modules（模块名）、owners（负责人）、domains（领域）。

以 JSON 格式回复，例如：
{"type":"tech_spec","confidence":0.9,"entities":{"modules":["用户中心"],"owners":[],"domains":["后端"]}}`,
      },
      { role: "user" as const, content: text },
    ];

    try {
      const response = await this.llm.chat(messages);
      const parsed = JSON.parse(response.content) as {
        type: IntentType;
        confidence: number;
        entities: { modules: string[]; owners: string[]; domains: string[] };
      };
      return {
        type: parsed.type,
        confidence: parsed.confidence,
        entities: parsed.entities,
      };
    } catch (err) {
      logger.error({ err }, "LLM 分类失败，返回默认结果");
      return { ...FALLBACK_RESULT };
    }
  }
}
```

---

## DocumentParser

```typescript
// packages/ingestion/src/document-parser.ts
```

### 类型定义

```typescript
/**
 * Markdown 文档的单个章节
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
```

### parseMarkdown 方法

```typescript
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
 * // doc.sections.length === 3
 * // doc.entities 包含 ["UserService", "AuthModule", "/api/users/login", "/api/users/:id", "UserRecord"]
 * ```
 */
parseMarkdown(content: string): ParsedDocument
```

### 实体提取规则

内部函数 `extractEntities(sections: Section[]): string[]`，对每个章节的 heading + content 应用以下正则：

| 实体类型 | 正则表达式 | 示例 |
|----------|-----------|------|
| API 路径 | `/((?:GET\|POST\|PUT\|DELETE\|PATCH)\s+)?\/[a-zA-Z0-9/_:.-]{2,}/g` | `/api/users/:id`、`POST /api/users/login` |
| PascalCase 模块名 | `/\b[A-Z][a-zA-Z0-9]{2,}(?:Service\|Module\|Controller\|Store\|Model\|Handler\|Manager\|Client\|Adapter)\b/g` | `UserService`、`AuthModule` |
| interface/type/class 名 | `/(?:interface\|type\|class)\s+([A-Z][a-zA-Z0-9]+)/g`（提取捕获组） | `UserRecord`、`TaskConfig` |

所有匹配结果合并后去重（`new Set()`），返回字符串数组。

### 完整实现示意

```typescript
// packages/ingestion/src/document-parser.ts

import { createLogger } from "@teamsland/observability";

const logger = createLogger("ingestion:parser");

const HEADING_RE = /^(#{1,6})\s+(.+)$/m;
const API_PATH_RE = /(?:(?:GET|POST|PUT|DELETE|PATCH)\s+)?\/[a-zA-Z0-9/_:.-]{2,}/g;
const MODULE_RE = /\b[A-Z][a-zA-Z0-9]{2,}(?:Service|Module|Controller|Store|Model|Handler|Manager|Client|Adapter)\b/g;
const TYPE_DECL_RE = /(?:interface|type|class)\s+([A-Z][a-zA-Z0-9]+)/g;

export interface Section {
  heading: string;
  level: number;
  content: string;
}

export interface ParsedDocument {
  title: string;
  sections: Section[];
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
```

---

## Barrel Exports

```typescript
// packages/ingestion/src/index.ts

// @teamsland/ingestion — 意图识别与文档解析
// 两阶段意图分类（规则 + LLM）+ Markdown 结构化提取

export { IntentClassifier } from "./intent-classifier.js";
export { DocumentParser } from "./document-parser.js";
export type { ParsedDocument, Section } from "./document-parser.js";
export type { LlmClient, LlmMessage, LlmResponse } from "./types.js";
```

---

## 测试策略

### 测试工具

- **FakeLlmClient** — 返回预编程的 `LlmResponse` 序列（通过队列 or 映射实现），用于 IntentClassifier 的 LLM 回退路径测试
- **DocumentParser** — 纯函数，无外部依赖，直接传入 Markdown 字符串测试

### IntentClassifier 测试重点

| 场景 | 验证点 | 是否调用 LLM |
|------|--------|--------------|
| 规则快速路径命中（如"评审技术方案"） | type 正确，confidence >= 0.9，FakeLlmClient.chat 未被调用 | 否 |
| 规则无匹配，LLM 返回高置信度 | type 来自 LLM 响应，entities 正确解析 | 是 |
| 规则无匹配，LLM 返回低置信度（< 0.5） | type === "query"，confidence 保留 LLM 原值 | 是 |
| LLM 返回非 JSON / 解析失败 | 不抛出，返回 type === "query"，confidence === 0 | 是 |
| MeegoEvent 输入 | title + description 拼接后正确分类 | 视关键词 |

```typescript
// packages/ingestion/src/__tests__/intent-classifier.test.ts（示例片段）

import { describe, expect, it, vi } from "vitest";
import type { LlmClient } from "../types.js";
import { IntentClassifier } from "../intent-classifier.js";

function makeFakeLlm(response: string): LlmClient {
  return {
    chat: vi.fn().mockResolvedValue({ content: response }),
  };
}

describe("IntentClassifier — 规则快速路径", () => {
  it("包含'技术方案'时命中规则，不调用 LLM", async () => {
    const llm = makeFakeLlm("");
    const classifier = new IntentClassifier({ llm });

    const result = await classifier.classify("帮我评审一下这个技术方案");

    expect(result.type).toBe("tech_spec");
    expect(result.confidence).toBeGreaterThanOrEqual(0.9);
    expect(llm.chat).not.toHaveBeenCalled();
  });
});

describe("IntentClassifier — LLM 回退路径", () => {
  it("规则无匹配时调用 LLM 并解析结果", async () => {
    const llmResponse = JSON.stringify({
      type: "query",
      confidence: 0.82,
      entities: { modules: ["OrderService"], owners: [], domains: ["后端"] },
    });
    const llm = makeFakeLlm(llmResponse);
    const classifier = new IntentClassifier({ llm });

    const result = await classifier.classify("这个订单系统是怎么运作的？");

    expect(result.type).toBe("query");
    expect(result.confidence).toBeCloseTo(0.82);
    expect(result.entities.modules).toContain("OrderService");
    expect(llm.chat).toHaveBeenCalledOnce();
  });

  it("LLM 置信度 < 0.5 时回退到 query 类型", async () => {
    const llmResponse = JSON.stringify({
      type: "tech_spec",
      confidence: 0.3,
      entities: { modules: [], owners: [], domains: [] },
    });
    const llm = makeFakeLlm(llmResponse);
    const classifier = new IntentClassifier({ llm });

    const result = await classifier.classify("balabala 随便说点什么");

    expect(result.type).toBe("query");
  });

  it("LLM 返回非 JSON 时不抛出，返回 query + confidence 0", async () => {
    const llm = makeFakeLlm("我不会 JSON");
    const classifier = new IntentClassifier({ llm });

    const result = await classifier.classify("随便的输入");

    expect(result.type).toBe("query");
    expect(result.confidence).toBe(0);
  });
});
```

### DocumentParser 测试重点

| 场景 | 验证点 |
|------|--------|
| 标准 Markdown（多级标题） | sections 数量、heading 文本、level、content 内容正确 |
| 提取 API 路径 | `/api/users/:id`、`POST /api/users/login` 出现在 entities |
| 提取 PascalCase 模块名 | `UserService`、`AuthModule` 出现在 entities |
| 提取 interface/type/class 名 | `UserRecord`、`TaskConfig` 出现在 entities |
| 空文档 | title === ""，sections === []，entities === [] |
| 无一级标题 | title === ""，其他章节正常提取 |
| 实体去重 | 同名实体只出现一次 |

```typescript
// packages/ingestion/src/__tests__/document-parser.test.ts（示例片段）

import { describe, expect, it } from "vitest";
import { DocumentParser } from "../document-parser.js";

const SAMPLE_MD = `
# 用户中心技术方案

## 模块架构

本方案包含 UserService 和 AuthModule 两个核心模块。

## API 设计

- POST /api/users/login
- GET /api/users/:id

## 数据模型

\`\`\`typescript
interface UserRecord { id: string; name: string; }
\`\`\`
`.trim();

describe("DocumentParser", () => {
  const parser = new DocumentParser();

  it("正确提取文档标题", () => {
    const doc = parser.parseMarkdown(SAMPLE_MD);
    expect(doc.title).toBe("用户中心技术方案");
  });

  it("正确拆分 3 个二级章节", () => {
    const doc = parser.parseMarkdown(SAMPLE_MD);
    // 标题本身也是 section，需排除
    const h2Sections = doc.sections.filter((s) => s.level === 2);
    expect(h2Sections).toHaveLength(3);
    expect(h2Sections[0].heading).toBe("模块架构");
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
});
```

### 运行命令

```bash
# 无额外运行时依赖，直接运行
bunx --bun vitest run packages/ingestion/
```

---

## 约束与限制

1. **LlmClient 局部 duck typing** — 包内 `LlmClient` 接口故意与 `@teamsland/memory` 的接口结构兼容，但独立声明。若将来两者出现 drift，需通过代码审查发现并同步。

2. **LLM 返回格式强依赖** — `classifyWithLlm` 依赖 LLM 输出合法 JSON。`try/catch` 保护解析失败，但系统提示词需要随 Claude API 版本维护，避免 hallucination 破坏结构。

3. **正则提取的误报** — 实体提取基于正则，存在误报（如将 `"POST"` 匹配为 API 路径前缀）。调用方应将 `entities` 视为候选集而非精确集合，后续可交由 `IntentClassifier` 的 LLM 路径进一步过滤。

4. **MeegoEvent 字段约束** — `eventToString()` 仅拼接 `title` 和 `description`，若 MeegoEvent 类型将来新增更多字段，需手动评估是否应纳入分类输入。

5. **无缓存** — `IntentClassifier.classify()` 不缓存结果。若上游大量调用相同输入，建议在调用方添加 memoization。

6. **Biome 格式规范** — 行宽 120，2 格缩进，`import type` 用于所有纯类型导入。提交前须通过 `bun run lint`。
