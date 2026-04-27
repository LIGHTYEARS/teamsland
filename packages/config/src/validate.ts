import { existsSync } from "node:fs";
import { homedir } from "node:os";
import type { AppConfig } from "@teamsland/types";

export interface ValidationResult {
  fatal: string[];
  warnings: string[];
}

const PLACEHOLDER_RE = /\$\{[A-Z0-9_]+\}/;

function checkRequired(value: unknown, path: string, fatal: string[]): void {
  if (typeof value === "string") {
    if (!value) {
      fatal.push(`${path} 不能为空`);
    } else if (PLACEHOLDER_RE.test(value)) {
      fatal.push(`${path} 含未解析的环境变量占位符: ${value}`);
    }
  }
}

export function validateConfig(config: AppConfig): ValidationResult {
  const fatal: string[] = [];
  const warnings: string[] = [];

  // Required string fields
  checkRequired(config.lark?.appId, "lark.appId", fatal);
  checkRequired(config.lark?.appSecret, "lark.appSecret", fatal);
  checkRequired(config.meego?.apiBaseUrl, "meego.apiBaseUrl", fatal);
  checkRequired(config.queue?.dbPath, "queue.dbPath", fatal);

  // Required numeric fields
  if (!config.dashboard?.port || config.dashboard.port <= 0 || !Number.isInteger(config.dashboard.port)) {
    fatal.push("dashboard.port 必须为正整数");
  }

  // coordinator.enabled must be boolean
  if (config.coordinator && typeof config.coordinator.enabled !== "boolean") {
    fatal.push("coordinator.enabled 必须为 boolean");
  }

  // Repo path existence checks (warn only)
  for (const entry of config.repoMapping ?? []) {
    for (const repo of entry.repos) {
      const resolved = repo.path.replace(/^~/, homedir());
      if (!existsSync(resolved)) {
        warnings.push(`repoMapping 路径不存在: ${repo.path} (resolved: ${resolved})`);
      }
    }
  }

  return { fatal, warnings };
}
