import type { RepoMapping } from "@teamsland/config";
import type { Embedder } from "@teamsland/memory";
import type { AbstractMemoryStore, AppConfig, MemoryEntry, TaskConfig } from "@teamsland/types";
import { describe, expect, it } from "vitest";
import { DynamicContextAssembler } from "../assembler.js";

// --- Fake dependencies ---

class FakeMemoryStore implements AbstractMemoryStore {
  constructor(private readonly entries: MemoryEntry[] = []) {}

  async vectorSearch(_queryVec: number[], _limit?: number): Promise<MemoryEntry[]> {
    return this.entries;
  }

  async writeEntry(_entry: MemoryEntry): Promise<void> {}

  async exists(_teamId: string, _hash: string): Promise<boolean> {
    return false;
  }

  async listAbstracts(_teamId: string): Promise<MemoryEntry[]> {
    return this.entries.filter((e) =>
      ["profile", "preferences", "entities", "soul", "identity"].includes(e.memoryType),
    );
  }

  ftsSearch(_query: string, _limit?: number): MemoryEntry[] {
    return this.entries;
  }

  incrementAccessCount(_entryIds: string[]): void {
    // no-op for testing
  }
}

class FakeEmbedder implements Embedder {
  async init(): Promise<void> {}
  async embed(_text: string): Promise<number[]> {
    return new Array(512).fill(0.1);
  }
  async embedBatch(texts: string[]): Promise<number[][]> {
    return texts.map(() => new Array(512).fill(0.1));
  }
}

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
  function buildAssembler(memoryStore?: AbstractMemoryStore) {
    return new DynamicContextAssembler({
      config: mockConfig,
      repoMapping: new FakeRepoMapping() as unknown as RepoMapping,
      memoryStore: memoryStore ?? new FakeMemoryStore(),
      embedder: new FakeEmbedder(),
    });
  }

  it("输出包含全部 3 段标题（§A/§B/§D）", async () => {
    const assembler = buildAssembler();
    const prompt = await assembler.buildInitialPrompt(mockTask, "team-001");
    expect(prompt).toContain("§A — Issue 上下文");
    expect(prompt).toContain("§B — 历史记忆");
    expect(prompt).toContain("§D — 仓库信息");
  });

  it("不再包含 §C 和 §E 段", async () => {
    const assembler = buildAssembler();
    const prompt = await assembler.buildInitialPrompt(mockTask, "team-001");
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

  it("§B 包含 FakeMemoryStore 返回的记忆条目", async () => {
    const entry: MemoryEntry = {
      id: "mem-1",
      teamId: "team-001",
      agentId: "agent-fe",
      memoryType: "patterns",
      content: "团队使用 shadcn/ui 组件库",
      accessCount: 5,
      createdAt: new Date(),
      updatedAt: new Date(),
      toDict: () => ({}),
      toVectorPoint: () => ({ id: "mem-1", vector: [], payload: {} }),
    };
    const assembler = buildAssembler(new FakeMemoryStore([entry]));
    const prompt = await assembler.buildInitialPrompt(mockTask, "team-001");
    expect(prompt).toContain("团队使用 shadcn/ui 组件库");
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
