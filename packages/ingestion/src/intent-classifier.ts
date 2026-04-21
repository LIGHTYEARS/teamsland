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

/**
 * 将 MeegoEvent 转换为分类用的文本字符串
 *
 * MeegoEvent 的 title 和 description 字段存储在 payload 中，需通过强制类型转换访问。
 */
function eventToString(event: MeegoEvent): string {
  const title = event.payload.title as string | undefined;
  const description = event.payload.description as string | undefined;
  return [title, description].filter(Boolean).join(" ");
}

/**
 * 对文本应用关键词规则，返回首个匹配结果或 null
 */
function applyRules(text: string): { type: IntentType; confidence: number } | null {
  const lower = text.toLowerCase();
  for (const rule of RULES) {
    if (rule.keywords.some((kw) => lower.includes(kw))) {
      return { type: rule.type, confidence: rule.confidence };
    }
  }
  return null;
}

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
  private readonly llm: LlmClient;

  constructor(opts: { llm: LlmClient }) {
    this.llm = opts.llm;
  }

  /**
   * 对输入文本或 MeegoEvent 进行意图分类
   *
   * Pipeline 步骤：
   * 1. 若输入为 MeegoEvent，提取 payload.title + payload.description 拼接为字符串
   * 2. 若提供了 context.entities，将实体列表追加到文本末尾以增强分类精度
   * 3. 规则快速路径 — 关键词匹配，置信度 >= 0.8 则直接返回
   * 4. 若规则置信度 < 0.8，调用 LLM 分类 + 实体提取
   * 5. 若 LLM 置信度 < 0.5，回退返回 type = "query"
   *
   * @param input - 待分类的输入（字符串或 MeegoEvent）
   * @param context - 可选的上下文信息，包含预提取的实体列表
   * @param context.entities - 由 DocumentParser 提取的实体名（模块、API 路径、类型声明）
   * @returns IntentResult，包含 type、confidence、entities
   *
   * @example
   * ```typescript
   * const result = await classifier.classify("前端开发这个需求");
   * // { type: "frontend_dev", confidence: 0.9, entities: { modules: [], owners: [], domains: [] } }
   *
   * const event: MeegoEvent = {
   *   eventId: "e1",
   *   issueId: "I-1",
   *   projectKey: "FE",
   *   type: "issue.created",
   *   payload: { title: "评审设计文档", description: "..." },
   *   timestamp: Date.now(),
   * };
   * const result2 = await classifier.classify(event);
   * // { type: "tech_spec", confidence: 0.9, entities: { modules: [], owners: [], domains: [] } }
   *
   * // 传入预提取实体以增强分类精度
   * const parsed = parser.parseMarkdown(description);
   * const result3 = await classifier.classify(event, { entities: parsed.entities });
   * ```
   */
  async classify(input: string | MeegoEvent, context?: { entities?: string[] }): Promise<IntentResult> {
    const text = typeof input === "string" ? input : eventToString(input);
    const enrichedText = context?.entities?.length ? `${text}\n\n提取到的实体: ${context.entities.join(", ")}` : text;
    logger.debug({ textLen: enrichedText.length }, "开始意图分类");

    const ruleResult = applyRules(enrichedText);
    if (ruleResult !== null && ruleResult.confidence >= 0.8) {
      logger.info({ type: ruleResult.type, confidence: ruleResult.confidence, path: "rules" }, "规则快速路径命中");
      const modules = context?.entities ?? [];
      return { ...ruleResult, entities: { modules, owners: [], domains: [] } };
    }

    logger.debug("规则置信度不足，回退到 LLM 分类");
    const llmResult = await this.classifyWithLlm(enrichedText);

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
