import type { MeegoEvent } from "@teamsland/types";
import { describe, expect, it, vi } from "vitest";
import { IntentClassifier } from "../intent-classifier.js";
import type { LlmClient } from "../types.js";

function makeFakeLlm(response: string): LlmClient {
  return {
    chat: vi.fn().mockResolvedValue({ content: response }),
  };
}

describe("IntentClassifier — 规则快速路径", () => {
  it("包含'技术方案'时命中规则，type=tech_spec，不调用 LLM", async () => {
    const llm = makeFakeLlm("");
    const classifier = new IntentClassifier({ llm });

    const result = await classifier.classify("帮我评审一下这个技术方案");

    expect(result.type).toBe("tech_spec");
    expect(result.confidence).toBeGreaterThanOrEqual(0.9);
    expect(llm.chat).not.toHaveBeenCalled();
  });

  it("包含'前端'时命中规则，type=frontend_dev，不调用 LLM", async () => {
    const llm = makeFakeLlm("");
    const classifier = new IntentClassifier({ llm });

    const result = await classifier.classify("前端开发这个需求");

    expect(result.type).toBe("frontend_dev");
    expect(result.confidence).toBeGreaterThanOrEqual(0.9);
    expect(llm.chat).not.toHaveBeenCalled();
  });

  it("包含'确认'时命中规则，type=confirm，不调用 LLM", async () => {
    const llm = makeFakeLlm("");
    const classifier = new IntentClassifier({ llm });

    const result = await classifier.classify("确认这个方案可以上线");

    expect(result.type).toBe("confirm");
    expect(result.confidence).toBeGreaterThanOrEqual(0.9);
    expect(llm.chat).not.toHaveBeenCalled();
  });

  it("entities 字段包含空数组", async () => {
    const llm = makeFakeLlm("");
    const classifier = new IntentClassifier({ llm });

    const result = await classifier.classify("前端开发这个需求");

    expect(result.entities).toEqual({ modules: [], owners: [], domains: [] });
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

  it("LLM 置信度 < 0.5 时回退到 query 类型，保留原置信度", async () => {
    const llmResponse = JSON.stringify({
      type: "tech_spec",
      confidence: 0.3,
      entities: { modules: [], owners: [], domains: [] },
    });
    const llm = makeFakeLlm(llmResponse);
    const classifier = new IntentClassifier({ llm });

    const result = await classifier.classify("balabala 随便说点什么");

    expect(result.type).toBe("query");
    expect(result.confidence).toBeCloseTo(0.3);
  });

  it("LLM 返回非 JSON 时不抛出，返回 query + confidence 0", async () => {
    const llm = makeFakeLlm("我不会 JSON");
    const classifier = new IntentClassifier({ llm });

    const result = await classifier.classify("随便的输入");

    expect(result.type).toBe("query");
    expect(result.confidence).toBe(0);
  });
});

describe("IntentClassifier — MeegoEvent 输入", () => {
  it("MeegoEvent payload.title 包含关键词时命中规则，不调用 LLM", async () => {
    const llm = makeFakeLlm("");
    const classifier = new IntentClassifier({ llm });

    const event: MeegoEvent = {
      eventId: "evt-001",
      issueId: "ISSUE-42",
      projectKey: "FE",
      type: "issue.created",
      payload: { title: "技术方案评审", description: "请大家查看" },
      timestamp: Date.now(),
    };

    const result = await classifier.classify(event);

    expect(result.type).toBe("tech_spec");
    expect(result.confidence).toBeGreaterThanOrEqual(0.9);
    expect(llm.chat).not.toHaveBeenCalled();
  });

  it("MeegoEvent payload 无关键词时回退到 LLM", async () => {
    const llmResponse = JSON.stringify({
      type: "query",
      confidence: 0.75,
      entities: { modules: [], owners: [], domains: [] },
    });
    const llm = makeFakeLlm(llmResponse);
    const classifier = new IntentClassifier({ llm });

    const event: MeegoEvent = {
      eventId: "evt-002",
      issueId: "ISSUE-43",
      projectKey: "FE",
      type: "issue.assigned",
      payload: { title: "随便的任务", description: "没有特定意图" },
      timestamp: Date.now(),
    };

    const result = await classifier.classify(event);

    expect(llm.chat).toHaveBeenCalledOnce();
    expect(result.type).toBe("query");
  });
});
