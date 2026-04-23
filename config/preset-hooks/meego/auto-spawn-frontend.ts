import type { HookContext } from "@teamsland/hooks";
import type { MeegoEvent } from "@teamsland/types";

/** 前端项目新工单自动派发 Worker */
export const description = "前端项目新工单自动派发 Worker";
export const priority = 90;

export const match = (event: MeegoEvent): boolean =>
  event.type === "issue.created" && event.projectKey === "FRONTEND" && event.payload.source !== "lark_mention";

export const handle = async (event: MeegoEvent, ctx: HookContext): Promise<void> => {
  const title = typeof event.payload.title === "string" ? event.payload.title : "";
  const description = typeof event.payload.description === "string" ? event.payload.description : "";

  const configWithMapping = ctx.config as Record<string, unknown> & {
    repoMapping?: Array<{ meegoProjectId: string; repos: Array<{ path: string }> }>;
  };
  const repoPath = configWithMapping.repoMapping?.find((r) => r.meegoProjectId === event.projectKey)?.repos[0]?.path;

  if (!repoPath) {
    ctx.log.warn({ projectKey: event.projectKey }, "未找到项目仓库映射，跳过自动派发");
    return;
  }

  const task = [title, description].filter(Boolean).join("\n\n");
  const result = await ctx.spawn({ repo: repoPath, task, requester: "auto-hook" });
  ctx.log.info({ issueId: event.issueId, agentId: result.agentId }, "已通过 Hook 自动派发 Worker");
};
