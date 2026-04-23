import type { HookContext } from "@teamsland/hooks";
import type { MeegoEvent } from "@teamsland/types";

/** 群聊关键词自动回复 */
export const description = "群聊关键词自动回复";
export const priority = 20;

const KEYWORD_REPLIES: Record<string, string> = {
  oncall: "当前 oncall：请查看 https://internal.example.com/oncall",
  standup: "每日站会时间：上午 10:00，主会议室。",
  deploy: "部署指南：https://internal.example.com/deploy-guide",
};

export const match = (event: MeegoEvent): boolean => {
  if (event.payload.source !== "lark_mention") return false;
  const title = typeof event.payload.title === "string" ? event.payload.title : "";
  return title.toLowerCase().trim() in KEYWORD_REPLIES;
};

export const handle = async (event: MeegoEvent, ctx: HookContext): Promise<void> => {
  const chatId = typeof event.payload.chatId === "string" ? event.payload.chatId : "";
  const messageId = typeof event.payload.messageId === "string" ? event.payload.messageId : "";
  const title = typeof event.payload.title === "string" ? event.payload.title : "";
  const reply = KEYWORD_REPLIES[title.toLowerCase().trim()];

  if (!chatId || !reply) return;

  await ctx.lark.sendGroupMessage(chatId, reply, messageId ? { replyToMessageId: messageId } : undefined);
  ctx.log.info({ keyword: title.trim(), chatId }, "关键词自动回复已发送");
};
