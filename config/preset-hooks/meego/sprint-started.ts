import type { HookContext } from "@teamsland/hooks";
import type { MeegoEvent } from "@teamsland/types";

/** 迭代开始时在团队群发送通知 */
export const description = "迭代开始时在团队群发送通知";
export const priority = 80;

export const match = (event: MeegoEvent): boolean => event.type === "sprint.started";

export const handle = async (event: MeegoEvent, ctx: HookContext): Promise<void> => {
  const sprintName = typeof event.payload.sprintName === "string" ? event.payload.sprintName : "未命名迭代";
  const teamChannelId = (
    ctx.config as Record<string, unknown> & { lark?: { notification?: { teamChannelId?: string } } }
  ).lark?.notification?.teamChannelId;
  if (!teamChannelId) return;
  await ctx.lark.sendGroupMessage(
    teamChannelId,
    `迭代「${sprintName}」已启动（项目 ${event.projectKey}），请检查您分配的工单。`,
  );
  ctx.log.info({ projectKey: event.projectKey, sprintName }, "迭代启动通知已发送");
};
