#!/usr/bin/env bun
/**
 * OpenViking 知识导入脚本
 *
 * 一次性执行：创建目录结构 + 导入 config.repoMapping 中的代码仓库。
 *
 * 用法: bun run scripts/viking-init.ts
 */

import { VikingMemoryClient } from "@teamsland/memory";
import { createLogger } from "@teamsland/observability";
import type { AppConfig } from "@teamsland/types";

const logger = createLogger("scripts:viking-init");

async function main(): Promise<void> {
  // 加载配置
  const configFile = Bun.file("config/config.json");
  const config = (await configFile.json()) as AppConfig;

  if (!config.openViking) {
    logger.error("config.json 中缺少 openViking 配置");
    process.exit(1);
  }

  const client = new VikingMemoryClient(config.openViking);

  // 检查连通性
  const healthy = await client.healthCheck();
  if (!healthy) {
    logger.error({ baseUrl: config.openViking.baseUrl }, "无法连接 OpenViking server");
    process.exit(1);
  }
  logger.info("OpenViking server 连接正常");

  // 创建目录结构
  logger.info("创建目录结构...");
  await client.mkdir("viking://resources/tasks/", "团队任务状态存储");
  await client.mkdir("viking://resources/tasks/active/", "进行中的任务");
  await client.mkdir("viking://resources/tasks/completed/", "已完成的任务");
  await client.mkdir("viking://resources/lark-docs/", "飞书文档归档");
  logger.info("目录结构创建完成");

  // 导入代码仓库
  for (const mapping of config.repoMapping) {
    for (const repo of mapping.repos) {
      logger.info({ path: repo.path, name: repo.name }, "导入代码仓库...");
      const result = await client.addResource(repo.path, {
        to: `viking://resources/${repo.name}/`,
        reason: `代码仓库: ${repo.name}`,
        wait: false,
      });
      logger.info({ uri: result.uri, taskId: result.task_id }, "仓库导入已提交");
    }
  }

  logger.info("知识导入已全部提交，语义处理将在后台完成");
}

main().catch((err: unknown) => {
  logger.fatal({ err }, "知识导入失败");
  process.exit(1);
});
