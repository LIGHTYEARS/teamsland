import type { HookContext } from "@teamsland/hooks";
import type { MeegoEvent } from "@teamsland/types";

/** CI 构建失败时通知团队群 */
export const description = "CI 构建失败时通知团队群";
export const priority = 30;

export const match = (event: MeegoEvent): boolean =>
  event.type === "issue.created" && event.payload.source === "ci" && event.payload.status === "failed";

export const handle = async (event: MeegoEvent, ctx: HookContext): Promise<void> => {
  const teamChannelId = (
    ctx.config as Record<string, unknown> & { lark?: { notification?: { teamChannelId?: string } } }
  ).lark?.notification?.teamChannelId;
  if (!teamChannelId) return;
  const branch = typeof event.payload.branch === "string" ? event.payload.branch : "unknown";
  const pipelineUrl = typeof event.payload.pipelineUrl === "string" ? event.payload.pipelineUrl : "";

  const message = [
    `CI 构建失败`,
    `项目：${event.projectKey}`,
    `分支：${branch}`,
    pipelineUrl ? `流水线：${pipelineUrl}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  await ctx.lark.sendGroupMessage(teamChannelId, message);
  ctx.log.info({ projectKey: event.projectKey, branch }, "CI 失败通知已发送");
};
