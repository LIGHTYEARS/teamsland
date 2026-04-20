import type { ComplexTask } from "@teamsland/types";
import { describe, expect, it } from "vitest";
import { TaskPlanner } from "../task-planner.js";
import type { LlmClient, LlmResponse } from "../types.js";

/** 预编程 LLM 客户端，用于 TaskPlanner 测试 */
class FakeLlmClient implements LlmClient {
  private responses: LlmResponse[];
  private index = 0;

  constructor(responses: LlmResponse[]) {
    this.responses = responses;
  }

  async chat(_messages: Array<{ role: "system" | "user" | "assistant"; content: string }>): Promise<LlmResponse> {
    const resp = this.responses[this.index];
    if (!resp) throw new Error("FakeLlmClient: 响应序列已耗尽");
    this.index++;
    return resp;
  }
}

const baseTask: ComplexTask = {
  issueId: "issue-001",
  meegoEvent: {
    eventId: "evt-001",
    issueId: "issue-001",
    projectKey: "FE",
    type: "issue.created",
    payload: {},
    timestamp: Date.now(),
  },
  meegoProjectId: "project_xxx",
  description: "分析团队 Q1 开发效率并生成报告",
  triggerType: "frontend_dev",
  agentRole: "architect",
  worktreePath: "/tmp/wt",
  assigneeId: "user-001",
  subtasks: [],
};

describe("TaskPlanner.decompose()", () => {
  it("正常拆解：返回合法 SubTask[] 列表", async () => {
    const subtasks = [
      { taskId: "st-1", description: "分析提交记录", agentRole: "代码分析师", dependencies: [] },
      { taskId: "st-2", description: "生成报告", agentRole: "报告撰写员", dependencies: ["st-1"] },
    ];
    const llm = new FakeLlmClient([{ content: JSON.stringify(subtasks) }]);
    const planner = new TaskPlanner({ llm });
    const result = await planner.decompose(baseTask);
    expect(result).toHaveLength(2);
    expect(result[0].taskId).toBe("st-1");
    expect(result[1].dependencies).toEqual(["st-1"]);
  });

  it("无依赖任务：所有 SubTask.dependencies 为空数组", async () => {
    const subtasks = [
      { taskId: "st-1", description: "任务A", agentRole: "角色A", dependencies: [] },
      { taskId: "st-2", description: "任务B", agentRole: "角色B", dependencies: [] },
    ];
    const llm = new FakeLlmClient([{ content: JSON.stringify(subtasks) }]);
    const planner = new TaskPlanner({ llm });
    const result = await planner.decompose(baseTask);
    expect(result.every((s) => s.dependencies.length === 0)).toBe(true);
  });

  it("有依赖任务：SubTask A 依赖 SubTask B，验证 dependencies 字段", async () => {
    const subtasks = [
      { taskId: "st-1", description: "准备数据", agentRole: "数据工程师", dependencies: [] },
      { taskId: "st-2", description: "分析数据", agentRole: "数据分析师", dependencies: ["st-1"] },
    ];
    const llm = new FakeLlmClient([{ content: JSON.stringify(subtasks) }]);
    const planner = new TaskPlanner({ llm });
    const result = await planner.decompose(baseTask);
    expect(result[1].dependencies).toContain("st-1");
  });

  it("空任务列表：LLM 返回 [] 时 decompose() 返回空数组（不抛出）", async () => {
    const llm = new FakeLlmClient([{ content: "[]" }]);
    const planner = new TaskPlanner({ llm });
    const result = await planner.decompose(baseTask);
    expect(result).toEqual([]);
  });

  it("非法 JSON：LLM 返回非 JSON 字符串时抛出含 raw 内容的 Error", async () => {
    const llm1 = new FakeLlmClient([{ content: "not json at all" }]);
    const planner1 = new TaskPlanner({ llm: llm1 });
    await expect(planner1.decompose(baseTask)).rejects.toThrow("TaskPlanner");

    const llm2 = new FakeLlmClient([{ content: "not json at all" }]);
    const planner2 = new TaskPlanner({ llm: llm2 });
    await expect(planner2.decompose(baseTask)).rejects.toThrow("not json");
  });

  it("非数组 JSON：LLM 返回对象 {} 时抛出不是数组错误", async () => {
    const llm = new FakeLlmClient([{ content: "{}" }]);
    const planner = new TaskPlanner({ llm });
    await expect(planner.decompose(baseTask)).rejects.toThrow("不是数组");
  });

  it("结构不完整：SubTask 缺少 agentRole 字段时抛出结构错误", async () => {
    const malformed = [{ taskId: "st-1", description: "任务A", dependencies: [] }];
    const llm = new FakeLlmClient([{ content: JSON.stringify(malformed) }]);
    const planner = new TaskPlanner({ llm });
    await expect(planner.decompose(baseTask)).rejects.toThrow("结构非法");
  });
});
