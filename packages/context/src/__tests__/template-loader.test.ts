import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadTemplate } from "../template-loader.js";

describe("loadTemplate", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "context-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("加载存在的模板文件", async () => {
    const content = "# 前端 Agent 指令\n\n你是一个前端开发 Agent。";
    await writeFile(join(tempDir, "frontend-dev.md"), content);
    const result = await loadTemplate("frontend-dev", tempDir);
    expect(result).toBe(content);
  });

  it("文件不存在时抛出错误", async () => {
    await expect(loadTemplate("non-existent", tempDir)).rejects.toThrow("角色模板文件不存在");
  });

  it("文件内容为空时返回空字符串", async () => {
    await writeFile(join(tempDir, "empty.md"), "");
    const result = await loadTemplate("empty", tempDir);
    expect(result).toBe("");
  });

  it("自定义 basePath 参数从指定目录加载", async () => {
    const content = "# 技术评审 Agent 指令";
    await writeFile(join(tempDir, "tech-spec.md"), content);
    const result = await loadTemplate("tech-spec", tempDir);
    expect(result).toBe(content);
  });
});
