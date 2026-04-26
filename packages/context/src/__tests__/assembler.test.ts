import type { RepoMapping } from "@teamsland/config";
import type { AppConfig, TaskConfig } from "@teamsland/types";
import { describe, expect, it } from "vitest";
import { DynamicContextAssembler } from "../assembler.js";

// --- Fake dependencies ---

class FakeRepoMapping {
  resolve(projectId: string): Array<{ path: string; name: string }> {
    if (projectId === "PROJ-001") {
      return [{ path: "/repos/frontend", name: "前端仓库" }];
    }
    return [];
  }
}

// --- Test config ---

const mockConfig: AppConfig = {
  skillRouting: {
    frontend: ["frontend-scaffold", "component-generator", "oauth-integration"],
    backend: ["api-generator", "db-migration"],
  },
} as unknown as AppConfig;

const mockTask: TaskConfig = {
  issueId: "ISSUE-001",
  meegoEvent: {
    eventId: "evt-1",
    issueId: "ISSUE-001",
    projectKey: "PROJ-ALPHA",
    type: "issue.created",
    payload: {},
    timestamp: Date.now(),
  },
  meegoProjectId: "PROJ-001",
  description: "实现用户登录功能",
  triggerType: "frontend",
  agentRole: "frontend-dev",
  worktreePath: "/repos/frontend/.worktrees/req-ISSUE-001",
  assigneeId: "user-001",
};

// --- Tests ---

describe("DynamicContextAssembler", () => {
  function buildAssembler() {
    return new DynamicContextAssembler({
      config: mockConfig,
      repoMapping: new FakeRepoMapping() as unknown as RepoMapping,
    });
  }

  it("输出包含全部 2 段标题（§A/§D）", async () => {
    const assembler = buildAssembler();
    const prompt = await assembler.buildInitialPrompt(mockTask, "team-001");
    expect(prompt).toContain("§A — Issue 上下文");
    expect(prompt).toContain("§D — 仓库信息");
  });

  it("不再包含 §B、§C 和 §E 段", async () => {
    const assembler = buildAssembler();
    const prompt = await assembler.buildInitialPrompt(mockTask, "team-001");
    expect(prompt).not.toContain("§B");
    expect(prompt).not.toContain("§C");
    expect(prompt).not.toContain("§E");
  });

  it("§A 正确渲染 Meego 事件字段", async () => {
    const assembler = buildAssembler();
    const prompt = await assembler.buildInitialPrompt(mockTask, "team-001");
    expect(prompt).toContain("ISSUE-001");
    expect(prompt).toContain("PROJ-ALPHA");
    expect(prompt).toContain("issue.created");
  });

  it("§A 包含任务描述", async () => {
    const assembler = buildAssembler();
    const prompt = await assembler.buildInitialPrompt(mockTask, "team-001");
    expect(prompt).toContain("实现用户登录功能");
  });

  it("§D 包含 FakeRepoMapping 返回的仓库路径", async () => {
    const assembler = buildAssembler();
    const prompt = await assembler.buildInitialPrompt(mockTask, "team-001");
    expect(prompt).toContain("/repos/frontend");
    expect(prompt).toContain("前端仓库");
  });

  it("§D 包含工作树路径", async () => {
    const assembler = buildAssembler();
    const prompt = await assembler.buildInitialPrompt(mockTask, "team-001");
    expect(prompt).toContain(mockTask.worktreePath);
  });
});
