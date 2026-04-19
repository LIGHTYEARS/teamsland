import { describe, expect, it } from "vitest";
import { RepoMapping } from "../repo-mapping.js";

const TEST_CONFIG = [
  {
    meegoProjectId: "project_xxx",
    repos: [
      { path: "/repos/frontend-main", name: "前端主仓库" },
      { path: "/repos/frontend-components", name: "组件库" },
    ],
  },
  {
    meegoProjectId: "project_yyy",
    repos: [{ path: "/repos/admin-portal", name: "管理后台" }],
  },
];

describe("RepoMapping", () => {
  it("fromConfig 正确构造映射", () => {
    const mapping = RepoMapping.fromConfig(TEST_CONFIG);
    expect(mapping).toBeInstanceOf(RepoMapping);
  });

  it("resolve 匹配已知 projectId 返回 repos", () => {
    const mapping = RepoMapping.fromConfig(TEST_CONFIG);
    const repos = mapping.resolve("project_xxx");
    expect(repos).toHaveLength(2);
    expect(repos[0].path).toBe("/repos/frontend-main");
    expect(repos[0].name).toBe("前端主仓库");
    expect(repos[1].path).toBe("/repos/frontend-components");
  });

  it("resolve 匹配单仓库项目", () => {
    const mapping = RepoMapping.fromConfig(TEST_CONFIG);
    const repos = mapping.resolve("project_yyy");
    expect(repos).toHaveLength(1);
    expect(repos[0].name).toBe("管理后台");
  });

  it("resolve 未知 projectId 返回空数组", () => {
    const mapping = RepoMapping.fromConfig(TEST_CONFIG);
    const repos = mapping.resolve("unknown_project");
    expect(repos).toEqual([]);
  });

  it("fromConfig 空数组构造空映射", () => {
    const mapping = RepoMapping.fromConfig([]);
    expect(mapping.resolve("anything")).toEqual([]);
  });
});
