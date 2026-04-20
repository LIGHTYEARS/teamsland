import type { ComplexTask, SubTask } from "@teamsland/types";
import { describe, expect, it, vi } from "vitest";
import { runSwarm } from "../swarm.js";
import { TaskPlanner } from "../task-planner.js";
import type { LlmClient, LlmResponse, SwarmOpts } from "../types.js";

/** 预编程 LLM 客户端 */
class FakeLlmClient implements LlmClient {
  private responses: LlmResponse[];
  private index = 0;
  constructor(responses: LlmResponse[]) {
    this.responses = responses;
  }
  async chat(_m: Array<{ role: "system" | "user" | "assistant"; content: string }>): Promise<LlmResponse> {
    const r = this.responses[this.index++];
    if (!r) throw new Error("FakeLlmClient exhausted");
    return r;
  }
}

const parentTask: ComplexTask = {
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
  description: "分析团队 Q1 效率",
  triggerType: "frontend_dev",
  agentRole: "architect",
  worktreePath: "/tmp/wt",
  assigneeId: "user-001",
  subtasks: [],
};

/** 构建测试用 SwarmOpts */
function buildOpts(
  subtasks: SubTask[],
  workerBehavior:
    | "success"
    | "timeout"
    | "failure"
    | ((taskId: string) => "success" | "timeout" | "failure") = "success",
  minRatio = 0.5,
): SwarmOpts {
  const llm = new FakeLlmClient([{ content: JSON.stringify(subtasks) }]);
  const planner = new TaskPlanner({ llm });

  const spawnFn = vi.fn(async (params: { issueId: string }) => {
    const behavior = typeof workerBehavior === "function" ? workerBehavior(params.issueId) : workerBehavior;
    if (behavior === "success") {
      return { pid: 1, sessionId: `sess-${params.issueId}`, stdout: new ReadableStream() };
    }
    if (behavior === "timeout") {
      throw new Error("spawn: timeout after 300s");
    }
    throw new Error("spawn: process exited with code 1");
  });

  return {
    planner,
    registry: {} as SwarmOpts["registry"],
    assembler: { buildInitialPrompt: vi.fn(async () => "mock-prompt") } as unknown as SwarmOpts["assembler"],
    processController: { spawn: spawnFn } as unknown as SwarmOpts["processController"],
    config: { workerTimeoutSeconds: 300, minSwarmSuccessRatio: minRatio } as SwarmOpts["config"],
    teamId: "team-test",
  };
}

describe("runSwarm()", () => {
  it("全部成功：3 个无依赖 SubTask 全部 fulfilled", async () => {
    const subtasks: SubTask[] = [
      { taskId: "st-1", description: "A", agentRole: "r1", dependencies: [] },
      { taskId: "st-2", description: "B", agentRole: "r2", dependencies: [] },
      { taskId: "st-3", description: "C", agentRole: "r3", dependencies: [] },
    ];
    const result = await runSwarm(parentTask, buildOpts(subtasks, "success"));
    expect(result.success).toBe(true);
    expect(result.failedTaskIds).toEqual([]);
    expect(result.results).toHaveLength(3);
    expect(result.results.every((r) => r.status === "fulfilled")).toBe(true);
  });

  it("部分失败（quorum 通过）：5 个 SubTask 中 3 个 fulfilled（ratio=0.6>=0.5）", async () => {
    const subtasks: SubTask[] = Array.from({ length: 5 }, (_, i) => ({
      taskId: `st-${i + 1}`,
      description: `task ${i}`,
      agentRole: "r",
      dependencies: [],
    }));
    const behavior = (taskId: string) =>
      taskId === "st-1" || taskId === "st-2" ? ("failure" as const) : ("success" as const);
    const result = await runSwarm(parentTask, buildOpts(subtasks, behavior, 0.5));
    expect(result.success).toBe(true);
    expect(result.failedTaskIds).toHaveLength(2);
  });

  it("部分失败（quorum 不通过）：5 个 SubTask 中 1 个 fulfilled（ratio=0.2<0.5）", async () => {
    const subtasks: SubTask[] = Array.from({ length: 5 }, (_, i) => ({
      taskId: `st-${i + 1}`,
      description: `task ${i}`,
      agentRole: "r",
      dependencies: [],
    }));
    const behavior = (taskId: string) => (taskId === "st-1" ? ("success" as const) : ("failure" as const));
    const result = await runSwarm(parentTask, buildOpts(subtasks, behavior, 0.5));
    expect(result.success).toBe(false);
    expect(result.failedTaskIds).toHaveLength(4);
  });

  it("超时处理：Worker 超时被记为 rejected，不阻断同层其他 Worker", async () => {
    const subtasks: SubTask[] = [
      { taskId: "st-1", description: "A", agentRole: "r", dependencies: [] },
      { taskId: "st-2", description: "B", agentRole: "r", dependencies: [] },
    ];
    const behavior = (taskId: string) => (taskId === "st-1" ? ("timeout" as const) : ("success" as const));
    const result = await runSwarm(parentTask, buildOpts(subtasks, behavior, 0.5));
    expect(result.results.find((r) => r.taskId === "st-2")?.status).toBe("fulfilled");
    expect(result.results.find((r) => r.taskId === "st-1")?.status).toBe("rejected");
  });

  it("空子任务：planner 返回 []，success: true，results: []", async () => {
    const opts = buildOpts([]);
    const result = await runSwarm(parentTask, opts);
    expect(result.success).toBe(true);
    expect(result.results).toEqual([]);
    expect(result.failedTaskIds).toEqual([]);
  });

  it("有依赖的 DAG：A->B->C 按层执行", async () => {
    const executionOrder: string[] = [];
    const subtasks: SubTask[] = [
      { taskId: "st-a", description: "A", agentRole: "r", dependencies: [] },
      { taskId: "st-b", description: "B", agentRole: "r", dependencies: ["st-a"] },
      { taskId: "st-c", description: "C", agentRole: "r", dependencies: ["st-b"] },
    ];
    const llm = new FakeLlmClient([{ content: JSON.stringify(subtasks) }]);
    const planner = new TaskPlanner({ llm });
    const spawnFn = vi.fn(async (params: { issueId: string }) => {
      executionOrder.push(params.issueId);
      return { pid: 1, sessionId: `sess-${params.issueId}`, stdout: new ReadableStream() };
    });
    const opts: SwarmOpts = {
      planner,
      registry: {} as SwarmOpts["registry"],
      assembler: { buildInitialPrompt: vi.fn(async () => "p") } as unknown as SwarmOpts["assembler"],
      processController: { spawn: spawnFn } as unknown as SwarmOpts["processController"],
      config: { workerTimeoutSeconds: 300, minSwarmSuccessRatio: 0.5 } as SwarmOpts["config"],
      teamId: "team-test",
    };
    await runSwarm(parentTask, opts);
    expect(executionOrder).toEqual(["st-a", "st-b", "st-c"]);
  });

  it("循环依赖：A.dependencies=[B]，B.dependencies=[A]，runSwarm 抛出循环依赖错误", async () => {
    const subtasks: SubTask[] = [
      { taskId: "st-a", description: "A", agentRole: "r", dependencies: ["st-b"] },
      { taskId: "st-b", description: "B", agentRole: "r", dependencies: ["st-a"] },
    ];
    const opts = buildOpts(subtasks);
    await expect(runSwarm(parentTask, opts)).rejects.toThrow("循环依赖");
  });

  it("minSwarmSuccessRatio 边界：恰好 50% 成功（ratio=0.5=minRatio），success: true", async () => {
    const subtasks: SubTask[] = [
      { taskId: "st-1", description: "A", agentRole: "r", dependencies: [] },
      { taskId: "st-2", description: "B", agentRole: "r", dependencies: [] },
    ];
    const behavior = (taskId: string) => (taskId === "st-1" ? ("success" as const) : ("failure" as const));
    const result = await runSwarm(parentTask, buildOpts(subtasks, behavior, 0.5));
    expect(result.success).toBe(true);
  });
});

describe("topoSort edge cases (via runSwarm)", () => {
  it("钻石形依赖：A、B 无依赖；C 依赖 A 和 B", async () => {
    const completedBefore = new Set<string>();
    const subtasks: SubTask[] = [
      { taskId: "st-a", description: "A", agentRole: "r", dependencies: [] },
      { taskId: "st-b", description: "B", agentRole: "r", dependencies: [] },
      { taskId: "st-c", description: "C", agentRole: "r", dependencies: ["st-a", "st-b"] },
    ];
    const llm = new FakeLlmClient([{ content: JSON.stringify(subtasks) }]);
    const planner = new TaskPlanner({ llm });
    const spawnFn = vi.fn(async (params: { issueId: string }) => {
      const taskId = params.issueId;
      if (taskId === "st-c") {
        expect(completedBefore.has("st-a")).toBe(true);
        expect(completedBefore.has("st-b")).toBe(true);
      }
      completedBefore.add(taskId);
      return { pid: 1, sessionId: `sess-${taskId}`, stdout: new ReadableStream() };
    });
    const opts: SwarmOpts = {
      planner,
      registry: {} as SwarmOpts["registry"],
      assembler: { buildInitialPrompt: vi.fn(async () => "p") } as unknown as SwarmOpts["assembler"],
      processController: { spawn: spawnFn } as unknown as SwarmOpts["processController"],
      config: { workerTimeoutSeconds: 300, minSwarmSuccessRatio: 0.5 } as SwarmOpts["config"],
      teamId: "team-test",
    };
    const result = await runSwarm(parentTask, opts);
    expect(result.success).toBe(true);
  });

  it("未知依赖 ID：引用不存在的 taskId，runSwarm 抛出错误", async () => {
    const subtasks: SubTask[] = [{ taskId: "st-1", description: "A", agentRole: "r", dependencies: ["non-existent"] }];
    const opts = buildOpts(subtasks);
    await expect(runSwarm(parentTask, opts)).rejects.toThrow("未知依赖");
  });
});
