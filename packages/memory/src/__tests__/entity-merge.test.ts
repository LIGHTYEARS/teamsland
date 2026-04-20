import type { MemoryEntry } from "@teamsland/types";
import { describe, expect, it } from "vitest";
import { cosineSimilarity, entityMerge } from "../entity-merge.js";

/** 创建测试用 MemoryEntry */
function makeEntry(id: string, content: string, accessCount: number): MemoryEntry {
  return {
    id,
    teamId: "team-test",
    agentId: "agent-test",
    memoryType: "entities",
    content,
    accessCount,
    createdAt: new Date(),
    updatedAt: new Date(),
    toDict: () => ({ id, content }),
    toVectorPoint: () => ({ id, vector: [], payload: { content } }),
  };
}

describe("cosineSimilarity", () => {
  it("相同向量相似度为 1", () => {
    const v = [1, 2, 3];
    expect(cosineSimilarity(v, v)).toBeCloseTo(1.0, 5);
  });

  it("正交向量相似度为 0", () => {
    const a = [1, 0, 0];
    const b = [0, 1, 0];
    expect(cosineSimilarity(a, b)).toBeCloseTo(0.0, 5);
  });

  it("反向向量相似度为 -1", () => {
    const a = [1, 2, 3];
    const b = [-1, -2, -3];
    expect(cosineSimilarity(a, b)).toBeCloseTo(-1.0, 5);
  });

  it("零向量返回 0", () => {
    const a = [0, 0, 0];
    const b = [1, 2, 3];
    expect(cosineSimilarity(a, b)).toBe(0);
  });
});

describe("entityMerge", () => {
  it("不重复的条目全部保留", () => {
    const e1 = makeEntry("1", "Alice", 5);
    const e2 = makeEntry("2", "Bob", 3);

    const embeddings = new Map<string, number[]>();
    embeddings.set("1", [1, 0, 0]);
    embeddings.set("2", [0, 1, 0]);

    const result = entityMerge([e1, e2], embeddings, 0.95);
    expect(result).toHaveLength(2);
  });

  it("相同向量的条目去重，保留高访问量的", () => {
    const e1 = makeEntry("1", "Alice v1", 5);
    const e2 = makeEntry("2", "Alice v2", 10);

    const vec = [1, 0, 0];
    const embeddings = new Map<string, number[]>();
    embeddings.set("1", vec);
    embeddings.set("2", vec);

    const result = entityMerge([e1, e2], embeddings, 0.95);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("2");
  });

  it("三个条目中两个重复，保留 2 个", () => {
    const e1 = makeEntry("1", "Alice v1", 5);
    const e2 = makeEntry("2", "Alice v2", 10);
    const e3 = makeEntry("3", "Bob", 3);

    const embeddings = new Map<string, number[]>();
    embeddings.set("1", [1, 0, 0]);
    embeddings.set("2", [1, 0, 0]);
    embeddings.set("3", [0, 1, 0]);

    const result = entityMerge([e1, e2, e3], embeddings, 0.95);
    expect(result).toHaveLength(2);
    expect(result.map((e) => e.id).sort()).toEqual(["2", "3"]);
  });

  it("空输入返回空数组", () => {
    const result = entityMerge([], new Map(), 0.95);
    expect(result).toHaveLength(0);
  });

  it("单条目返回原条目", () => {
    const e1 = makeEntry("1", "Alice", 5);
    const embeddings = new Map<string, number[]>();
    embeddings.set("1", [1, 0, 0]);

    const result = entityMerge([e1], embeddings, 0.95);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("1");
  });

  it("阈值为 1.0 时只合并完全相同的向量", () => {
    const e1 = makeEntry("1", "A", 5);
    const e2 = makeEntry("2", "B", 10);

    const embeddings = new Map<string, number[]>();
    embeddings.set("1", [1, 0, 0]);
    embeddings.set("2", [0.99, 0.01, 0]);

    const result = entityMerge([e1, e2], embeddings, 1.0);
    expect(result).toHaveLength(2);
  });
});
