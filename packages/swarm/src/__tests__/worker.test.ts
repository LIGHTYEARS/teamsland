import type { ComplexTask, SubTask } from "@teamsland/types";
import { describe, expect, it, vi } from "vitest";
import type { SwarmOpts } from "../types.js";
import { runWorker } from "../worker.js";

/** 构建测试用 ComplexTask fixture */
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

const subtask: SubTask = {
  taskId: "st-1",
  description: "分析提交记录",
  agentRole: "代码分析师",
  dependencies: [],
};

/**
 * 构建测试用 SwarmOpts
 * assembler.buildInitialPrompt 返回 mock prompt
 * processController.spawn 根据 behavior 参数决定行为
 */
function buildOpts(behavior: "success" | "timeout" | "failure"): SwarmOpts {
  const assemblerSpy = vi.fn(async () => "mock-prompt");
  const spawnSpy = vi.fn(async (_params: unknown) => {
    if (behavior === "success") {
      return { pid: 12345, sessionId: "sess-mock", stdout: new ReadableStream() };
    }
    if (behavior === "timeout") {
      throw new Error("spawn: timeout after 300s");
    }
    throw new Error("spawn: process exited with code 1");
  });

  return {
    planner: {} as SwarmOpts["planner"],
    registry: {} as SwarmOpts["registry"],
    assembler: { buildInitialPrompt: assemblerSpy } as unknown as SwarmOpts["assembler"],
    processController: { spawn: spawnSpy } as unknown as SwarmOpts["processController"],
    config: { workerTimeoutSeconds: 300, minSwarmSuccessRatio: 0.5 } as SwarmOpts["config"],
    teamId: "team-test",
  };
}

describe("runWorker()", () => {
  it("成功执行：返回 fulfilled WorkerResult", async () => {
    const opts = buildOpts("success");
    const result = await runWorker(subtask, parentTask, opts);
    expect(result.taskId).toBe("st-1");
    expect(result.status).toBe("fulfilled");
  });

  it("超时失败：processController 抛出 timeout 错误，返回 rejected WorkerResult", async () => {
    const opts = buildOpts("timeout");
    const result = await runWorker(subtask, parentTask, opts);
    expect(result.status).toBe("rejected");
    expect(result.error).toContain("timeout");
  });

  it("进程失败：processController 抛出非超时错误，返回 rejected WorkerResult", async () => {
    const opts = buildOpts("failure");
    const result = await runWorker(subtask, parentTask, opts);
    expect(result.status).toBe("rejected");
    expect(result.error).toContain("process exited");
  });

  it("assembler.buildInitialPrompt 被正确调用", async () => {
    const opts = buildOpts("success");
    await runWorker(subtask, parentTask, opts);
    const assembler = opts.assembler as unknown as { buildInitialPrompt: ReturnType<typeof vi.fn> };
    expect(assembler.buildInitialPrompt).toHaveBeenCalledOnce();
    // 第一个参数应为 TaskConfig，第二个为 teamId
    const callArgs = assembler.buildInitialPrompt.mock.calls[0];
    expect(callArgs[0]).toMatchObject({
      issueId: subtask.taskId,
      description: subtask.description,
      agentRole: subtask.agentRole,
    });
    expect(callArgs[1]).toBe("team-test");
  });

  it("processController.spawn 被正确调用", async () => {
    const opts = buildOpts("success");
    await runWorker(subtask, parentTask, opts);
    const controller = opts.processController as unknown as { spawn: ReturnType<typeof vi.fn> };
    expect(controller.spawn).toHaveBeenCalledOnce();
    const spawnArg = controller.spawn.mock.calls[0][0] as Record<string, unknown>;
    expect(spawnArg.issueId).toBe(subtask.taskId);
    expect(spawnArg.initialPrompt).toBe("mock-prompt");
    expect(spawnArg.worktreePath).toBe(parentTask.worktreePath);
  });
});
