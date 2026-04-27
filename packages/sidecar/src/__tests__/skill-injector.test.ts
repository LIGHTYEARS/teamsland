import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SkillManifest } from "../skill-injector.js";
import { SkillInjector } from "../skill-injector.js";

function makeFakeLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    fatal: vi.fn(),
    trace: vi.fn(),
    child: vi.fn().mockReturnThis(),
    level: "info",
    silent: vi.fn(),
  };
}

describe("SkillInjector", () => {
  let tempDir: string;
  let worktreePath: string;
  let skillSourceDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "skill-injector-test-"));
    worktreePath = join(tempDir, "worktree");
    skillSourceDir = join(tempDir, "skills-source");

    // 创建 worktree 目录
    await mkdir(worktreePath, { recursive: true });

    // 创建两个模拟 Skill 源目录
    const larkReplyDir = join(skillSourceDir, "lark-reply");
    const meegoUpdateDir = join(skillSourceDir, "meego-update");
    await mkdir(larkReplyDir, { recursive: true });
    await mkdir(meegoUpdateDir, { recursive: true });

    await Bun.write(join(larkReplyDir, "SKILL.md"), "# lark-reply\n发送飞书消息");
    await Bun.write(join(meegoUpdateDir, "SKILL.md"), "# meego-update\n更新工单");
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  function createInjector(manifests?: SkillManifest[], routing?: Record<string, string[]>) {
    const skills = manifests ?? [
      { name: "lark-reply", sourcePath: join(skillSourceDir, "lark-reply") },
      { name: "meego-update", sourcePath: join(skillSourceDir, "meego-update") },
    ];
    return new SkillInjector({
      skills,
      routing: routing ?? {
        frontend_dev: ["lark-reply", "meego-update"],
        code_review: ["lark-reply"],
      },
      logger: makeFakeLogger() as never,
    });
  }

  it("inject: 将 Skill 文件复制到正确位置", async () => {
    const injector = createInjector();

    await injector.inject({
      worktreePath,
      taskType: "frontend_dev",
    });

    const skillMd = Bun.file(join(worktreePath, ".claude", "skills", "lark-reply", "SKILL.md"));
    const exists = await skillMd.exists();
    expect(exists).toBe(true);

    const content = await skillMd.text();
    expect(content).toBe("# lark-reply\n发送飞书消息");

    const meegoMd = Bun.file(join(worktreePath, ".claude", "skills", "meego-update", "SKILL.md"));
    const meegoExists = await meegoMd.exists();
    expect(meegoExists).toBe(true);
  });

  it("inject: 写入 .injected-by-teamsland 标记文件", async () => {
    const injector = createInjector();

    await injector.inject({
      worktreePath,
      taskType: "code_review",
    });

    const markerFile = Bun.file(join(worktreePath, ".claude", "skills", "lark-reply", ".injected-by-teamsland"));
    const exists = await markerFile.exists();
    expect(exists).toBe(true);

    const content = await markerFile.text();
    // 标记文件内容是 ISO 时间戳
    expect(content).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("inject: 跳过不在清单中的 Skill", async () => {
    const injector = createInjector();

    const result = await injector.inject({
      worktreePath,
      taskType: "frontend_dev",
      extraSkills: ["non-existent-skill"],
    });

    expect(result.skipped).toContain("non-existent-skill");
    expect(result.injected).toContain("lark-reply");
    expect(result.injected).toContain("meego-update");
  });

  it("inject: 合并 routing 和 extraSkills 并去重", async () => {
    const injector = createInjector();

    const result = await injector.inject({
      worktreePath,
      taskType: "code_review", // routing 只有 lark-reply
      extraSkills: ["lark-reply", "meego-update"], // lark-reply 重复
    });

    // lark-reply 不应出现两次
    expect(result.injected).toEqual(["lark-reply", "meego-update"]);
    expect(result.skipped).toEqual([]);
  });

  it("cleanup: 仅移除带标记的目录", async () => {
    const injector = createInjector();

    // 注入 Skill（会创建标记文件）
    await injector.inject({
      worktreePath,
      taskType: "code_review",
    });

    // 手动创建一个「非注入」的 Skill 目录（无标记）
    const manualSkillDir = join(worktreePath, ".claude", "skills", "manual-skill");
    await mkdir(manualSkillDir, { recursive: true });
    await Bun.write(join(manualSkillDir, "SKILL.md"), "# manual-skill");

    await injector.cleanup(worktreePath);

    // 被标记的 lark-reply 应被移除
    const larkReplyExists = await Bun.file(join(worktreePath, ".claude", "skills", "lark-reply", "SKILL.md")).exists();
    expect(larkReplyExists).toBe(false);

    // 手动创建的目录应保留
    const manualExists = await Bun.file(join(manualSkillDir, "SKILL.md")).exists();
    expect(manualExists).toBe(true);
  });

  it("cleanup: 保留非注入的 Skill 目录", async () => {
    const skillsDir = join(worktreePath, ".claude", "skills", "user-custom");
    await mkdir(skillsDir, { recursive: true });
    await Bun.write(join(skillsDir, "README.md"), "# custom skill");

    const injector = createInjector();
    await injector.cleanup(worktreePath);

    const entries = await readdir(join(worktreePath, ".claude", "skills"));
    expect(entries).toContain("user-custom");
  });

  it("inject: 未知 taskType 不报错，返回空 injected 列表", async () => {
    const injector = createInjector();

    const result = await injector.inject({
      worktreePath,
      taskType: "unknown_task",
    });

    expect(result.injected).toEqual([]);
    expect(result.skipped).toEqual([]);
  });

  it("cleanup: skills 目录不存在时不报错", async () => {
    const injector = createInjector();

    // worktreePath 存在但没有 .claude/skills/
    await expect(injector.cleanup(worktreePath)).resolves.toBeUndefined();
  });

  it("inject: core skills 在 taskType 无路由时仍被注入", async () => {
    // 创建 teamsland-report skill 源目录
    const teamslandReportDir = join(skillSourceDir, "teamsland-report");
    await mkdir(teamslandReportDir, { recursive: true });
    await Bun.write(join(teamslandReportDir, "SKILL.md"), "# teamsland-report\n上报结果");

    const injector = new SkillInjector({
      skills: [
        { name: "lark-reply", sourcePath: join(skillSourceDir, "lark-reply") },
        { name: "teamsland-report", sourcePath: teamslandReportDir },
      ],
      routing: { coding: ["lark-reply"] }, // unknown_task 无路由
      coreSkills: ["teamsland-report"],
      logger: makeFakeLogger() as never,
    });

    const result = await injector.inject({
      worktreePath,
      taskType: "unknown_task",
    });

    expect(result.injected).toContain("teamsland-report");

    const skillMd = Bun.file(join(worktreePath, ".claude", "skills", "teamsland-report", "SKILL.md"));
    const exists = await skillMd.exists();
    expect(exists).toBe(true);
  });

  it("inject: core skills 不重复注入已在路由中的 skill", async () => {
    // 创建 teamsland-report skill 源目录
    const teamslandReportDir = join(skillSourceDir, "teamsland-report");
    await mkdir(teamslandReportDir, { recursive: true });
    await Bun.write(join(teamslandReportDir, "SKILL.md"), "# teamsland-report\n上报结果");

    const injector = new SkillInjector({
      skills: [
        { name: "lark-reply", sourcePath: join(skillSourceDir, "lark-reply") },
        { name: "teamsland-report", sourcePath: teamslandReportDir },
      ],
      routing: { coding: ["lark-reply", "teamsland-report"] },
      coreSkills: ["teamsland-report"],
      logger: makeFakeLogger() as never,
    });

    const result = await injector.inject({
      worktreePath,
      taskType: "coding",
    });

    const teamslandReportCount = result.injected.filter((s) => s === "teamsland-report").length;
    expect(teamslandReportCount).toBe(1);
  });
});
