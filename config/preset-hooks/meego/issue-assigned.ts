import type { HookContext } from "@teamsland/hooks";
import type { MeegoEvent } from "@teamsland/types";

/** 当工单被分配时，发送飞书私信通知受理人 */
export const description = "工单分配时发送飞书私信通知受理人";
export const priority = 50;

export const match = (event: MeegoEvent): boolean => event.type === "issue.assigned";

export const handle = async (event: MeegoEvent, ctx: HookContext): Promise<void> => {
  const assigneeId = typeof event.payload.assigneeId === "string" ? event.payload.assigneeId : "";
  if (!assigneeId) {
    ctx.log.warn({ issueId: event.issueId }, "issue.assigned 缺少 assigneeId");
    return;
  }
  await ctx.notifier.sendDm(assigneeId, `您已被分配工单 ${event.issueId}（项目 ${event.projectKey}），请及时跟进。`);
  ctx.log.info({ issueId: event.issueId, assigneeId }, "工单分配通知已发送");
};
